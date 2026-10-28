// Live voice calls run natively (Phase 18) so they keep going with the screen locked or the app in
// the background. Every call is a CallKit call (CallKitCenter.swift): the system shows it on the
// lock screen and in the green status pill, owns the audio session and activates it for us
// (provider(_:didActivate:) starts the audio engine), and ending it there hangs up on the server.
// Same protocol as the web page: 16-bit mono PCM at 24 kHz both ways in 40 ms blocks, plus small
// JSON events, which are passed on to the page.
import AVFoundation
import CallKit
import Foundation

/// Where a call goes: the server, the conversation, the sign-in cookie, and the ring it answers.
struct CallTarget {
    let server: String
    let conversation: String
    let cookie: String?
    let ring: String?
}

final class CallManager: NSObject, @unchecked Sendable {
    static let shared = CallManager()

    /// Gets the server's events (JSON text), on the main thread; the page shows the call.
    var onEvent: ((String) -> Void)?

    private let rate: Double = 24000
    private let block = 960 // 40 ms
    private let queue = DispatchQueue(label: "sara.call")
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var converter: AVAudioConverter?
    private var task: URLSessionWebSocketTask?
    private var pending: [Int16] = []
    private var playEnds: TimeInterval = 0
    private var floor: Float = 0.006
    private var loudMs: Float = 0
    private(set) var active = false
    /// The server answered (first event): the call counts as connected.
    private var connected = false
    /// Muted from the system call screen: silence is sent instead of the microphone.
    private var muted = false
    private var engineRunning = false
    /// Test runs without audio (simulator).
    private var noAudio = false
    #if DEBUG
    /// Test runs: a log of events and audio blocks sent (tmp/call.log in the app's container).
    private var sentBlocks = 0
    func debugLog(_ line: String) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("call.log")
        let text = "\(Date().timeIntervalSince1970) \(line)\n"
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(Data(text.utf8))
            try? h.close()
        } else {
            try? Data(text.utf8).write(to: url)
        }
    }

    /// Test runs on a simulator with no audio device (-SaraTestNoMic YES).
    static var testNoMic: Bool { UserDefaults.standard.bool(forKey: "SaraTestNoMic") }
    #endif

    private lazy var playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
    private lazy var micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true)!

    /// The page starts a call, or answers her ring from the in-app ring screen (`ring`: she starts
    /// by saying why she called). Asks for the microphone first, then asks CallKit to start (or
    /// answer) the call; CallKit's action then calls `begin`.
    func start(server: String, conversation: String, cookie: String?, ring: String? = nil) {
        guard !active else { return }
        active = true
        let target = CallTarget(server: server, conversation: conversation, cookie: cookie, ring: ring)
        AVAudioApplication.requestRecordPermission { granted in
            self.queue.async {
                guard granted else { return self.finish(reason: "Microphone: permission denied.", notify: true, ended: .failed) }
                DispatchQueue.main.async {
                    if let ring, CallKitCenter.shared.answerFromApp(ring: ring, target: target) { return }
                    CallKitCenter.shared.startOutgoing(target: target) { error in
                        guard let error else { return }
                        #if DEBUG
                        // The simulator may refuse CallKit calls; test runs then connect without it.
                        if Self.testNoMic {
                            NSLog("Sara CallKit: start refused here (%@); test run connects without CallKit", error.localizedDescription)
                            self.begin(target)
                            return
                        }
                        #endif
                        self.queue.async { self.finish(reason: "Couldn't start the call: \(error.localizedDescription)", notify: true, ended: nil) }
                    }
                }
            }
        }
    }

    /// The audio session for a call. Set in CallKit's start/answer action; CallKit activates it.
    static func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
        } catch {
            NSLog("Sara CallKit: audio session setup failed: %@", error.localizedDescription)
        }
    }

    /// CallKit's start or answer action ran (or a test run without CallKit): connect to the server.
    func begin(_ target: CallTarget) {
        queue.async {
            // Answered on the system call screen: the page didn't start this call.
            if !self.active { self.active = true }
            guard self.task == nil else { return }
            if AVAudioApplication.shared.recordPermission == .denied {
                return self.finish(reason: "Microphone: permission denied.", notify: true, ended: .failed)
            }
            self.connect(target)
        }
    }

    private func connect(_ target: CallTarget) {
        let server = target.server
        let wsBase = server.hasPrefix("https://") ? "wss://" + server.dropFirst(8) : "ws://" + server.dropFirst(7)
        let id = target.conversation.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target.conversation
        let query = target.ring.flatMap { $0.addingPercentEncoding(withAllowedCharacters: .alphanumerics) }.map { "?ring=" + $0 } ?? ""
        guard let url = URL(string: wsBase + "/api/live/" + id + query) else { return finish(reason: "Bad server address.", notify: true, ended: .failed) }
        var req = URLRequest(url: url)
        req.setValue(server, forHTTPHeaderField: "Origin")
        if let cookie = target.cookie { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        req.setValue("SaraPhone/1 (iOS)", forHTTPHeaderField: "User-Agent")
        let t = URLSession.shared.webSocketTask(with: req)
        task = t
        connected = false
        t.resume()
        receive()
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        #if DEBUG
        if Self.testNoMic {
            startTestSilence()
            return
        }
        #endif
        #if targetEnvironment(simulator)
        // The simulator doesn't always activate CallKit's audio session; start the audio ourselves
        // if CallKit hasn't after a moment (on an iPhone it always comes through didActivate).
        queue.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.active, !self.engineRunning, !self.noAudio else { return }
            NSLog("Sara CallKit: no audio activation from CallKit on the simulator; activating directly")
            try? AVAudioSession.sharedInstance().setActive(true)
            self.startEngineOrHangUp()
        }
        #endif
    }

    #if DEBUG
    /// Test runs: no audio at all, silence is sent instead of the microphone. Checks the
    /// connection and events.
    private func startTestSilence() {
        noAudio = true
        let silence = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: AVAudioFrameCount(block))!
        silence.frameLength = AVAudioFrameCount(block)
        converter = AVAudioConverter(from: micFormat, to: micFormat)
        func tick() {
            queue.asyncAfter(deadline: .now() + 0.04) { [weak self] in
                guard let self, self.active else { return }
                self.mic(silence)
                tick()
            }
        }
        tick()
    }
    #endif

    // MARK: audio (CallKit activates and deactivates the session)

    /// provider(_:didActivate:): the call's audio session is live, start the engine.
    func audioActivated() {
        queue.async {
            NSLog("Sara CallKit: audio session activated")
            guard self.active, !self.noAudio, !self.engineRunning else { return }
            self.startEngineOrHangUp()
        }
    }

    /// provider(_:didDeactivate:): the system took the audio away (or the call ended).
    func audioDeactivated() {
        queue.async {
            NSLog("Sara CallKit: audio session deactivated")
            self.stopEngine()
        }
    }

    private func startEngineOrHangUp() {
        do {
            try startEngine()
        } catch {
            hangUp(reason: "Couldn't start the microphone: \(error.localizedDescription)")
        }
    }

    private func startEngine() throws {
        let s = AVAudioSession.sharedInstance()
        guard s.isInputAvailable else { throw NSError(domain: "Sara", code: 1, userInfo: [NSLocalizedDescriptionKey: "no microphone is available"]) }
        let input = engine.inputNode
        #if !targetEnvironment(simulator)
        try? input.setVoiceProcessingEnabled(true) // echo cancellation (the simulator's audio can't do it)
        #endif
        let inFormat = input.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: inFormat, to: micFormat)
        input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buf, _ in
            self?.queue.async { self?.mic(buf) }
        }
        if !engine.attachedNodes.contains(player) { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw error
        }
        player.play()
        engineRunning = true
    }

    private func stopEngine() {
        guard engineRunning else { return }
        engineRunning = false
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        if engine.attachedNodes.contains(player) { engine.detach(player) }
    }

    /// Mute on the system call screen.
    func setMuted(_ on: Bool) {
        queue.async { self.muted = on }
    }

    // MARK: the server

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                switch result {
                case .failure:
                    self.finish(reason: "The call was disconnected.", notify: true, ended: .failed)
                case .success(let message):
                    switch message {
                    case .data(let d): self.play(d)
                    case .string(let s): self.event(s)
                    @unknown default: break
                    }
                    if self.active { self.receive() }
                }
            }
        }
    }

    private func event(_ json: String) {
        let type = (try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])?["type"] as? String
        if !connected, type == "status" || type == "ready" {
            connected = true
            DispatchQueue.main.async { CallKitCenter.shared.reportConnected() }
        }
        if type == "interrupt" { silence() }
        emit(json)
        if type == "ended" { finish(reason: nil, notify: false, ended: .remoteEnded) }
    }

    private func emit(_ json: String) {
        #if DEBUG
        debugLog("event \(json.prefix(120))")
        #endif
        DispatchQueue.main.async { self.onEvent?(json) }
    }

    /// Mic → server. While she talks, sends silence unless you clearly talk over her.
    private func mic(_ buf: AVAudioPCMBuffer) {
        guard active, let converter else { return }
        let cap = AVAudioFrameCount(Double(buf.frameLength) * rate / buf.format.sampleRate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buf
        }
        guard err == nil, let p = out.int16ChannelData?[0] else { return }
        let n = Int(out.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { let v = Float(p[i]) / 32768; sum += v * v }
        let level = (sum / Float(n)).squareRoot()
        let ms = Float(n) / Float(rate) * 1000
        var open = true
        if Date().timeIntervalSince1970 < playEnds + 0.05 {
            loudMs = level > max(0.035, floor * 6) ? loudMs + ms : max(0, loudMs - ms)
            open = loudMs >= 160
        } else {
            loudMs = 0
            if level < floor * 2 { floor = floor * 0.995 + level * 0.005 }
        }
        if muted { open = false }
        for i in 0..<n { pending.append(open ? p[i] : 0) }
        while pending.count >= block {
            let chunk = Array(pending.prefix(block))
            pending.removeFirst(block)
            let data = chunk.withUnsafeBufferPointer { Data(buffer: $0) }
            task?.send(.data(data)) { _ in }
            #if DEBUG
            sentBlocks += 1
            if sentBlocks % 125 == 0 { debugLog("sent \(sentBlocks) blocks (\(sentBlocks * 40 / 1000) s of audio)") }
            #endif
        }
    }

    private func play(_ data: Data) {
        guard active, !noAudio, engineRunning, data.count >= 2 else { return }
        let n = data.count / 2
        guard let buf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(n)) else { return }
        buf.frameLength = AVAudioFrameCount(n)
        let ch = buf.floatChannelData![0]
        data.withUnsafeBytes { raw in
            let s = raw.bindMemory(to: Int16.self)
            for i in 0..<n { ch[i] = Float(Int16(littleEndian: s[i])) / 32768 }
        }
        let now = Date().timeIntervalSince1970
        playEnds = max(now, playEnds) + Double(n) / rate
        player.scheduleBuffer(buf, completionHandler: nil)
    }

    private func silence() {
        guard !noAudio, engineRunning else { return }
        player.stop()
        player.play()
        playEnds = 0
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        hangUp(reason: "The call was interrupted.")
    }

    // MARK: ending

    /// Hang up from the app (the page's button, an interruption): through CallKit, so the system
    /// call screen ends too; CallKit's end action then calls `endNow`.
    func hangUp(reason: String = "You hung up.") {
        DispatchQueue.main.async {
            if CallKitCenter.shared.requestEnd(reason: reason) { return }
            self.endNow(reason: reason)
        }
    }

    /// Ends the call now (CallKit's end action: the lock screen, the green status pill, the app):
    /// tells the server to hang up, then stops everything.
    func endNow(reason: String) {
        queue.async {
            guard self.active else { return }
            self.task?.send(.string("{\"type\":\"hangup\"}")) { _ in }
            self.finish(reason: reason, notify: true, ended: nil)
        }
    }

    /// Stops everything (on the call queue). With notify, tells the page the call ended. `ended`:
    /// tells CallKit why (nil when the end came from CallKit's own end action).
    private func finish(reason: String?, notify: Bool, ended: CXCallEndedReason?) {
        guard active else { return }
        active = false
        connected = false
        muted = false
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        // Give the hang-up message a moment to leave before the socket closes.
        let t = task
        task = nil
        queue.asyncAfter(deadline: .now() + 0.3) { t?.cancel(with: .normalClosure, reason: nil) }
        stopEngine()
        noAudio = false
        pending.removeAll()
        playEnds = 0
        if let ended { DispatchQueue.main.async { CallKitCenter.shared.callFinished(reason: ended) } }
        if notify, let data = try? JSONSerialization.data(withJSONObject: ["type": "ended", "reason": reason ?? ""]), let json = String(data: data, encoding: .utf8) {
            emit(json)
        }
    }
}
