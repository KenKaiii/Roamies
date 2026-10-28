import AppKit
import QuartzCore

extension CGPoint {
    static func + (a: CGPoint, b: CGVector) -> CGPoint { CGPoint(x: a.x + b.dx, y: a.y + b.dy) }
    static func - (a: CGPoint, b: CGPoint) -> CGVector { CGVector(dx: a.x - b.x, dy: a.y - b.y) }
}

extension CGVector {
    var length: CGFloat { hypot(dx, dy) }
    var normalized: CGVector { let l = length; return l > 0 ? CGVector(dx: dx / l, dy: dy / l) : .zero }
    static func * (v: CGVector, s: CGFloat) -> CGVector { CGVector(dx: v.dx * s, dy: v.dy * s) }
}

final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class BlobView: NSView {
    static let groundY: CGFloat = 14
    var look = CGVector.zero
    var squash: CGFloat = 0
    var hop: CGFloat = 0
    var blink: CGFloat = 0
    var scale: CGFloat = 1
    var message: String?
    var onPress: (() -> Void)?
    var onDrag: (() -> Void)?
    var onRelease: (() -> Void)?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onPress?() }
    override func mouseDragged(with event: NSEvent) { onDrag?() }
    override func mouseUp(with event: NSEvent) { onRelease?() }

    var bodyRect: CGRect {
        let base = 72 * scale
        let w = base * (1 + squash * 0.2)
        let h = base * (1 - squash * 0.2)
        return CGRect(x: bounds.midX - w / 2, y: Self.groundY + hop, width: w, height: h)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let body = bodyRect

        let s = max(0.4, 1 - hop / 120)
        ctx.setFillColor(NSColor.black.withAlphaComponent(0.22 * s).cgColor)
        ctx.fillEllipse(in: CGRect(x: bounds.midX - body.width * 0.42 * s, y: Self.groundY - 5,
                                   width: body.width * 0.84 * s, height: 10))

        let path = CGPath(roundedRect: body, cornerWidth: body.width * 0.48, cornerHeight: body.height * 0.5, transform: nil)
        ctx.saveGState()
        ctx.addPath(path)
        ctx.clip()
        let colors = [NSColor(calibratedRed: 0.55, green: 0.86, blue: 1, alpha: 1).cgColor,
                      NSColor(calibratedRed: 0.24, green: 0.52, blue: 0.98, alpha: 1).cgColor] as CFArray
        let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
        ctx.drawLinearGradient(gradient, start: CGPoint(x: body.midX, y: body.maxY),
                               end: CGPoint(x: body.midX, y: body.minY), options: [])
        ctx.setFillColor(NSColor.white.withAlphaComponent(0.4).cgColor)
        ctx.fillEllipse(in: CGRect(x: body.minX + body.width * 0.18, y: body.maxY - body.height * 0.3,
                                   width: body.width * 0.22, height: body.height * 0.13))
        ctx.restoreGState()
        ctx.addPath(path)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.1, green: 0.28, blue: 0.7, alpha: 0.9).cgColor)
        ctx.setLineWidth(2)
        ctx.strokePath()

        let eyeW = body.width * 0.2
        let eyeH = body.height * 0.26 * (1 - blink * 0.9)
        let eyeY = body.minY + body.height * 0.52
        for side: CGFloat in [-1, 1] {
            let ex = body.midX + side * body.width * 0.17
            ctx.setFillColor(NSColor.white.cgColor)
            ctx.fillEllipse(in: CGRect(x: ex - eyeW / 2, y: eyeY - eyeH / 2, width: eyeW, height: eyeH))
            guard blink < 0.6 else { continue }
            let r = eyeW * 0.28
            let px = ex + look.dx * (eyeW / 2 - r - 1)
            let py = eyeY + look.dy * (eyeH / 2 - r - 1)
            ctx.setFillColor(NSColor(calibratedWhite: 0.08, alpha: 1).cgColor)
            ctx.fillEllipse(in: CGRect(x: px - r, y: py - r, width: r * 2, height: r * 2))
        }

        if let message { drawBubble(message, above: body, in: ctx) }
    }

    private func drawBubble(_ text: String, above body: CGRect, in ctx: CGContext) {
        let str = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: NSColor.black,
        ])
        let size = str.size()
        let pad: CGFloat = 10
        var box = CGRect(x: body.midX - size.width / 2 - pad, y: body.maxY + 14,
                         width: size.width + pad * 2, height: size.height + pad * 1.2)
        box.origin.x = max(4, min(bounds.width - box.width - 4, box.origin.x))
        let bubble = CGPath(roundedRect: box, cornerWidth: 12, cornerHeight: 12, transform: nil)
        ctx.setFillColor(NSColor.white.withAlphaComponent(0.96).cgColor)
        ctx.addPath(bubble)
        ctx.fillPath()
        ctx.move(to: CGPoint(x: body.midX - 6, y: box.minY))
        ctx.addLine(to: CGPoint(x: body.midX + 6, y: box.minY))
        ctx.addLine(to: CGPoint(x: body.midX, y: box.minY - 8))
        ctx.closePath()
        ctx.fillPath()
        ctx.addPath(bubble)
        ctx.setStrokeColor(NSColor.black.withAlphaComponent(0.15).cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()
        str.draw(at: CGPoint(x: box.minX + pad, y: box.minY + pad * 0.6))
    }
}

