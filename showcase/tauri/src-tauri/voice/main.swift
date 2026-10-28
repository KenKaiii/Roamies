// Voice helper for Roamies (macOS). Watches ⌃⌥, captures the mic and transcribes on-device with
// Apple's SpeechAnalyzer (macOS 26+, works with Siri and Dictation off; SFSpeechRecognizer before that).
// A session never ends while ⌃⌥ is held: it ends on release (push-to-talk), or for hands-free
// (quick tap) on a pause or the next press-and-release. Hold ⌃⌥ = push-to-talk (release sends). Quick tap = hands-free
// (ends on a pause or another tap). JSON lines on stdout; exits when stdin closes.
// Modifier state is read with CGEventSource, which needs no Input Monitoring permission.
import AVFoundation
import CoreGraphics
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

func log(_ s: String) {
    FileHandle.standardError.write(Data("[voice] \(s)\n".utf8))
}

let dryRun = ProcessInfo.processInfo.environment["ROAMIES_VOICE_DRYRUN"] == "1"
func uptime() -> Double { ProcessInfo.processInfo.systemUptime }

// One recognition session. Callbacks always arrive on the main queue.
protocol Recognizer: AnyObject {
    func append(_ buffer: AVAudioPCMBuffer)
    func end()
    func cancel()
}
struct RecognizerCallbacks {
    let onText: (String) -> Void
    let onDone: () -> Void
    let onError: (Error) -> Void
}

// macOS 26+: SpeechAnalyzer + SpeechTranscriber. Model assets are shared system-wide and
// downloaded on first use; the locale and audio format are resolved once and reused.
@available(macOS 26, *)
final class AnalyzerRecognizer: Recognizer {
    private static var prepared: Task<(Locale, AVAudioFormat?), Error>?
    static func prepare() -> Task<(Locale, AVAudioFormat?), Error> {
        if let p = prepared { return p }
        let t = Task { () throws -> (Locale, AVAudioFormat?) in
            let want = Locale.current
            var locale = await SpeechTranscriber.supportedLocale(equivalentTo: want)
            if locale == nil { locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US")) }
            let resolved = locale ?? Locale(identifier: "en-US")
            let probe = SpeechTranscriber(locale: resolved, preset: .progressiveTranscription)
            if let req = try await AssetInventory.assetInstallationRequest(supporting: [probe]) {
                log("downloading speech model for \(resolved.identifier)")
                try await req.downloadAndInstall()
            }
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [probe])
            log("speech analyzer ready: \(resolved.identifier) \(format.map { "\($0.sampleRate)Hz" } ?? "native")")
            return (resolved, format)
        }
        prepared = t
        return t
    }

    private let raw: AsyncStream<AVAudioPCMBuffer>.Continuation
    private var work: Task<Void, Never>?
    private var finalized = "", volatile = ""

    init(_ cb: RecognizerCallbacks) {
        let (stream, cont) = AsyncStream<AVAudioPCMBuffer>.makeStream()
        raw = cont
        work = Task { [weak self] in
            do {
                let (locale, format) = try await Self.prepare().value
                let tr = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
                let analyzer = SpeechAnalyzer(modules: [tr])
                var converter: AVAudioConverter?
                let inputs = AsyncStream<AnalyzerInput> { out in
                    Task {
                        for await buf in stream {
                            if let format, buf.format != format {
                                if converter == nil || converter?.inputFormat != buf.format { converter = AVAudioConverter(from: buf.format, to: format) }
                                if let c = converter, let conv = Self.convert(buf, with: c, to: format) { out.yield(AnalyzerInput(buffer: conv)) }
                            } else {
                                out.yield(AnalyzerInput(buffer: buf))
                            }
                        }
                        out.finish()
                    }
                }
                try await analyzer.start(inputSequence: inputs)
                let reader = Task {
                    for try await r in tr.results {
                        let text = String(r.text.characters)
                        guard let self else { return }
                        if r.isFinal { self.finalized = Self.join(self.finalized, text); self.volatile = "" } else { self.volatile = text }
                        let shown = Self.join(self.finalized, self.volatile).trimmingCharacters(in: .whitespaces)
                        DispatchQueue.main.async { cb.onText(shown) }
                    }
                }
                // Hold until the user stops talking (end()), then flush what's left.
                await self?.waitForEnd()
                try await analyzer.finalizeAndFinishThroughEndOfInput()
                try await reader.value
                DispatchQueue.main.async { cb.onDone() }
            } catch is CancellationError {
            } catch {
                DispatchQueue.main.async { cb.onError(error) }
            }
        }
    }

