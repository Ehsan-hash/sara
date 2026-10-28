import Foundation
import LocalAuthentication
import SwiftUI
import UIKit
import UserNotifications
import WebKit
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()
    /// The demo server (for trying Sara out, and for app review).
    static let demoServer = "https://demo.sara.backstagecoding.com"

    enum Screen { case setup, web }
    struct PairLink: Identifiable {
        let id = UUID()
        let server: String
        /// nil: just the server (the access QR's sign-in page); the app opens its sign-in there.
        let code: String?
        /// The link's address wasn't a plain server address (user name, path, query…): refused.
        var refused = false
    }

    @Published var screen: Screen
    @Published var server: String?
    /// The page the web view opens next (a path on the server); the web view clears it.
    @Published var pending: String? = "/"
    @Published var setupError: String?
    @Published var busy = false
    @Published var pairLink: PairLink?
    /// Set when a pairing link's new server didn't answer as Sara (nothing was changed).
    @Published var switchError: String?

    weak var web: WKWebView?
    var deviceToken: String?

    // MARK: app lock (Phase 18)

    /// With the lock on, Face ID (or the passcode) is needed after this long away.
    static let relockAfter: TimeInterval = 30
    static var appLockOn: Bool {
        get { UserDefaults.standard.bool(forKey: "appLock") }
        set { UserDefaults.standard.set(newValue, forKey: "appLock") }
    }
    /// The phone has a passcode (Face ID needs one too).
    static var canLock: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }
    @Published var locked = AppModel.appLockOn
    /// Covers the app in the app switcher while the lock is on.
    @Published var covered = false
    private var awayAt: Date?

    func scene(_ phase: ScenePhase) {
        guard Self.appLockOn else {
            locked = false
            covered = false
            return
        }
        switch phase {
        case .active:
            covered = false
            if let awayAt, Date().timeIntervalSince(awayAt) > Self.relockAfter { locked = true }
            self.awayAt = nil
            if locked { unlock() }
        case .inactive:
            covered = true
        case .background:
            covered = true
            if awayAt == nil { awayAt = Date() }
        @unknown default:
            break
        }
    }

    func unlock() {
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            locked = false // no passcode any more: nothing to check against
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Sara") { ok, _ in
            Task { @MainActor in if ok { self.locked = false } }
        }
    }

    init() {
        server = SharedStore.server
        screen = SharedStore.server == nil ? .setup : .web
        #if DEBUG
        // Test runs: launch with -SaraTestServer <url> [-SaraTestCode <pairing code>].
        if let s = UserDefaults.standard.string(forKey: "SaraTestServer") {
            let code = UserDefaults.standard.string(forKey: "SaraTestCode")
            let path = UserDefaults.standard.string(forKey: "SaraTestPath") ?? "/"
            use(server: s, path: code.map { "/pair#" + $0 } ?? path)
        }
        #endif
    }

    // MARK: links

    /// sara://pair?s=<server>[&c=<code>] (from the pairing page, or without a code from the sign-in
    /// page; always asks first, so a link can't quietly switch servers), sara://open?c=<conversation> (widget), sara://setup.
    func handle(url: URL) {
        guard url.scheme == "sara" else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func q(_ name: String) -> String? { items.first { $0.name == name }?.value }
        switch url.host {
        case "pair":
            guard let s = q("s") else { return }
            let c = q("c")?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let origin = Self.pairOrigin(s) {
                pairLink = PairLink(server: origin, code: c?.isEmpty == false ? c : nil)
            } else {
                pairLink = PairLink(server: "", code: nil, refused: true)
            }
        case "open":
            if let c = q("c"), c.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil { open(path: "/#c=" + c) } else { open(path: "/") }
        case "setup":
            changeServer()
        default:
            break
        }
    }

    func open(path: String) {
        guard server != nil else { return }
        pending = path
        screen = .web
    }

    func changeServer() {
        setupError = nil
        screen = .setup
    }

    // MARK: connecting

    static func normalize(_ input: String) -> String {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// The server address in a pairing link, cleaned to scheme://host[:port], or nil when it isn't
    /// a plain server address: a user name or password before the host (https://real.com@other.net),
    /// a path other than "/", a query or a fragment are refused, so a link can't dress up another
    /// server as yours.
    static func pairOrigin(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.hasPrefix("https://") || s.hasPrefix("http://"),
              let u = URLComponents(string: s),
              let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http",
              u.user == nil, u.password == nil, !s.dropFirst(scheme.count + 3).contains("@"),
              let host = u.host?.lowercased(), !host.isEmpty,
              u.path.isEmpty || u.path == "/",
              u.query == nil, u.fragment == nil, !s.contains("?"), !s.contains("#")
        else { return nil }
        let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        return "\(scheme)://\(h)" + (u.port.map { ":\($0)" } ?? "")
    }

    /// True for addresses at home or on a private network (plain http is fine there).
    static func isPrivateHost(_ origin: String) -> Bool {
        guard var h = URLComponents(string: origin)?.host?.lowercased() else { return false }
        if h.hasPrefix("[") { h = String(h.dropFirst().dropLast()) }
        if h == "localhost" || h.hasSuffix(".local") || h.hasSuffix(".lan") || h.hasSuffix(".home.arpa") || h.hasSuffix(".ts.net") { return true }
        if h.contains(":") { return h == "::1" || h.hasPrefix("fc") || h.hasPrefix("fd") || h.hasPrefix("fe80:") }
        let p = h.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4 else { return false }
        return p[0] == 10 || p[0] == 127 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && (16...31).contains(p[1]))
            || (p[0] == 169 && p[1] == 254) || (p[0] == 100 && (64...127).contains(p[1]))
    }

    /// Accepting a pairing link: a different server must first answer /api/health as Sara; only
    /// then is the old server's sign-in let go (so a dead or fake address can't sign you out).
    func accept(_ link: PairLink) async {
        guard !link.refused else { return }
        let path = link.code.map { "/pair#" + ($0.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0) } ?? "/"
        if link.server != server {
            busy = true
            let ok = await Self.reachable(link.server)
            busy = false
            guard ok else {
                switchError = "\(link.server) didn't answer as a Sara server, so the app stayed where it was."
                return
            }
        }
        use(server: link.server, path: path)
    }

    /// Finds the server (https first, then http), saves it and opens it; with a code, signs in on the way.
    func connect(address: String, code: String) async {
        let input = Self.normalize(address)
        guard !input.isEmpty else {
            setupError = "Type your server's address."
            return
        }
        busy = true
        setupError = nil
        defer { busy = false }
        let candidates = input.contains("://") ? [input] : ["https://" + input, "http://" + input]
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        for c in candidates where await Self.reachable(c) {
            use(server: c, path: trimmedCode.isEmpty ? "/" : "/pair#" + (trimmedCode.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? trimmedCode))
            return
        }
        setupError = "Couldn't reach Sara at that address. Check it, and that the server is running."
    }

    func tryDemo() {
        use(server: Self.demoServer, path: "/?demo=1")
    }

    func use(server s: String, path: String) {
        if s != server {
            SharedStore.cookie = nil
            SharedStore.widgetJSON = nil
            SharedStore.face = nil
        }
        server = s
        SharedStore.server = s
        pending = path
        screen = .web
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func reachable(_ base: String) async -> Bool {
        guard let url = URL(string: base + "/api/health") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        guard let (data, res) = try? await URLSession.shared.data(for: req) else { return false }
        // Sara answers {"ok":true}; any other web page isn't her.
        guard (res as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return json["ok"] as? Bool == true
    }

    // MARK: signed in

    /// The page says the owner is signed in: keep the widget's sign-in current and set up notifications.
    func signedIn() {
        saveCookies()
        #if DEBUG
        // Test runs: -SaraTestCall <conversation id> starts a call once signed in.
        if let conv = UserDefaults.standard.string(forKey: "SaraTestCall"), let server, !CallManager.shared.active {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                CallManager.shared.start(server: server, conversation: conv, cookie: SharedStore.cookie)
            }
        }
        #endif
        guard server != Self.demoServer else { return }
        // The device token doesn't need the permission; showing notifications does.
        UIApplication.shared.registerForRemoteNotifications()
        #if DEBUG
        if UserDefaults.standard.string(forKey: "SaraTestCall") != nil || UserDefaults.standard.string(forKey: "SaraTestServer") != nil { return } // test runs: no prompt
        #endif
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func saveCookies() {
        guard let server, let host = URL(string: server)?.host, let web else { return }
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            let header = cookies
                .filter { c in
                    let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
                    return host == d || host.hasSuffix("." + d)
                }
                .map { "\($0.name)=\($0.value)" }
                .joined(separator: "; ")
            Task { @MainActor in
                SharedStore.cookie = header.isEmpty ? nil : header
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }

    /// Tells the server where to send this iPhone's notifications (through the signed-in page, so
    /// it uses the page's session).
    func registerToken() {
        guard let token = deviceToken, let web, screen == .web, server != Self.demoServer else { return }
        #if DEBUG
        let sandbox = "true"
        #else
        let sandbox = "false"
        #endif
        let label = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let js = "fetch('/api/push/apns/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'\(token)',sandbox:\(sandbox),label:'Sara app on \(label)'})}).catch(function(){})"
        web.evaluateJavaScript(js, completionHandler: nil)
    }
}
