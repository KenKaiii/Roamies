import AppKit
import WebKit

final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class RoamiesApp: NSObject, WKScriptMessageHandler {
    static let all = ["jelly", "ascii-goop", "mercury", "ascii-ghost", "nebula",
                      "neon-noodle", "ascii-medusa", "fluff", "bubble", "dither"]
    // `open Roamies.app --args sidekick` shows only the named roamies.
    static let ids: [String] = {
        let picked = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
        return picked.isEmpty ? all : Array(picked)
    }()
    let web = Bundle.main.resourceURL!.appendingPathComponent("web")
    let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var overlays: [(panel: OverlayPanel, view: WKWebView)] = []
    var timer: Timer?

    override init() {
        super.init()
        status.button?.title = "◉"
        let menu = NSMenu()
        menu.addItem(withTitle: "Reload Roamies", action: #selector(build), keyEquivalent: "r").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Roamies", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        status.menu = menu
        build()
        NotificationCenter.default.addObserver(self, selector: #selector(build),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let t = Timer(timeInterval: 1.0 / 60, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    @objc func build() {
        overlays.forEach { $0.panel.close() }
        overlays.removeAll()
        let screens = NSScreen.screens
        for (i, screen) in screens.enumerated() {
            let mine = Self.ids.enumerated().filter { $0.offset % screens.count == i }.map { "\"\($0.element)\"" }
            guard !mine.isEmpty else { continue }
            let panel = OverlayPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel],
                                     backing: .buffered, defer: false)
            panel.setFrame(screen.frame, display: false)
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.level = .screenSaver
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            panel.hidesOnDeactivate = false
            panel.ignoresMouseEvents = true

            let config = WKWebViewConfiguration()
            config.mediaTypesRequiringUserActionForPlayback = []
            let boot = "window.ROAMIE_ONLY = [\(mine.joined(separator: ","))]; window.ROAMIE_AUTOSOUND = true; window.ROAMIE_UNIT = 400;" +
                "addEventListener('error', e => webkit.messageHandlers.log.postMessage(e.message + ' @' + e.filename + ':' + e.lineno));"
            config.userContentController.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            config.userContentController.add(self, name: "log")
            let view = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: config)
            view.setValue(false, forKey: "drawsBackground")
            view.autoresizingMask = [.width, .height]
            panel.contentView = view
            view.loadFileURL(web.appendingPathComponent("desktop.html"), allowingReadAccessTo: web)
            panel.orderFrontRegardless()
            overlays.append((panel, view))
        }
    }

    // Feed the real cursor in; only accept clicks while it is over a roamie (or dragging one).
    @objc func tick() {
        let mouse = NSEvent.mouseLocation
        for o in overlays {
            let f = o.panel.frame
            let js = "window.Roamie && Roamie.ptr ? Roamie.ptr(\(mouse.x - f.minX), \(f.maxY - mouse.y)) : false"
            let panel = o.panel
            o.view.evaluateJavaScript(js) { result, _ in
                let hot = (result as? Bool) ?? false
                MainActor.assumeIsolated {
                    if panel.ignoresMouseEvents == hot { panel.ignoresMouseEvents = !hot }
                }
            }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        print("[roamies] \(message.body)")
        fflush(stdout)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let roamies = MainActor.assumeIsolated { RoamiesApp() }
app.run()