    private var ended = false, endWaiters: [CheckedContinuation<Void, Never>] = []
    private func waitForEnd() async {
        await withCheckedContinuation { c in
            DispatchQueue.main.async { if self.ended { c.resume() } else { self.endWaiters.append(c) } }
        }
    }

    private static func join(_ a: String, _ b: String) -> String {
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return a.hasSuffix(" ") || b.hasPrefix(" ") ? a + b : a + " " + b
    }

    private static func convert(_ buf: AVAudioPCMBuffer, with c: AVAudioConverter, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let cap = AVAudioFrameCount(Double(buf.frameLength) * format.sampleRate / buf.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return nil }
        var fed = false
        var err: NSError?
        c.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return buf
        }
        return err == nil && out.frameLength > 0 ? out : nil
    }

    func append(_ buffer: AVAudioPCMBuffer) { raw.yield(buffer) }
    func end() {
        raw.finish()
        DispatchQueue.main.async { self.ended = true; self.endWaiters.forEach { $0.resume() }; self.endWaiters = [] }
    }
    func cancel() {
        raw.finish()
        work?.cancel()
        DispatchQueue.main.async { self.ended = true; self.endWaiters.forEach { $0.resume() }; self.endWaiters = [] }
    }
}

// Before macOS 26: SFSpeechRecognizer. Needs Siri or Dictation turned on in System Settings.
final class LegacyRecognizer: Recognizer {
    private let req = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?

    init?(_ cb: RecognizerCallbacks) {
        guard let rec = SFSpeechRecognizer() ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")), rec.isAvailable else { return nil }
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { req.addsPunctuation = true }
        req.taskHint = .dictation
        req.contextualStrings = ["Sidekick", "Skool", "Yaatuber", "Roamies", "YouTube", "TikTok"]
        task = rec.recognitionTask(with: req) { result, error in
            DispatchQueue.main.async {
                if let result {
                    cb.onText(result.bestTranscription.formattedString)
                    if result.isFinal { cb.onDone() }
                }
                if let error { cb.onError(error) }
            }
        }
    }
    func append(_ buffer: AVAudioPCMBuffer) { req.append(buffer) }
    func end() { req.endAudio() }
    func cancel() { task?.cancel(); task = nil }
}

final class Voice {
    enum Phase { case idle, armed, holding, handsFree, finishing }

