// Hands helper for Roamies (macOS): lets the agent see one window or app, read its controls, and type,
// press keys or click into it. One command per run; prints one JSON object. Runs as a child of Roamies,
// so macOS attributes Screen Recording and Accessibility to Roamies.
//
//   roamies-hands windows                      visible windows, front to back
//   roamies-hands capture <out.jpg> front|app:<name>|window:<id>|screen
//   roamies-hands locate front|app:<name>|window:<id>   which window that is, without capturing (for the animation)
//   roamies-hands select <out.png>             drag to choose an area (built-in macOS selection UI)
//   roamies-hands ui front|app:<name>          the window's buttons, fields, etc. with ids
//   roamies-hands act <json>                   {"app":"Brave","steps":[{"do":"focus","id":3},{"do":"type","text":"hi"}]}
//   roamies-hands trusted [--prompt]           Accessibility permission status
//   roamies-hands locate-control <target> <id>  where one control (from `ui`) is on screen, for pointing
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func out(_ o: [String: Any]) -> Never {
    let d = (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{}".utf8)
    print(String(data: d, encoding: .utf8) ?? "{}")
    exit(0)
}
func fail(_ msg: String) -> Never { out(["ok": false, "error": msg]) }

let me = ProcessInfo.processInfo.processIdentifier
let myParent = getppid()
// Never point at Roamies itself (its overlay windows cover every screen).
func isRoamies(_ pid: pid_t) -> Bool {
    pid == me || pid == myParent || NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.kenkai.roamies"
}

// ---------- windows ----------

struct Win { let id: Int; let pid: pid_t; let app: String; let title: String; let x, y, w, h: Double }

func windows() -> [Win] {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.compactMap { w in
        guard (w[kCGWindowLayer as String] as? Int) == 0,
              let id = w[kCGWindowNumber as String] as? Int,
              let pid = w[kCGWindowOwnerPID as String] as? Int32, !isRoamies(pid),
              let b = w[kCGWindowBounds as String] as? [String: Double],
              (b["Width"] ?? 0) > 80, (b["Height"] ?? 0) > 60 else { return nil }
        return Win(id: id, pid: pid, app: (w[kCGWindowOwnerName as String] as? String) ?? "?",
                   title: (w[kCGWindowName as String] as? String) ?? "", x: b["X"] ?? 0, y: b["Y"] ?? 0, w: b["Width"] ?? 0, h: b["Height"] ?? 0)
    }
}

/// Fuzzy app match: "browser" finds the frontmost known browser; otherwise a case-insensitive name match.
let BROWSERS = ["Brave Browser", "Google Chrome", "Safari", "Arc", "Firefox", "Microsoft Edge", "Opera", "Vivaldi", "Chromium", "Orion", "Zen"]
func appMatches(_ app: String, _ want: String) -> Bool {
    let w = want.lowercased().trimmingCharacters(in: .whitespaces)
    if ["browser", "web browser", "my browser"].contains(w) { return BROWSERS.contains(app) }
    let a = app.lowercased()
    return a == w || a.contains(w) || w.contains(a)
}

/// Resolves a target to a window. "front" = the frontmost app that isn't Roamies.
func resolve(_ target: String) -> Win? {
    let all = windows()
    if target == "front" {
        if let f = NSWorkspace.shared.frontmostApplication, !isRoamies(f.processIdentifier), let w = all.first(where: { $0.pid == f.processIdentifier }) { return w }
        return all.first
    }
    if target.hasPrefix("window:"), let id = Int(target.dropFirst(7)) { return all.first { $0.id == id } }
    if target.hasPrefix("app:") {
        let name = String(target.dropFirst(4))
        if let w = all.first(where: { appMatches($0.app, name) }) { return w }
        // Running but no visible window (hidden or minimised): bring it forward and look again.
        if let app = NSWorkspace.shared.runningApplications.first(where: { appMatches($0.localizedName ?? "", name) }) {
            app.unhide()
            app.activate(options: [.activateAllWindows])
            Thread.sleep(forTimeInterval: 0.6)
            return windows().first { $0.pid == app.processIdentifier }
        }
    }
    return nil
}

func winInfo(_ w: Win) -> [String: Any] { ["id": w.id, "app": w.app, "title": w.title, "bounds": [Int(w.x), Int(w.y), Int(w.w), Int(w.h)]] }

func run(_ path: String, _ args: [String]) -> Int32 {
    let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = args
    p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return -1 }
    p.waitUntilExit()
    return p.terminationStatus
}