@MainActor
final class Roamer: NSObject {
    enum Mode { case wandering, comingToCursor, summoned, held, flung }

    // The window is only the size of the character and moves itself, so it can go anywhere
    // on any display while everything outside it stays clickable.
    let size = CGSize(width: 260, height: 260)
    let panel: Panel
    let view: BlobView
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    var feet: CGPoint
    var target: CGPoint
    var mode = Mode.wandering
    var resting = true
    var idleUntil: CFTimeInterval = 0
    var velocity = CGVector.zero
    var walkPhase: CGFloat = 0
    var hopT: CGFloat = -1
    var blinkT: CGFloat = -1
    var nextBlink: CFTimeInterval = 0
    var messageUntil: CFTimeInterval = 0
    var targetScale: CGFloat = 1
    var last = CACurrentMediaTime()
    var dragOffset = CGVector.zero
    var dragStart = CGPoint.zero
    var lastDragTime: CFTimeInterval = 0
    var timer: Timer?

    override init() {
        view = BlobView(frame: NSRect(origin: .zero, size: size))
        panel = Panel(contentRect: NSRect(origin: .zero, size: size),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        let main = NSScreen.main?.frame ?? .zero
        feet = CGPoint(x: main.midX, y: main.midY)
        target = feet
        super.init()

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.contentView = view
        placeWindow()
        panel.orderFrontRegardless()

        view.onPress = { [weak self] in self?.press() }
        view.onDrag = { [weak self] in self?.drag() }
        view.onRelease = { [weak self] in self?.release() }

        setUpMenu()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        say("hi! I live here now 👋", for: 3)
        idleUntil = CACurrentMediaTime() + 2

        let t = Timer(timeInterval: 1.0 / 60, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func setUpMenu() {
        statusItem.button?.title = "🫧"
        let menu = NSMenu()
        menu.addItem(withTitle: "Come here", action: #selector(comeHere), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Summon (center stage)", action: #selector(summon), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Go wander", action: #selector(wander), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Roamie", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    // MARK: Menu actions

    @objc func comeHere() {
        let m = NSEvent.mouseLocation
        target = CGPoint(x: m.x, y: m.y - 40)
        mode = .comingToCursor
        resting = false
        idleUntil = 0
        targetScale = 1
    }

    @objc func summon() {
        let f = NSScreen.main?.frame ?? .zero
        target = CGPoint(x: f.midX, y: f.midY - 80)
        mode = .summoned
        resting = false
        idleUntil = 0
        say("Time to hit record. 🎬", for: .infinity)
    }

    @objc func wander() {
        mode = .wandering
        targetScale = 1
        view.message = nil
        resting = true
        idleUntil = 0
    }

    @objc func screensChanged() {
        if !onAnyScreen(feet) { target = randomSpot(); resting = false; idleUntil = 0 }
    }

    // MARK: Mouse

    func press() {
        mode = .held
        dragStart = NSEvent.mouseLocation
        dragOffset = feet - dragStart
        velocity = .zero
        lastDragTime = CACurrentMediaTime()
    }

    func drag() {
        let now = CACurrentMediaTime()
        let next = NSEvent.mouseLocation + dragOffset
        let dt = max(0.001, now - lastDragTime)
        let instant = (next - feet) * CGFloat(1 / dt)
        velocity = CGVector(dx: velocity.dx * 0.5 + instant.dx * 0.5, dy: velocity.dy * 0.5 + instant.dy * 0.5)
        feet = next
        lastDragTime = now
        view.squash = max(-0.3, min(0.3, velocity.dx / 4000))
    }

    func release() {
        let moved = (NSEvent.mouseLocation - dragStart).length
        if moved < 4 {
            if targetScale > 1 { wander(); say("ok ok, later 😅", for: 2) } else { boop() }
            mode = .wandering
            target = feet
            resting = true
            idleUntil = CACurrentMediaTime() + 1.5
        } else if CACurrentMediaTime() - lastDragTime < 0.08, velocity.length > 300 {
            mode = .flung
            say("wheee!", for: 1.2)
        } else {
            mode = .wandering
            target = feet
            resting = true
            idleUntil = CACurrentMediaTime() + 1
        }
    }

    func boop() {
        hopT = 0
        say(["hi!", "boop", "hehe", "👀", "what are we building?"].randomElement()!, for: 1.6)
    }

    // MARK: Loop

    @objc func tick() {
        let now = CACurrentMediaTime()
        let dt = CGFloat(min(0.05, now - last))
        last = now
        isWalking = false

        switch mode {
        case .held:
            break
        case .flung:
            velocity = velocity * pow(0.05, dt)
            feet = feet + velocity * dt
            bounceOffEdges()
            if velocity.length < 40 {
                mode = .wandering
                target = onAnyScreen(feet) ? feet : randomSpot()
                resting = onAnyScreen(feet)
                idleUntil = now + 0.8
            }
        case .wandering, .comingToCursor, .summoned:
            walk(now: now, dt: dt)
        }

        relax(dt)
        animateHop(dt)
        animateBlink(now: now, dt: dt)
        view.scale += (targetScale - view.scale) * min(1, dt * 6)

        let eyes = feet + CGVector(dx: 0, dy: 40 * view.scale)
        let toMouse = NSEvent.mouseLocation - eyes
        view.look = toMouse.normalized * min(1, toMouse.length / 150)

        if view.message != nil, now > messageUntil { view.message = nil }
        // Only the blob itself catches the mouse; the rest of its window passes clicks through.
        let body = view.bodyRect.offsetBy(dx: panel.frame.minX, dy: panel.frame.minY).insetBy(dx: -6, dy: -6)
        let ignore = mode != .held && !body.contains(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents != ignore { panel.ignoresMouseEvents = ignore }
        placeWindow()
        view.needsDisplay = true
    }

    private var isWalking = false

    private func walk(now: CFTimeInterval, dt: CGFloat) {
        let to = target - feet
        let d = to.length
        isWalking = false
        if d > 2, now >= idleUntil {
            let speed: CGFloat = mode == .wandering ? 170 : 480
            let step = min(d, speed * dt * min(1, d / 60 + 0.35))
            feet = feet + to.normalized * step
            walkPhase += dt * 13
            view.squash = sin(walkPhase) * 0.12
            if hopT < 0 { view.hop = abs(sin(walkPhase)) * 7 }
            isWalking = true
            return
        }
        guard d <= 2 else { return }
        switch mode {
        case .comingToCursor:
            say("you called? 👋", for: 2)
            hopT = 0
            mode = .wandering
            resting = true
            idleUntil = now + 3
        case .summoned:
            targetScale = 1.7
        case .wandering:
            if !resting {
                resting = true
                idleUntil = now + .random(in: 0.8...3.5)
            } else if now >= idleUntil {
                resting = false
                target = Double.random(in: 0...1) < 0.25 ? nearCursor() : randomSpot()
            }
        default:
            break
        }
    }

    private func relax(_ dt: CGFloat) {
        guard !isWalking else { return }
        view.squash += (0 - view.squash) * min(1, dt * 10)
        if hopT < 0 { view.hop += (0 - view.hop) * min(1, dt * 12) }
    }

    private func animateHop(_ dt: CGFloat) {
        guard hopT >= 0 else { return }
        hopT += dt / 0.5
        if hopT >= 1 { hopT = -1; view.hop = 0; return }
        view.hop = sin(.pi * hopT) * 60
        view.squash = hopT < 0.15 ? 0.25 : -0.12
    }

    private func animateBlink(now: CFTimeInterval, dt: CGFloat) {
        if blinkT < 0, now >= nextBlink { blinkT = 0 }
        guard blinkT >= 0 else { return }
        blinkT += dt / 0.16
        view.blink = sin(.pi * min(1, blinkT))
        if blinkT >= 1 { blinkT = -1; view.blink = 0; nextBlink = now + .random(in: 2...5) }
    }

    // MARK: Helpers

    func say(_ text: String, for seconds: Double) {
        view.message = text
        messageUntil = CACurrentMediaTime() + seconds
    }

    private func placeWindow() {
        let origin = CGPoint(x: (feet.x - size.width / 2).rounded(), y: (feet.y - BlobView.groundY).rounded())
        if panel.frame.origin != origin { panel.setFrameOrigin(origin) }
    }

    private func onAnyScreen(_ p: CGPoint) -> Bool {
        NSScreen.screens.contains { $0.frame.insetBy(dx: -1, dy: -1).contains(p) }
    }

    private func spotBounds(_ s: NSScreen) -> CGRect {
        let f = s.frame
        return CGRect(x: f.minX + 50, y: f.minY + 4, width: f.width - 100, height: f.height - 130)
    }

    private func randomSpot() -> CGPoint {
        let screens = NSScreen.screens
        let total = screens.reduce(0) { $0 + $1.frame.width * $1.frame.height }
        var r = CGFloat.random(in: 0..<max(1, total))
        var pick = screens.first
        for s in screens {
            let area = s.frame.width * s.frame.height
            if r < area { pick = s; break }
            r -= area
        }
        guard let pick else { return feet }
        let b = spotBounds(pick)
        return CGPoint(x: .random(in: b.minX...b.maxX), y: .random(in: b.minY...b.maxY))
    }

    private func nearCursor() -> CGPoint {
        let m = NSEvent.mouseLocation
        let p = CGPoint(x: m.x + .random(in: -160...160), y: m.y - .random(in: 60...140))
        guard let s = NSScreen.screens.first(where: { $0.frame.contains(m) }) else { return randomSpot() }
        let b = spotBounds(s)
        return CGPoint(x: min(max(p.x, b.minX), b.maxX), y: min(max(p.y, b.minY), b.maxY))
    }

    private func bounceOffEdges() {
        let all = NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
        let b = CGRect(x: all.minX + 40, y: all.minY + 2, width: all.width - 80, height: all.height - 110)
        if feet.x < b.minX || feet.x > b.maxX { velocity.dx *= -0.6; feet.x = min(max(feet.x, b.minX), b.maxX) }
        if feet.y < b.minY || feet.y > b.maxY { velocity.dy *= -0.6; feet.y = min(max(feet.y, b.minY), b.maxY) }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let roamer = MainActor.assumeIsolated { Roamer() }
app.run()