    private var phase = Phase.idle
    private var chordAt = 0.0, listenAt = 0.0, heardAt = 0.0, voiceAt = 0.0, levelAt = 0.0, releasedAt: Double?
    private var blocked = false, prevChord = false, authorizing = false, reportEmpty = false, failed = false
    private var engine: AVAudioEngine?
    private var rec: Recognizer?
    private var best = ""
    private var finishTimer: Timer?
    private var useAnalyzer: Bool { if #available(macOS 26, *) { return SpeechTranscriber.isAvailable } else { return false } }

    init() {
        // Resolve the locale and fetch the model up front so the first ⌃⌥ is instant.
        if #available(macOS 26, *), SpeechTranscriber.isAvailable { _ = AnalyzerRecognizer.prepare() }
    }

    private static let modifierKeys: Set<CGKeyCode> = [0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F]
    private static let tapLimit = 0.25
    // A release must last this long to count, so one glitchy frame of key state can't end a session.
    private static let releaseDebounce = 0.09
    private static let pauseEnds = 1.5
    private static let maxSession = 60.0

    var engineName: String { useAnalyzer ? "speechanalyzer" : "sfspeech" }

    // ---------- hotkey ----------

    private func otherKeyDown() -> Bool {
        for code in CGKeyCode(0) ..< 0x80 where !Self.modifierKeys.contains(code) {
            if CGEventSource.keyState(.combinedSessionState, key: code) { return true }
        }
        return false
    }

    func tick() {
        let now = uptime()
        let f = CGEventSource.flagsState(.combinedSessionState)
        let ctrl = f.contains(.maskControl), opt = f.contains(.maskAlternate)
        let extra = f.contains(.maskCommand) || f.contains(.maskShift)
        let chord = ctrl && opt && !extra
        let down = ctrl && opt // once talking, a stray ⇧/⌘ doesn't count as letting go
        defer { prevChord = chord }
        if !ctrl && !opt { blocked = false }

        // Debounced release: true only once ⌃⌥ has been up for releaseDebounce.
        let released: Bool = {
            if down { releasedAt = nil; return false }
            if releasedAt == nil { releasedAt = now }
            return now - (releasedAt ?? now) >= Self.releaseDebounce
        }()

        switch phase {
        case .idle:
            if chord && !prevChord && !blocked { arm(now) }
        case .armed:
            // Only the first moment decides shortcut vs. talk: ⌃⌥ plus a key, ⇧ or ⌘ is a shortcut.
            if down && (extra || otherKeyDown()) { log("not a talk: ⌃⌥ was part of a shortcut"); cancel(); blocked = true; return }
            if released { phase = .handsFree; showListening("handsfree", now); return }
            if down && now - chordAt >= Self.tapLimit { phase = .holding; showListening("hold", now) }
        case .holding:
            if released { end("released"); finish(); return }
            if now - listenAt > Self.maxSession { end("max length"); finish() }
        case .handsFree:
            // Pressing again switches to push-to-talk; letting go then sends.
            if chord && !prevChord && !blocked { phase = .holding; releasedAt = nil; return }
            let quiet = now - max(heardAt, voiceAt)
            if !best.isEmpty && quiet > Self.pauseEnds { end("pause"); finish() }
            else if best.isEmpty && now - listenAt > 8 { end("nothing heard"); cancel() }
            else if now - listenAt > Self.maxSession { end("max length"); finish() }
        case .finishing:
            break
        }
    }

    private func end(_ why: String) { log("session end: \(why) after \(String(format: "%.1f", uptime() - listenAt))s") }

    // ---------- session ----------

    private func arm(_ now: Double) {
        phase = .armed
        chordAt = now
        best = ""
        if dryRun { return }
        // Already allowed: start the mic now so the first word isn't lost. Otherwise wait until
        // the press is clearly a talk (hold or tap), so shortcuts like ⌃⌥S never trigger a prompt.
        if authorized { startAudio() }
    }

    private var authorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized && (useAnalyzer || SFSpeechRecognizer.authorizationStatus() == .authorized)
    }

    private func showListening(_ mode: String, _ now: Double) {
        listenAt = now; heardAt = now; voiceAt = now
        if !dryRun && rec == nil {
            ensureAuthorized { [weak self] in
                guard let self, self.phase == .holding || self.phase == .handsFree, self.rec == nil else { return }
                self.startAudio()
            }
        }
        emit(["type": "state", "state": "listening", "mode": mode])
        if !best.isEmpty { emit(["type": "partial", "text": best]) }
    }

    private func finish() {
        guard phase == .armed || phase == .holding || phase == .handsFree else { return }
        let shown = phase != .armed
        reportEmpty = shown && !failed
        phase = .finishing
        if shown { emit(["type": "state", "state": "processing"]) }
        guard let r = rec, !failed else { stopAudio(); finalize(); return }
        // Keep the mic open a moment after release so a word said while letting go isn't clipped.
        let tail = Timer(timeInterval: 0.3, repeats: false) { [weak self] _ in
            guard let self, self.phase == .finishing, self.rec === r else { return }
            self.stopAudio()
            r.end()
            let t = Timer(timeInterval: 2.5, repeats: false) { [weak self] _ in self?.finalize() }
            RunLoop.main.add(t, forMode: .common)
            self.finishTimer = t
        }
        RunLoop.main.add(tail, forMode: .common)
        finishTimer = tail
    }

    private func finalize() {
        guard phase == .finishing else { return }
        finishTimer?.invalidate(); finishTimer = nil
        rec?.cancel(); rec = nil
        phase = .idle
        let text = best.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { emit(["type": "final", "text": text]) }
        emit(["type": "state", "state": "idle"])
        // Listened but got no words: say so instead of closing silently.
        if text.isEmpty && reportEmpty { emit(["type": "error", "code": "nothing_heard", "spoke": voiceAt > listenAt + 0.05]) }
        reportEmpty = false
    }

    private func cancel() {
        stopAudio()
        rec?.cancel(); rec = nil
        finishTimer?.invalidate(); finishTimer = nil
        phase = .idle
        reportEmpty = false
        emit(["type": "state", "state": "idle", "cancelled": true])
    }

    /// The shell saw ⌃⌥S: that ⌃⌥ was a shortcut, not a request to talk.
    func externalCancel() {
        if phase == .armed || phase == .holding || phase == .handsFree { cancel() }
        blocked = true
    }