// ---------- accessibility tree ----------

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func str(_ el: AXUIElement, _ name: String) -> String? {
    guard let v = attr(el, name) else { return nil }
    if let s = v as? String { return s.isEmpty ? nil : s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
}
func frame(_ el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return CGRect(origin: pt, size: sz)
}

let INTERACTIVE: Set<String> = ["AXButton", "AXTextField", "AXTextArea", "AXSearchField", "AXSecureTextField", "AXCheckBox", "AXRadioButton",
                                "AXPopUpButton", "AXComboBox", "AXMenuButton", "AXLink", "AXSlider", "AXTab", "AXDisclosureTriangle", "AXIncrementor"]
let ROLE_NAME: [String: String] = ["AXButton": "button", "AXTextField": "text field", "AXTextArea": "text area", "AXSearchField": "search field",
                                   "AXSecureTextField": "password field", "AXCheckBox": "checkbox", "AXRadioButton": "radio", "AXPopUpButton": "dropdown",
                                   "AXComboBox": "combo box", "AXMenuButton": "menu button", "AXLink": "link", "AXSlider": "slider", "AXTab": "tab",
                                   "AXDisclosureTriangle": "disclosure", "AXIncrementor": "stepper"]

/// Walks the focused window's tree and numbers every control. Ids are stable for the same walk, so
/// `act` re-walks and finds the same element by id (checking its label still matches).
func walk(_ app: AXUIElement, limit: Int = 260) -> [(AXUIElement, [String: Any])] {
    var win = attr(app, kAXFocusedWindowAttribute)
    if win == nil, let ws = attr(app, kAXWindowsAttribute) as? [AXUIElement] { win = ws.first }
    guard let root = win else { return [] }
    var found: [(AXUIElement, [String: Any])] = []
    var stack: [(AXUIElement, Int)] = [(root as! AXUIElement, 0)]
    var visited = 0
    while let (el, depth) = stack.popLast(), found.count < limit, visited < 6000 {
        visited += 1
        let role = str(el, kAXRoleAttribute) ?? ""
        if INTERACTIVE.contains(role), let f = frame(el), f.width > 1, f.height > 1 {
            if (attr(el, kAXEnabledAttribute) as? Bool) != false {
                var label = str(el, kAXTitleAttribute) ?? str(el, kAXDescriptionAttribute) ?? str(el, "AXPlaceholderValue") ?? str(el, kAXHelpAttribute) ?? ""
                if label.isEmpty, let t = attr(el, kAXTitleUIElementAttribute) { label = str(t as! AXUIElement, kAXValueAttribute) ?? "" }
                var item: [String: Any] = ["id": found.count + 1, "role": ROLE_NAME[role] ?? role, "label": String(label.prefix(80)),
                                           "bounds": [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)]]
                if role != "AXSecureTextField", let v = str(el, kAXValueAttribute), !v.isEmpty { item["value"] = String(v.prefix(80)) }
                if (attr(el, kAXFocusedAttribute) as? Bool) == true { item["focused"] = true }
                found.append((el, item))
            }
        }
        if depth < 40, let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
            for k in kids.reversed() { stack.append((k, depth + 1)) }
        }
    }
    return found
}

func axApp(_ w: Win) -> AXUIElement {
    let app = AXUIElementCreateApplication(w.pid)
    // Chromium and Electron only build their accessibility tree when asked to.
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    return app
}

// ---------- input ----------

