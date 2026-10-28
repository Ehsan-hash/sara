// Live calls through CallKit (Apple's CXProvider / CXCallController), so iOS treats a call with
// Sara like a phone call: it keeps going with the screen locked (with the audio background mode),
// shows on the lock screen and in the green status pill, can be muted and ended there, and a real
// phone call coming in offers "End & Accept" (Sara's call can't be held). CallKit owns the audio
// session: the category is set in the start/answer action and the engine starts in didActivate.
//
// Rings ("Sara is calling") reach the app the way they always have: through the page while the app
// is open (and the ordinary push notification otherwise). While the app is running, the page hands
// each ring to `reportRing`, which shows it as an incoming call. No PushKit / VoIP pushes.
import AVFoundation
import CallKit
import UIKit

final class CallKitCenter: NSObject, CXProviderDelegate, @unchecked Sendable {
    /// Used on the main thread only (the provider's delegate queue is the main queue).
    static let shared = CallKitCenter()

    private let provider: CXProvider
    private let controller = CXCallController()
    /// The live call CallKit knows about (outgoing, or a ring that was answered).
    private(set) var callID: UUID?
    private var outgoing = false
    private var target: CallTarget?
    /// Why the app asked CallKit to end the call (shown in the chat).
    private var endReason: String?
    /// Rings reported to the system and not answered yet: ring id → call.
    private var rings: [String: (uuid: UUID, conversation: String)] = [:]
    /// The ring being answered from the app's own ring screen (the page already shows the call).
    private var answeringFromApp: UUID?

    /// A ring was answered on the system call screen: the page shows the call (ring id, conversation).
    var onAnsweredRing: ((String, String) -> Void)?
    /// A ring was declined on the system call screen: the page closes its ring screen.
    var onRingClosed: ((String) -> Void)?

    static let handle = CXHandle(type: .generic, value: "Sara")

    override init() {
        // The system shows the app's name ("Sara") on the call screen.
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        // Sara isn't a phone contact: her calls stay out of the Phone app's Recents.
        config.includesCallsInRecents = false
        config.supportedHandleTypes = [.generic]
        if let icon = UIImage(named: "CallIcon")?.pngData() { config.iconTemplateImageData = icon }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
        NSLog("Sara CallKit: provider ready (video: %@, call groups: %ld, in Recents: %@, icon: %@)",
              config.supportsVideo ? "yes" : "no", config.maximumCallGroups, config.includesCallsInRecents ? "yes" : "no", config.iconTemplateImageData == nil ? "none" : "set")
    }

    /// Created at launch so the provider is ready before the first call or ring.
    func setUp() {}

    private func update(incoming: Bool) -> CXCallUpdate {
        let u = CXCallUpdate()
        u.remoteHandle = Self.handle
        u.localizedCallerName = "Sara"
        u.hasVideo = false
        u.supportsHolding = false
        u.supportsGrouping = false
        u.supportsUngrouping = false
        u.supportsDTMF = false
        return u
    }

    // MARK: the app asks

    /// Starts an outgoing call; `done` gets an error when CallKit refused it.
    func startOutgoing(target: CallTarget, done: @escaping (Error?) -> Void) {
        guard callID == nil else {
            return done(NSError(domain: "Sara", code: 2, userInfo: [NSLocalizedDescriptionKey: "a call is already going on"]))
        }
        let id = UUID()
        callID = id
        outgoing = true
        self.target = target
        let action = CXStartCallAction(call: id, handle: Self.handle)
        action.isVideo = false
        controller.request(CXTransaction(action: action)) { error in
            DispatchQueue.main.async {
                if let error {
                    NSLog("Sara CallKit: start call refused: %@", error.localizedDescription)
                    if self.callID == id {
                        self.callID = nil
                        self.target = nil
                    }
                    return done(error)
                }
                self.provider.reportCall(with: id, updated: self.update(incoming: false))
                done(nil)
            }
        }
    }

    /// The server says the call is up: the system call screen starts its timer.
    func reportConnected() {
        guard outgoing, let id = callID else { return }
        provider.reportOutgoingCall(with: id, connectedAt: Date())
        NSLog("Sara CallKit: outgoing call connected")
    }

    /// Hangs up through CallKit. False when CallKit has no call (then the app ends it itself).
    func requestEnd(reason: String) -> Bool {
        guard let id = callID else { return false }
        endReason = reason
        controller.request(CXTransaction(action: CXEndCallAction(call: id))) { error in
            guard let error else { return }
            DispatchQueue.main.async {
                NSLog("Sara CallKit: end call refused: %@", error.localizedDescription)
                if self.callID == id { self.clear() }
                CallManager.shared.endNow(reason: reason)
            }
        }
        return true
    }

    /// The call ended on its own (the server hung up, the connection dropped): tell the system.
    func callFinished(reason: CXCallEndedReason) {
        guard let id = callID else { return }
        provider.reportCall(with: id, endedAt: Date(), reason: reason)
        clear()
    }

    private func clear() {
        callID = nil
        outgoing = false
        target = nil
        endReason = nil
    }

    // MARK: rings