    // ---------- permissions ----------

    private func ensureAuthorized(_ then: @escaping () -> Void) {
        let mic = AVCaptureDevice.authorizationStatus(for: .audio)
        let speech = SFSpeechRecognizer.authorizationStatus()
        if mic == .authorized && (useAnalyzer || speech == .authorized) { then(); return }
        if mic == .denied || mic == .restricted { return denied("microphone") }
        if speech == .denied || speech == .restricted { return denied("speech") }
        if authorizing { return }
        authorizing = true
        AVCaptureDevice.requestAccess(for: .audio) { micOK in
            guard micOK else {
                DispatchQueue.main.async { self.authorizing = false; self.denied("microphone") }
                return
            }
            if self.useAnalyzer { DispatchQueue.main.async { self.authorizing = false; then() }; return }
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    self.authorizing = false
                    if status == .authorized { then() } else { self.denied("speech") }
                }
            }
        }
    }

    private func denied(_ what: String) {
        emit(["type": "error", "code": "permission", "what": what])
        cancel()
    }

    // ---------- audio + recognition ----------

    private func startAudio() {
        failed = false
        var mine: Recognizer?
        let cb = RecognizerCallbacks(
            onText: { [weak self] text in guard let self, self.rec === mine else { return }; self.onText(text) },
            onDone: { [weak self] in guard let self, self.rec === mine, self.phase == .finishing else { return }; self.finalize() },
            onError: { [weak self] err in guard let self, self.rec === mine else { return }; self.onError(err) }
        )
        if #available(macOS 26, *), useAnalyzer { mine = AnalyzerRecognizer(cb) } else { mine = LegacyRecognizer(cb) }
        guard let r = mine else {
            emit(["type": "error", "code": "unavailable"])
            return cancel()
        }

        let eng = AVAudioEngine()
        let input = eng.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            emit(["type": "error", "code": "no_input"])
            return cancel()
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            r.append(buffer)
            guard let samples = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0 ..< n { sum += samples[i] * samples[i] }
            let rms = sqrt(sum / Float(max(n, 1)))
            let level = min(1, max(0, (Double(20 * log10(max(rms, 1e-7))) + 55) / 40))
            DispatchQueue.main.async { self?.onLevel(level) }
        }
        do {
            eng.prepare()
            try eng.start()
        } catch {
            log("engine start failed: \(error)")
            r.cancel()
            emit(["type": "error", "code": "no_input"])
            return cancel()
        }
        engine = eng
        rec = r
    }

    private func stopAudio() {
        guard let eng = engine else { return }
        eng.inputNode.removeTap(onBus: 0)
        eng.stop()
        engine = nil
    }

    private func onLevel(_ v: Double) {
        let now = uptime()
        if v > 0.2 { voiceAt = now }
        guard phase == .holding || phase == .handsFree, now - levelAt >= 0.05 else { return }
        levelAt = now
        emit(["type": "level", "v": (v * 100).rounded() / 100])
    }

    private func onText(_ text: String) {
        guard text != best else { return }
        best = text
        heardAt = uptime()
        if phase != .armed && phase != .idle { emit(["type": "partial", "text": text]) }
    }

    private func onError(_ error: Error) {
        let msg = error.localizedDescription
        log("recognition: \(msg)")
        // Ending a request early reports "no speech"/cancel errors; only real failures reach the user.
        let ns = error as NSError
        let benign = ns.domain == "kAFAssistantErrorDomain" && [203, 216, 301, 1110].contains(ns.code)
        if !benign && best.isEmpty {
            failed = true
            let code = msg.localizedCaseInsensitiveContains("dictation") || msg.localizedCaseInsensitiveContains("siri") ? "dictation_off" : "recognition"
            emit(["type": "error", "code": code, "message": msg])
        }
        // A failed recognizer can't hear anything more, so end; otherwise keep listening while held.
        if phase == .finishing { finalize() }
        else if failed { end("recognition error"); finish() }
    }
}

let voice = Voice()
let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in voice.tick() }
RunLoop.main.add(timer, forMode: .common)
Thread.detachNewThread {
    while let line = readLine() {
        if line.contains("\"cancel\"") { DispatchQueue.main.async { voice.externalCancel() } }
    }
    exit(0)
}
emit(["type": "ready", "engine": voice.engineName, "dryRun": dryRun])
RunLoop.main.run()
