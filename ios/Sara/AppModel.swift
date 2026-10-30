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
    /// Phase 68: the saved server in use (its own website data store and sign-in).
    @Published var activeId: String?
    /// A server being removed that wasn't in use: opened first, then signed out there.
    var pendingRemove: String?

    // MARK: the new look (2.7)

    /// Night or Day: the theme the page showed last (the app's own screens, first paint).
    @Published var look = Look.saved
    /// The page's top edge is dark (light status bar text over it).
    @Published var topDark = !Look.saved.day

    /// Light status bar text: over the page's top edge, or over the app's own screens.
    var statusDark: Bool { screen == .web && server != nil ? topDark : !look.day }

    /// Light or dark status bar text (and the app's own screens' alerts) through the root view
    /// controller; the window keeps the system's style.
    func applyStatusStyle() {
        let style: UIUserInterfaceStyle = statusDark ? .dark : .light
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            for w in scene.windows {
                guard let vc = w.rootViewController, vc.overrideUserInterfaceStyle != style else { continue }
                vc.overrideUserInterfaceStyle = style
                vc.setNeedsStatusBarAppearanceUpdate()
            }
        }
    }

    /// The page's report (the app's look script in WebView.swift): its theme and top-edge colour.
    func pageLook(theme: String, top: String) {
        let day = theme == "day"
        if day != look.day {
            UserDefaults.standard.set(day ? "day" : "night", forKey: "look")
            look = day ? .dayLook : .night
            if let web {
                web.backgroundColor = look.uiBg
                web.scrollView.backgroundColor = look.uiBg
                web.underPageBackgroundColor = look.uiBg
            }
        }
        let dark = !(UIColor(page: top) ?? look.uiBg).isLight
        if dark != topDark { topDark = dark }
    }

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
        // The phone's light/dark setting may have changed while away: the page follows it.
        if phase == .active {
            (web as? SaraWebView)?.followSystemStyle()
            applyStatusStyle()
        }
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
        activeId = Servers.active?.id
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

    // MARK: several servers (Phase 68)

    /// Shows a saved server; every server keeps its sign-in in its own website data store.
    func switchTo(_ id: String, path: String = "/") {
        guard let p = Servers.list().first(where: { $0.id == id }) else { return }
        saveCookies()
        use(server: p.url, path: path)
    }

    /// The page's ⇄ menu → Remove: signs out on that server (from its own page) and forgets only it.
    func removeServer(_ id: String) {
        guard Servers.list().contains(where: { $0.id == id }) else { return }
        if id != activeId {
            pendingRemove = id
            return switchTo(id)
        }
        removeActive()
    }

    func removeActive() {
        guard let p = Servers.active else { return }
        var finished = false
        let finish = { [weak self] in
            guard let self, !finished else { return }
            finished = true
            Task { @MainActor in
                await Servers.forgetData(p)
                Servers.remove(p.id)
                SharedStore.cookie = nil
                SharedStore.widgetJSON = nil
                SharedStore.face = nil
                if let next = Servers.list().max(by: { $0.lastUsed < $1.lastUsed }) {
                    self.server = nil
                    self.use(server: next.url, path: "/")
                } else {
                    self.server = nil
                    self.activeId = nil
                    SharedStore.server = nil
                    self.screen = .setup
                }
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
        web?.evaluateJavaScript("fetch('/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(()=>1,()=>0)") { _, _ in finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish() }  // offline: forget it here anyway
    }

    func renameServer(_ id: String, _ name: String, byUser: Bool) {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, let p = Servers.list().first(where: { $0.id == id }), byUser || !p.named else { return }
        Servers.update(id) { s in
            s.name = Servers.uniqueName(n, url: s.url, except: s.id)
            if byUser { s.named = true }
        }
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

    /// Accepting a pairing link: a different server must first answer /api/health as Sara; it is
    /// then added next to the others (Phase 68: nobody is signed out).
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
        // Phase 68: a saved server again, or a new one next to the others.
        let id = Servers.idFor(s)
        Servers.update(id) { $0.lastUsed = Date().timeIntervalSince1970 }
        Servers.setActive(id)
        activeId = id
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
        // Phase 68: a server being removed that wasn't in use is open now: sign out there.
        if let r = pendingRemove, r == activeId {
            pendingRemove = nil
            return removeActive()
        }
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
        // Phase 68: with this app's id for the server, so a tap on its push opens the right one.
        let profile = activeId ?? ""
        let js = "fetch('/api/push/apns/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'\(token)',sandbox:\(sandbox),label:'Sara app on \(label)',profile:'\(profile)'})}).catch(function(){})"
        web.evaluateJavaScript(js, completionHandler: nil)
    }
}


// MARK: - Phase 68: the saved servers

/// One Sara server this app is signed in to. No sign-in is stored here: each server's session
/// cookie lives in a WebKit website data store of its own (the first one, from before 1.8, keeps
/// the default store, so an update keeps its sign-in).
struct SavedServer {
    var id: String
    var name: String
    var named: Bool
    var url: String
    var emoji: String
    var lastUsed: Double
    var store: String?

    var dict: [String: Any] {
        var d: [String: Any] = ["id": id, "name": name, "named": named, "url": url, "emoji": emoji, "lastUsed": lastUsed]
        if let store { d["store"] = store }
        return d
    }
}

enum Servers {
    static func host(_ url: String) -> String {
        guard let r = url.range(of: "://") else { return url }
        return String(url[r.upperBound...])
    }

    /// The saved servers; the one server from before 1.8 becomes s1 (default store).
    static func list() -> [SavedServer] {
        if let raw = UserDefaults.standard.array(forKey: "servers") as? [[String: Any]] {
            return raw.compactMap { d in
                guard let id = d["id"] as? String, let url = d["url"] as? String else { return nil }
                return SavedServer(id: id, name: d["name"] as? String ?? host(url), named: d["named"] as? Bool ?? false, url: url, emoji: d["emoji"] as? String ?? "", lastUsed: d["lastUsed"] as? Double ?? 0, store: d["store"] as? String)
            }
        }
        guard let old = SharedStore.server else { return [] }
        let one = SavedServer(id: "s1", name: host(old), named: false, url: old, emoji: "", lastUsed: Date().timeIntervalSince1970, store: nil)
        save([one])
        setActive("s1")
        return [one]
    }

    static func save(_ l: [SavedServer]) { UserDefaults.standard.set(l.map(\.dict), forKey: "servers") }
    static func setActive(_ id: String?) { UserDefaults.standard.set(id, forKey: "activeServer") }
    static var active: SavedServer? {
        let l = list()
        let id = UserDefaults.standard.string(forKey: "activeServer")
        return l.first { $0.id == id } ?? l.first
    }

    static func uniqueName(_ wanted: String, url: String, except id: String?) -> String {
        let taken = Set(list().filter { $0.id != id }.map { $0.name.lowercased() })
        let base = wanted.isEmpty ? host(url) : String(wanted.prefix(60))
        if !taken.contains(base.lowercased()) { return base }
        let withHost = "\(base) (\(host(url)))"
        if !taken.contains(withHost.lowercased()) { return withHost }
        var i = 2
        while taken.contains("\(withHost) \(i)".lowercased()) { i += 1 }
        return "\(withHost) \(i)"
    }

    /// The saved server at exactly this address, or a new one with a data store of its own.
    static func idFor(_ url: String) -> String {
        var l = list()
        if let p = l.first(where: { $0.url == url }) { return p.id }
        var n = 1
        while l.contains(where: { $0.id == "s\(n)" }) { n += 1 }
        let id = "s\(n)"
        l.append(SavedServer(id: id, name: uniqueName("", url: url, except: id), named: false, url: url, emoji: "", lastUsed: Date().timeIntervalSince1970, store: id == "s1" ? nil : UUID().uuidString))
        save(l)
        return id
    }

    static func update(_ id: String, _ change: (inout SavedServer) -> Void) {
        var l = list()
        guard let i = l.firstIndex(where: { $0.id == id }) else { return }
        change(&l[i])
        save(l)
    }

    static func remove(_ id: String) {
        save(list().filter { $0.id != id })
        if UserDefaults.standard.string(forKey: "activeServer") == id { setActive(nil) }
    }

    /// The website data store of a server: its own, or the default one for s1.
    static func dataStore(_ p: SavedServer?) -> WKWebsiteDataStore {
        if let s = p?.store, let uuid = UUID(uuidString: s) { return WKWebsiteDataStore(forIdentifier: uuid) }
        return .default()
    }

    /// Clears a server's sign-in (its whole data store) when it's removed.
    @MainActor
    static func forgetData(_ p: SavedServer) async {
        if let s = p.store, let uuid = UUID(uuidString: s) {
            try? await WKWebsiteDataStore.remove(forIdentifier: uuid)
        } else {
            await WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        }
    }

    /// The Cookie header of a saved server (for a reply typed into its notification).
    @MainActor
    static func cookie(_ p: SavedServer) async -> String? {
        guard let host = URL(string: p.url)?.host else { return nil }
        let cookies = await dataStore(p).httpCookieStore.allCookies()
        let header = cookies.filter { c in
            let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
            return host == d || host.hasSuffix("." + d)
        }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        return header.isEmpty ? nil : header
    }

    /// {"servers":[…]} for the page: names and hosts only, never a sign-in.
    static func json(active: String?) -> String {
        let arr = list().map { ["id": $0.id, "name": $0.name, "host": host($0.url), "emoji": $0.emoji, "active": $0.id == active] as [String: Any] }
        let data = (try? JSONSerialization.data(withJSONObject: ["servers": arr])) ?? Data("{\"servers\":[]}".utf8)
        return String(data: data, encoding: .utf8) ?? "{\"servers\":[]}"
    }
}