    /// She is calling (the page got the ring while the app is running): show the system's incoming
    /// call screen. False when it can't be shown (already on a call, or shown already).
    func reportRing(id: String, conversation: String, seconds: Double) -> Bool {
        guard callID == nil else { return false }
        if rings[id] != nil { return true }
        let uuid = UUID()
        rings[id] = (uuid, conversation)
        provider.reportNewIncomingCall(with: uuid, update: update(incoming: true)) { error in
            DispatchQueue.main.async {
                if let error {
                    NSLog("Sara CallKit: incoming call not shown: %@", error.localizedDescription)
                    if self.rings[id]?.uuid == uuid { self.rings[id] = nil }
                } else {
                    NSLog("Sara CallKit: incoming call shown")
                }
            }
        }
        // Stop ringing when the ring runs out, even if the page doesn't say so.
        DispatchQueue.main.asyncAfter(deadline: .now() + max(5, min(seconds, 180)) + 2) {
            if self.rings[id]?.uuid == uuid { self.ringEnded(id: id, state: "missed") }
        }
        return true
    }

    /// The ring ended elsewhere or ran out (answered on another device, declined, missed, cancelled).
    func ringEnded(id: String, state: String) {
        guard let r = rings.removeValue(forKey: id) else { return }
        if r.uuid == callID { return } // answered here: that's the call now
        let reason: CXCallEndedReason = state == "answered" ? .answeredElsewhere : state == "declined" ? .declinedElsewhere : .unanswered
        provider.reportCall(with: r.uuid, endedAt: Date(), reason: reason)
    }

    /// The app's own ring screen answered: answer the system's incoming call too. False when the
    /// system doesn't know this ring (then it's started as an ordinary call that answers the ring).
    func answerFromApp(ring: String, target: CallTarget) -> Bool {
        guard callID == nil, let r = rings[ring] else { return false }
        callID = r.uuid
        outgoing = false
        self.target = target
        answeringFromApp = r.uuid
        controller.request(CXTransaction(action: CXAnswerCallAction(call: r.uuid))) { error in
            guard let error else { return }
            DispatchQueue.main.async {
                NSLog("Sara CallKit: answer refused: %@", error.localizedDescription)
                self.answeringFromApp = nil
                self.rings[ring] = nil
                self.provider.reportCall(with: r.uuid, endedAt: Date(), reason: .failed)
                self.clear()
                self.startOutgoing(target: target) { e in
                    if let e { CallManager.shared.endNow(reason: "Couldn't start the call: \(e.localizedDescription)") }
                }
            }
        }
        return true
    }

    private func decline(ring id: String) {
        guard let server = SharedStore.server, let path = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let url = URL(string: server + "/api/calls/" + path + "/decline") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(server, forHTTPHeaderField: "Origin")
        req.setValue("SaraPhone/1 (iOS)", forHTTPHeaderField: "User-Agent")
        if let c = SharedStore.cookie { req.setValue(c, forHTTPHeaderField: "Cookie") }
        req.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }

    // MARK: CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {
        NSLog("Sara CallKit: provider reset")
        rings.removeAll()
        clear()
        CallManager.shared.endNow(reason: "The call was interrupted.")
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        guard action.callUUID == callID, let target else { return action.fail() }
        CallManager.configureAudioSession()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        CallManager.shared.begin(target)
        action.fulfill()
        NSLog("Sara CallKit: outgoing call started")
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let (ring, r) = rings.first(where: { $0.value.uuid == action.callUUID }).map({ ($0.key, $0.value) }) else { return action.fail() }
        let fromApp = answeringFromApp == action.callUUID
        answeringFromApp = nil
        let t: CallTarget
        if fromApp, let target {
            t = target
        } else {
            guard let server = SharedStore.server else { return action.fail() }
            t = CallTarget(server: server, conversation: r.conversation, cookie: SharedStore.cookie, ring: ring)
        }
        callID = action.callUUID
        outgoing = false
        target = t
        rings[ring] = nil
        CallManager.configureAudioSession()
        CallManager.shared.begin(t)
        action.fulfill()
        NSLog("Sara CallKit: incoming call answered (%@)", fromApp ? "in the app" : "on the call screen")
        if !fromApp { onAnsweredRing?(ring, r.conversation) }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if action.callUUID == callID {
            // Hung up on the lock screen, the green status pill, the call screen or in the app:
            // CallManager tells the server to hang up.
            let reason = endReason ?? "You hung up."
            clear()
            CallManager.shared.endNow(reason: reason)
            action.fulfill()
            NSLog("Sara CallKit: call ended")
            return
        }
        if let ring = rings.first(where: { $0.value.uuid == action.callUUID })?.key {
            // Declined on the incoming call screen.
            rings[ring] = nil
            decline(ring: ring)
            onRingClosed?(ring)
            action.fulfill()
            NSLog("Sara CallKit: incoming call declined")
            return
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        CallManager.shared.setMuted(action.isMuted)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        // Sara's call can't wait on hold (she's live): putting it on hold ends it cleanly.
        action.fulfill()
        if action.isOnHold, action.callUUID == callID { _ = requestEnd(reason: "The call ended for another call.") }
    }

    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        CallManager.shared.audioActivated()
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        CallManager.shared.audioDeactivated()
    }
}
