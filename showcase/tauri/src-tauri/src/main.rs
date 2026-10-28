// Menu-bar-only shell for the roamies. One transparent, always-on-top, click-through webview per
// monitor; a Node sidecar (gg-agent) is the brain and owns the tray menu, settings and logins.
// No Dock icon (LSUIElement + Accessory policy) and no taskbar entries on Windows/Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::{thread, time::Duration};

use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

static GENERATION: AtomicUsize = AtomicUsize::new(0);

struct Sidecar(Mutex<Option<ChildStdin>>);
struct Roster(Mutex<Vec<String>>);
/// The voice helper (macOS) and how many times it has died on its own since it was last wanted.
struct Voice(Mutex<Option<Child>>, AtomicUsize);

fn is_overlay(label: &str) -> bool {
    label.starts_with("overlay-")
}

fn to_sidecar(app: &AppHandle, msg: &Value) {
    if let Some(stdin) = app.state::<Sidecar>().0.lock().unwrap().as_mut() {
        let _ = writeln!(stdin, "{msg}");
    }
}

fn to_overlays(app: &AppHandle, msg: &Value) {
    let js = format!("window.__roamieHost&&__roamieHost({msg})");
    for (label, w) in app.webview_windows() {
        if is_overlay(&label) {
            let _ = w.eval(&js);
        }
    }
}

// ---------- commands called by the page ----------

/// Cursor entered or left something clickable: flip click-through.
#[tauri::command]
fn set_hot(window: WebviewWindow, hot: bool) {
    let _ = window.set_ignore_cursor_events(!hot);
}

#[tauri::command]
fn sidecar_send(app: AppHandle, msg: Value) {
    to_sidecar(&app, &msg);
}

/// The input bubble needs keystrokes: make the overlay key while typing, then hand focus back.
#[tauri::command]
fn set_typing(app: AppHandle, window: WebviewWindow, on: bool) {
    let _ = window.set_focusable(on);
    if on {
        let _ = window.set_focus();
    } else {
        #[cfg(target_os = "macos")]
        let _ = app.run_on_main_thread(|| unsafe {
            use objc2::runtime::AnyObject;
            use objc2::{class, msg_send};
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![ns_app, deactivate];
        });
    }
    let _ = &app;
}

// ---------- overlays ----------

fn build_overlays(app: &AppHandle) -> tauri::Result<()> {
    for (label, w) in app.webview_windows() {
        if is_overlay(&label) {
            w.destroy()?;
        }
    }
    let gen = GENERATION.fetch_add(1, Ordering::Relaxed);
    let monitors = app.available_monitors()?;
    let ids = app.state::<Roster>().0.lock().unwrap().clone();
    let n = monitors.len().max(1);
    for (i, mon) in monitors.iter().enumerate() {
        let mine: Vec<String> = ids.iter().enumerate().filter(|(j, _)| j % n == i).map(|(_, id)| format!("{id:?}")).collect();
        if mine.is_empty() {
            continue;
        }
        let scale = mon.scale_factor();
        let pos = mon.position().to_logical::<f64>(scale);
        let size = mon.size().to_logical::<f64>(scale);
        let init = format!("window.ROAMIE_ONLY=[{}];window.ROAMIE_AUTOSOUND=true;window.ROAMIE_UNIT=400;", mine.join(","));
        let w = WebviewWindowBuilder::new(app, format!("overlay-{gen}-{i}"), WebviewUrl::App("desktop.html".into()))
            .title("Roamies")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .initialization_script(init)
            .build()?;
        w.set_ignore_cursor_events(true)?;
    }
    Ok(())
}

/// Edges of a monitor covered by the menu bar, Dock or taskbar, in CSS px, as a JS call.
fn safe_js(mon: &tauri::Monitor) -> String {
    let s = mon.scale_factor();
    let (p, z, wa) = (mon.position(), mon.size(), mon.work_area());
    let top = (wa.position.y - p.y).max(0) as f64 / s;
    let left = (wa.position.x - p.x).max(0) as f64 / s;
    let bottom = ((p.y + z.height as i32) - (wa.position.y + wa.size.height as i32)).max(0) as f64 / s;
    let right = ((p.x + z.width as i32) - (wa.position.x + wa.size.width as i32)).max(0) as f64 / s;
    format!("window.__roamieSafe&&__roamieSafe({{top:{top:.0},left:{left:.0},bottom:{bottom:.0},right:{right:.0}}})")
}

// ~60 Hz: hand each overlay the cursor in its own CSS pixels. Every ~2 s, refresh the safe area
// (the Dock can move, auto-hide or resize).
fn pump_cursor(app: AppHandle) {
    let mut n: u32 = 0;
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(16));
        n = n.wrapping_add(1);
        let Ok(cur) = app.cursor_position() else { continue };
        for (label, w) in app.webview_windows() {
            if !is_overlay(&label) {
                continue;
            }
            if n % 120 == 1 {
                if let Ok(Some(mon)) = w.current_monitor() {
                    let _ = w.eval(safe_js(&mon));
                }
            }
            let (Ok(pos), Ok(scale)) = (w.inner_position(), w.scale_factor()) else { continue };
            let x = (cur.x - pos.x as f64) / scale;
            let y = (cur.y - pos.y as f64) / scale;
            let _ = w.eval(format!("window.__roamiePtr&&__roamiePtr({x:.1},{y:.1})"));
        }
    });
}