let src = CGEventSource(stateID: .hidSystemState)
func typeText(_ s: String) {
    for chunk in Array(s.utf16).chunked(16) {
        var u = chunk
        let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)!, up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)!
        d.keyboardSetUnicodeString(stringLength: u.count, unicodeString: &u)
        up.keyboardSetUnicodeString(stringLength: u.count, unicodeString: &u)
        d.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.012)
    }
}
extension Array { func chunked(_ n: Int) -> [[Element]] { stride(from: 0, to: count, by: n).map { Array(self[$0 ..< Swift.min($0 + n, count)]) } } }

let KEYS: [String: CGKeyCode] = ["return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37,
    "j": 38, "k": 40, "n": 45, "m": 46, "f5": 96]
/// "cmd+a", "shift+tab", "return".
func pressKey(_ combo: String) -> Bool {
    var flags: CGEventFlags = []
    var key: CGKeyCode?
    for part in combo.lowercased().split(separator: "+").map(String.init) {
        switch part {
        case "cmd", "command": flags.insert(.maskCommand)
        case "ctrl", "control": flags.insert(.maskControl)
        case "opt", "option", "alt": flags.insert(.maskAlternate)
        case "shift": flags.insert(.maskShift)
        default: key = KEYS[part]
        }
    }
    guard let k = key else { return false }
    let d = CGEvent(keyboardEventSource: src, virtualKey: k, keyDown: true)!, u = CGEvent(keyboardEventSource: src, virtualKey: k, keyDown: false)!
    d.flags = flags; u.flags = flags
    d.post(tap: .cghidEventTap); u.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.05)
    return true
}
func click(_ p: CGPoint) {
    for t in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.04)
    }
}

// ---------- commands ----------

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("no command") }

switch cmd {
case "trusted":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: args.contains("--prompt")] as CFDictionary
    out(["ok": true, "trusted": AXIsProcessTrustedWithOptions(opts)])

case "windows":
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    out(["ok": true, "windows": windows().prefix(30).map { var i = winInfo($0); if $0.pid == front { i["frontApp"] = true }; return i }])

case "locate":
    guard args.count >= 2 else { fail("usage: locate <target>") }
    if args[1] == "screen" { out(["ok": true, "what": "screen"]) }
    guard let w = resolve(args[1]) else { fail("No matching window is open\(args[1].hasPrefix("app:") ? " for \(args[1].dropFirst(4))" : "").") }
    out(["ok": true, "window": winInfo(w)])

case "capture":
    guard args.count >= 3 else { fail("usage: capture <out> <target>") }
    let file = args[1], target = args[2]
    if target == "screen" {
        guard run("/usr/sbin/screencapture", ["-x", "-t", "jpg", file]) == 0 else { fail("Screen capture failed. Roamies may need Screen Recording permission.") }
        // screencapture with one file shoots the main display; its bounds (points) let the caller map pixels back.
        let d = CGDisplayBounds(CGMainDisplayID())
        out(["ok": true, "file": file, "what": "screen", "bounds": [Int(d.minX), Int(d.minY), Int(d.width), Int(d.height)]])
    }
    guard let w = resolve(target) else { fail("No matching window is open\(target.hasPrefix("app:") ? " for \(target.dropFirst(4))" : "").") }
    guard run("/usr/sbin/screencapture", ["-x", "-o", "-t", "jpg", "-l", String(w.id), file]) == 0 else { fail("Window capture failed. Roamies may need Screen Recording permission.") }
    out(["ok": true, "file": file, "window": winInfo(w)])

case "select":
    guard args.count >= 2 else { fail("usage: select <out>") }
    // macOS's own crosshair: drag an area, or press Space to pick a window. Esc cancels (no file).
    _ = run("/usr/sbin/screencapture", ["-i", "-s", "-x", "-t", "png", args[1]])
    let ok = FileManager.default.fileExists(atPath: args[1])
    out(ok ? ["ok": true, "file": args[1]] : ["ok": false, "cancelled": true])

case "ui":
    guard AXIsProcessTrusted() else { fail("Roamies needs Accessibility permission to read other apps.") }
    guard args.count >= 2, let w = resolve(args[1]) else { fail("No matching window is open.") }
    let items = walk(axApp(w)).map { $0.1 }
    out(["ok": true, "window": winInfo(w), "controls": items, "note": items.isEmpty ? "This app shares no controls. Use a screenshot plus click at coordinates instead." : ""])

