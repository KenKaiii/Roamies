import AppKit

// Whether a shown panel is really being drawn, and building it again when it isn't. A panel that joins every Space
// (.canJoinAllSpaces) has been seen to end up on one desktop only: it is ordered front and fades to alpha 1 beside the
// cursor, but on the desktop the user is on the window server reports it off screen, so nothing shows until a new panel
// is made. NSWindow.isOnActiveSpace can't tell: it says true for such a panel in every state, even one never ordered in
// or already ordered out. So the window server is asked a moment after the panel is shown, and the panel is built again
// once if it isn't on screen. What sets it off isn't known; this recovers from it. The listening pill (wave.swift), the
// drawing layer (ink.swift) and the sidekick (buddy.swift) each call checkOnScreen right after ordering their panel front.

/// How long after the call to look. The window server doesn't have the order-in until the run-loop turn that ordered
/// the panel front ends, and that turn can go on: the drawing layer is armed just before the mic is started in the same
/// turn (main.swift's arm(); longer with Bluetooth). Once it has the order-in, the window server reports the panel on
/// screen within about 20 ms. The pill fades in over 0.14 s.
private let onScreenDelay = 0.2
/// If that turn runs past onScreenDelay, the look comes just after it ends, possibly before the window server has the
/// order-in, and can find the panel off screen. So a look that finds it off is checked again this much later, in a turn
/// of its own, and only a second "off" builds the panel again.
private let onScreenConfirm = 0.1

/// The latest show of each panel, by name, so a look left over from an earlier show does nothing.
private var onScreenShows: [String: Int] = [:]

/// Call right after ordering a panel front. `panels`: its window(s) while it is still shown, none once it isn't.
/// `rebuild`: build it again and order the new one front. A show builds its panel again at most once, so it never loops.
func checkOnScreen(_ name: String, _ panels: @escaping () -> [NSWindow], rebuild: @escaping () -> Void) {
    watchOnScreen(name, { panels().map { (ObjectIdentifier($0), $0.windowNumber) } }, rebuild: rebuild)
}

/// checkOnScreen's looks. `panels`: each shown window's identity and number. The window server's answer, whether a
/// display is attached and the clock are passed in, so --test-spaces can run the looks on made-up answers and time.
func watchOnScreen(_ name: String, _ panels: @escaping () -> [(ObjectIdentifier, Int)],
                   read: @escaping (Int) -> Bool? = windowOnScreen,
                   screenAttached: @escaping () -> Bool = { !currentScreenKeys().isEmpty },
                   after: @escaping (Double, @escaping () -> Void) -> Void = { DispatchQueue.main.asyncAfter(deadline: .now() + $0, execute: $1) },
                   rebuild: @escaping () -> Void) {
    let show = (onScreenShows[name] ?? 0) + 1
    onScreenShows[name] = show
    // One look, `delay` from now, if this is still the latest show and the same panel is still shown.
    func look(_ stage: OnScreenStage, in delay: Double) {
        let ids = panels().map { $0.0 }
        guard !ids.isEmpty else { return }
        after(delay) {
            let now = panels()
            guard onScreenShows[name] == show, now.map({ $0.0 }) == ids else { return }
            let step = onScreenStep(name, stage, onScreen: now.map { read($0.1) }, screenAttached: screenAttached())
            if let line = step.line { log(line) }
            switch step.next {
            case .done: break
            case .confirm: look(.confirm, in: onScreenConfirm)
            case .rebuild: rebuild(); look(.rebuilt, in: onScreenDelay)
            }
        }
    }
    look(.first, in: onScreenDelay)
}

/// Which look: the first, a moment after the panel was shown; the second, after a first look found it off screen; or
/// the one after this show built it again.
enum OnScreenStage { case first, confirm, rebuilt }

/// What a look leads to: nothing more, a second look, or building the panel again.
enum OnScreenNext { case done, confirm, rebuild }

/// What one look at a shown panel decides, from the window server's answer for each of its windows (nil: no answer),
/// and the line to log, if any. Only a window reported off screen counts, and never with no display attached (an asleep
/// display reports none, and a panel can look off screen then). A first look that finds one off only asks for a second;
/// the panel is built again when that one finds it off too. After a rebuild a look only says how the new one came out.
func onScreenStep(_ name: String, _ stage: OnScreenStage, onScreen: [Bool?], screenAttached: Bool) -> (line: String?, next: OnScreenNext) {
    let off = screenAttached && onScreen.contains(false)
    switch stage {
    case .first: return (nil, off ? .confirm : .done)
    case .confirm: return off ? ("\(name): not on screen after being shown, building it again", .rebuild) : (nil, .done)
    case .rebuilt:
        if onScreen.contains(false) { return ("\(name): still not on screen after being built again", .done) }
        if !onScreen.isEmpty && onScreen.allSatisfy({ $0 == true }) { return ("\(name): on screen after being built again", .done) }
        return (nil, .done)
    }
}

/// The window server's own answer for one of this process's windows: kCGWindowIsOnscreen, which needs no permission for
/// the app's own windows. nil when it gives none (no such window). It leaves the key out for a window that is off
/// screen. It stays true at alpha 0, so a panel hidden by its alpha doesn't read as off screen.
func windowOnScreen(_ number: Int) -> Bool? {
    guard number > 0, number <= Int(UInt32.max), let id = UnsafeRawPointer(bitPattern: number) else { return nil }
    var ids: [UnsafeRawPointer?] = [id]
    guard let array = CFArrayCreate(nil, &ids, 1, nil),
          let list = CGWindowListCreateDescriptionFromArray(array) as? [[String: Any]],
          let d = list.first(where: { ($0[kCGWindowNumber as String] as? Int) == number }) else { return nil }
    return (d[kCGWindowIsOnscreen as String] as? Bool) ?? false
}