// ---------- tray menu, described by the sidecar as JSON ----------

fn menu_items(app: &AppHandle, items: &[Value]) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
    let mut out: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
    for it in items {
        if it.get("sep").and_then(Value::as_bool) == Some(true) {
            out.push(Box::new(PredefinedMenuItem::separator(app)?));
            continue;
        }
        let label = it.get("label").and_then(Value::as_str).unwrap_or("");
        let id = it.get("id").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| format!("sub:{label}"));
        let enabled = it.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        if let Some(children) = it.get("items").and_then(Value::as_array) {
            let kids = menu_items(app, children)?;
            let refs: Vec<&dyn IsMenuItem<Wry>> = kids.iter().map(|b| b.as_ref()).collect();
            out.push(Box::new(Submenu::with_id_and_items(app, id, label, enabled, &refs)?));
        } else if let Some(checked) = it.get("checked").and_then(Value::as_bool) {
            out.push(Box::new(CheckMenuItem::with_id(app, id, label, enabled, checked, None::<&str>)?));
        } else {
            let accel = it.get("accel").and_then(Value::as_str);
            out.push(Box::new(MenuItem::with_id(app, id, label, enabled, accel)?));
        }
    }
    Ok(out)
}

fn set_menu(app: &AppHandle, items: &[Value]) {
    let Some(tray) = app.tray_by_id("roamies") else { return };
    let built = menu_items(app, items).and_then(|kids| {
        let refs: Vec<&dyn IsMenuItem<Wry>> = kids.iter().map(|b| b.as_ref()).collect();
        Menu::with_items(app, &refs)
    });
    match built {
        Ok(menu) => { let _ = tray.set_menu(Some(menu)); }
        Err(e) => eprintln!("menu build failed: {e}"),
    }
}

fn fallback_menu(app: &AppHandle, status: &str) {
    set_menu(app, &[
        json!({ "id": "status", "label": status, "enabled": false }),
        json!({ "sep": true }),
        json!({ "id": "restart", "label": "Restart Sidekick" }),
        json!({ "id": "quit", "label": "Quit Roamies" }),
    ]);
}

// ---------- sidecar ----------

fn find_node() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ROAMIES_NODE") {
        return Some(PathBuf::from(p));
    }
    // GUI apps don't get the shell's PATH on macOS, so check the usual installs too.
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\Program Files\\nodejs"] {
        dirs.push(PathBuf::from(d));
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

fn sidecar_script(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("sidecar").join("sidekick.mjs"));
    match bundled {
        Ok(p) if p.is_file() => p,
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/sidekick.mjs")),
    }
}

fn spawn_sidecar(app: &AppHandle) {
    let Some(node) = find_node() else {
        fallback_menu(app, "Node.js 22+ not found");
        return;
    };
    let script = sidecar_script(app);
    let stderr = log_stdio("sidekick.log");
    let mut cmd = Command::new(node);
    cmd.arg(&script)
        .env("ROAMIES_VERSION", app.package_info().version.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr);
    if let Some(dir) = script.parent() {
        cmd.current_dir(dir);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            fallback_menu(app, &format!("Sidekick failed to start: {e}"));
            return;
        }
    };
    *app.state::<Sidecar>().0.lock().unwrap() = child.stdin.take();
    let stdout = child.stdout.take().expect("piped stdout");
    let app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || handle_sidecar(&app2, msg));
        }
        let _ = child.wait();
        *app.state::<Sidecar>().0.lock().unwrap() = None;
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || fallback_menu(&app2, "Sidekick stopped"));
    });
}

// ---------- voice helper (macOS: ⌃⌥ + Apple speech) ----------

fn voice_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join(if cfg!(windows) { "roamies-voice.exe" } else { "roamies-voice" });
    p.is_file().then_some(p)
}

fn log_stdio(name: &str) -> Stdio {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".gg").join(name))
        .and_then(|p| OpenOptions::new().create(true).append(true).open(p).ok())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null)
}

fn start_voice(app: &AppHandle) {
    let state = app.state::<Voice>();
    if state.0.lock().unwrap().is_some() {
        return;
    }
    let Some(bin) = voice_binary() else {
        eprintln!("voice helper not found next to the app binary");
        return;
    };
    let mut child = match Command::new(bin).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log_stdio("sidekick-voice.log")).spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("voice helper failed to start: {e}");
            return;
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let pid = child.id();
    *state.0.lock().unwrap() = Some(child);
    let app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || handle_voice(&app2, msg));
        }
        // Exited. If it is still the wanted helper, it died on its own: retry a few times.
        let state = app.state::<Voice>();
        let ours = {
            let mut slot = state.0.lock().unwrap();
            let ours = slot.as_ref().map(Child::id) == Some(pid);
            if ours {
                if let Some(mut c) = slot.take() {
                    let _ = c.wait();
                }
            }
            ours
        };
        if ours && state.1.fetch_add(1, Ordering::Relaxed) < 3 {
            thread::sleep(Duration::from_secs(1));
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || start_voice(&app2));
        }
    });
}