case "locate-control":
    guard AXIsProcessTrusted() else { fail("Roamies needs Accessibility permission to read other apps.") }
    guard args.count >= 3, let w = resolve(args[1]), let id = Int(args[2]) else { fail("usage: locate-control <target> <id>") }
    let items = walk(axApp(w))
    guard id >= 1, id <= items.count else { fail("No control \(id) in \(w.app). Read the window again.") }
    out(["ok": true, "window": winInfo(w), "control": items[id - 1].1])

case "act":
    guard AXIsProcessTrusted() else { fail("Roamies needs Accessibility permission to control other apps.") }
    guard args.count >= 2, let data = args[1].data(using: .utf8),
          let plan = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let steps = plan["steps"] as? [[String: Any]] else { fail("bad plan") }
    let target = (plan["app"] as? String).map { "app:\($0)" } ?? "front"
    guard let w = resolve(target) else { fail("No matching window is open.") }
    // Bring the target app forward so keystrokes land there, not in Roamies.
    NSRunningApplication(processIdentifier: w.pid)?.activate(options: [])
    Thread.sleep(forTimeInterval: 0.35)
    let app = axApp(w)
    var controls = walk(app)
    var done: [String] = []
    func el(_ s: [String: Any]) -> (AXUIElement, [String: Any])? {
        guard let id = s["id"] as? Int, id >= 1, id <= controls.count else { return nil }
        return controls[id - 1]
    }
    for (i, s) in steps.enumerated() {
        let what = s["do"] as? String ?? ""
        switch what {
        case "focus", "click", "set", "press_button":
            guard let (e, info) = el(s) else { out(["ok": false, "error": "Step \(i + 1): no control with id \(s["id"] ?? "?"). Call read_window again.", "done": done]) }
            if what == "set", let text = s["text"] as? String {
                // Prefer setting the value directly; fall back to focusing and typing (web forms often need real keystrokes).
                AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                let r = AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, text as CFString)
                if r != .success || str(e, kAXValueAttribute) != text {
                    if let f = frame(e) { click(CGPoint(x: f.midX, y: f.midY)) }
                    _ = pressKey("cmd+a"); typeText(text)
                }
                done.append("set \(info["label"] ?? "field \(info["id"]!)")")
            } else if what == "focus" {
                AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                if let f = frame(e) { click(CGPoint(x: f.midX, y: f.midY)) }
                done.append("focused \(info["label"] ?? "field")")
            } else {
                if AXUIElementPerformAction(e, kAXPressAction as CFString) != .success, let f = frame(e) { click(CGPoint(x: f.midX, y: f.midY)) }
                done.append("clicked \(info["label"] ?? "control")")
            }
            Thread.sleep(forTimeInterval: 0.15)
            if what == "click" || what == "press_button" { controls = walk(app) }
        case "type":
            typeText(s["text"] as? String ?? ""); done.append("typed text")
        case "key":
            guard pressKey(s["key"] as? String ?? "") else { out(["ok": false, "error": "Step \(i + 1): unknown key \(s["key"] ?? "")", "done": done]) }
            done.append("pressed \(s["key"]!)")
        case "click_at":
            // Points relative to the window's top-left, or global screen points when "global" is set.
            guard let x = s["x"] as? Double, let y = s["y"] as? Double else { out(["ok": false, "error": "Step \(i + 1): click_at needs x and y", "done": done]) }
            let global = s["global"] as? Bool ?? false
            click(global ? CGPoint(x: x, y: y) : CGPoint(x: w.x + x, y: w.y + y)); done.append("clicked at \(Int(x)),\(Int(y))")
        case "wait":
            Thread.sleep(forTimeInterval: min(5, (s["seconds"] as? Double) ?? 0.5)); done.append("waited")
        default:
            out(["ok": false, "error": "Step \(i + 1): unknown action \(what)", "done": done])
        }
    }
    out(["ok": true, "done": done, "window": winInfo(w)])

default:
    fail("unknown command \(cmd)")
}