fn stop_voice(app: &AppHandle) {
    let state = app.state::<Voice>();
    let child = state.0.lock().unwrap().take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    to_overlays(app, &json!({ "kind": "voice", "type": "state", "state": "idle" }));
}

/// Tell the voice helper to drop a ⌃⌥ press that turned out to be the ⌃⌥S shortcut.
fn cancel_voice(app: &AppHandle) {
    if let Some(child) = app.state::<Voice>().0.lock().unwrap().as_mut() {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = writeln!(stdin, r#"{{"cmd":"cancel"}}"#);
        }
    }
}

/// ⌃⌥S: bring the sidekick forward, or send it away if it's already out.
fn register_summon(app: &AppHandle) {
    use global_hotkey::hotkey::{Code, HotKey, Modifiers};
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    let manager = match GlobalHotKeyManager::new() {
        Ok(m) => m,
        Err(e) => return eprintln!("hotkeys unavailable: {e}"),
    };
    let summon = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
    if let Err(e) = manager.register(summon) {
        return eprintln!("could not register ⌃⌥S: {e}");
    }
    // Lives for the whole run; dropping it would unregister the shortcut.
    Box::leak(Box::new(manager));
    let app = app.clone();
    let id = summon.id();
    GlobalHotKeyEvent::set_event_handler(Some(move |e: GlobalHotKeyEvent| {
        if e.id() != id || e.state() != HotKeyState::Pressed {
            return;
        }
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            cancel_voice(&app2);
            to_overlays(&app2, &json!({ "kind": "summon" }));
        });
    }));
}

fn handle_voice(app: &AppHandle, msg: Value) {
    let mut ui = msg.clone();
    ui["kind"] = json!("voice");
    match msg.get("type").and_then(Value::as_str) {
        Some("ready") => app.state::<Voice>().1.store(0, Ordering::Relaxed),
        Some("state") => {
            to_overlays(app, &ui);
            to_sidecar(app, &json!({ "type": "voice_state", "state": msg.get("state") }));
        }
        Some("partial") | Some("level") => to_overlays(app, &ui),
        Some("final") => {
            to_overlays(app, &ui);
            to_sidecar(app, &json!({ "type": "voice", "text": msg.get("text") }));
        }
        Some("error") => {
            let mut m = msg.clone();
            m["type"] = json!("voice_error");
            to_sidecar(app, &m);
        }
        _ => {}
    }
}

fn handle_sidecar(app: &AppHandle, msg: Value) {
    match msg.get("type").and_then(Value::as_str) {
        Some("menu") => {
            if let Some(items) = msg.get("items").and_then(Value::as_array) {
                set_menu(app, items);
            }
        }
        Some("ui") => {
            if let Some(m) = msg.get("msg") {
                to_overlays(app, m);
            }
        }
        Some("voice_config") => {
            if msg.get("enabled").and_then(Value::as_bool) == Some(true) {
                app.state::<Voice>().1.store(0, Ordering::Relaxed);
                start_voice(app);
            } else {
                stop_voice(app);
            }
        }
        Some("overlays") => {
            let ids: Vec<String> = msg.get("ids").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()).unwrap_or_default();
            let state = app.state::<Roster>();
            let changed = {
                let mut roster = state.0.lock().unwrap();
                let changed = *roster != ids;
                *roster = ids;
                changed
            };
            if changed {
                let _ = build_overlays(app);
            }
        }
        _ => {}
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .manage(Roster(Mutex::new(vec!["sidekick".into()])))
        .manage(Voice(Mutex::new(None), AtomicUsize::new(0)))
        .invoke_handler(tauri::generate_handler![set_hot, sidecar_send, set_typing])
        .on_menu_event(|app, e| match e.id.as_ref() {
            "quit" => app.exit(0),
            "restart" => spawn_sidecar(app),
            id => to_sidecar(app, &json!({ "type": "menu", "id": id })),
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                // Hidden (no Dock, no visible menu bar) but gives text fields Cmd+V/C/X/A/Z.
                app.set_menu(Menu::default(app.handle())?)?;
            }

            let starting = MenuItem::with_id(app, "status", "Starting Sidekick…", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Roamies", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&starting, &quit])?;
            let mut tray = TrayIconBuilder::with_id("roamies").tooltip("Roamies").menu(&menu);
            #[cfg(target_os = "macos")]
            {
                tray = tray.title("◉");
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            register_summon(app.handle());
            build_overlays(app.handle())?;
            pump_cursor(app.handle().clone());
            spawn_sidecar(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Roamies");
}
