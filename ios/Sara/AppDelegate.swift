import CoreLocation
import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Reply right from the notification (Phase 18).
        let reply = UNTextInputNotificationAction(identifier: "REPLY", title: "Reply", options: [], textInputButtonTitle: "Send", textInputPlaceholder: "Message")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "SARA_REPLY", actions: [reply], intentIdentifiers: [], hiddenPreviewsBodyPlaceholder: "New message", options: []),
        ])
        // Phase 29: iOS wakes the app for a place it watches; the location manager must exist.
        if PlacesManager.isOn { Task { @MainActor in PlacesManager.shared.sync() } }
        // Live calls are CallKit calls: the provider is ready before the first call or ring.
        CallKitCenter.shared.setUp()
        #if DEBUG
        // Test runs: -SaraTestCallKit call|ring [-SaraTestServer <url>] exercises CallKit without a
        // signed-in page: "call" starts an outgoing call to a made-up conversation (the server
        // refuses it, so it ends as failed), "ring" shows an incoming call for 20 seconds.
        if let mode = UserDefaults.standard.string(forKey: "SaraTestCallKit") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                if mode == "ring" {
                    NSLog("Sara CallKit test: ring shown: %@", CallKitCenter.shared.reportRing(id: "test-ring", conversation: "00000000-0000-0000-0000-000000000000", seconds: 20) ? "yes" : "no")
                } else {
                    let server = UserDefaults.standard.string(forKey: "SaraTestServer") ?? "http://127.0.0.1:9"
                    CallManager.shared.start(server: server, conversation: "00000000-0000-0000-0000-000000000000", cookie: nil)
                }
            }
        }
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            AppModel.shared.deviceToken = hex
            AppModel.shared.registerToken()
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Sara: notifications unavailable: \(error.localizedDescription)")
    }

    // Show her messages even while the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    // Tapping a notification opens that conversation; Reply sends without opening the app.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        // Phase 68: which saved server sent it (servers from 1.8 on say; older ones: the one in use).
        let profile = info["profile"] as? String
        if let r = response as? UNTextInputNotificationResponse, let conv = info["conversationId"] as? String {
            Task { @MainActor in
                if let profile, profile != AppModel.shared.activeId, let p = Servers.list().first(where: { $0.id == profile }) {
                    // Another server's reply goes to that server, with its own sign-in.
                    Self.sendReply(r.userText, conversation: conv, server: p.url, cookie: await Servers.cookie(p), completion: completionHandler)
                } else {
                    Self.sendReply(r.userText, conversation: conv, completion: completionHandler)
                }
            }
            return
        }
        let url = info["url"] as? String
        Task { @MainActor in
            let path = url.flatMap { $0.hasPrefix("/") ? $0 : nil } ?? "/"
            if let profile, profile != AppModel.shared.activeId, Servers.list().contains(where: { $0.id == profile }) {
                AppModel.shared.switchTo(profile, path: path)
            } else if url != nil { AppModel.shared.open(path: path) }
            completionHandler()
        }
    }

    /// Sends a reply typed into a notification; her answer arrives as a notification.
    static func sendReply(_ text: String, conversation: String, server given: String? = nil, cookie givenCookie: String? = nil, completion: @escaping () -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let cookie = given == nil ? SharedStore.cookie : givenCookie
        guard !trimmed.isEmpty, let server = given ?? SharedStore.server,
              let id = conversation.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: server + "/api/conversations/" + id + "/messages")
        else { return completion() }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("SaraPhone/1 (iOS)", forHTTPHeaderField: "User-Agent")
        if let c = cookie { req.setValue(c, forHTTPHeaderField: "Cookie") }
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["content": trimmed, "background": true])
        URLSession.shared.dataTask(with: req) { _, res, _ in
            let status = (res as? HTTPURLResponse)?.statusCode ?? 0
            if status != 202 {
                let note = UNMutableNotificationContent()
                note.title = "Couldn't send your reply"
                note.body = status == 401 ? "Open the app and sign in again." : status == 409 ? "She's still answering. Open the app to see." : "Open the app to try again."
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "reply-failed", content: note, trigger: nil))
            }
            completion()
        }.resume()
    }
}

/// Phase 29: place reminders. The iPhone watches saved places that have reminders waiting
/// (region monitoring) and tells the server only "arrived at place N" or "left place N".
/// Where the phone is never leaves it.
@MainActor
final class PlacesManager: NSObject, CLLocationManagerDelegate {
    static let shared = PlacesManager()
    private let lm = CLLocationManager()
    private var pendingName: String?
    private var askedAlways = false
    /// Tells the page about changes (state) and the result of "Save where I am".
    var onState: ((String) -> Void)?
    var onSaved: ((Bool, String) -> Void)?

    nonisolated static var isOn: Bool { UserDefaults.standard.bool(forKey: "places") }

    override init() {
        super.init()
        lm.delegate = self
    }

    /// "off", "need-location", "need-background" (Always) or "on", as the page shows it.
    var state: String {
        guard Self.isOn else { return "off" }
        switch lm.authorizationStatus {
        case .authorizedAlways: return "on"
        case .authorizedWhenInUse: return "need-background"
        default: return "need-location"
        }
    }

    func setOn(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "places")
        if on { askPermission() }
        sync()
        onState?(state)
    }

    func askPermission() {
        switch lm.authorizationStatus {
        case .notDetermined: lm.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            askedAlways = true
            lm.requestAlwaysAuthorization()
        case .denied, .restricted:
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        default: break
        }
    }

    func savePlaceHere(_ name: String) {
        pendingName = name
        switch lm.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: lm.requestLocation()
        default: askPermission()
        }
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let server = SharedStore.server, let url = URL(string: server + path) else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("SaraPhone/1 (iOS)", forHTTPHeaderField: "User-Agent")
        if let c = SharedStore.cookie { req.setValue(c, forHTTPHeaderField: "Cookie") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    /// Fetches the places to watch and sets the regions; off (or no "Always"): removes them.
    func sync() {
        let ours = lm.monitoredRegions.filter { $0.identifier.hasPrefix("sara-place-") }
        guard Self.isOn, lm.authorizationStatus == .authorizedAlways, let req = request("/api/places/watch") else {
            for r in ours { lm.stopMonitoring(for: r) }
            return
        }
        URLSession.shared.dataTask(with: req) { data, res, _ in
            guard (res as? HTTPURLResponse)?.statusCode == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let places = json["places"] as? [[String: Any]] else { return }
            Task { @MainActor in self.apply(places) }
        }.resume()
    }

    private func apply(_ places: [[String: Any]]) {
        var keep = Set<String>()
        for p in places {
            guard let id = p["id"] as? Int, let lat = p["lat"] as? Double, let lon = p["lon"] as? Double else { continue }
            let radius = min(p["radius"] as? Double ?? 150, lm.maximumRegionMonitoringDistance)
            let events = p["events"] as? [String] ?? ["arrive"]
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lon), radius: radius, identifier: "sara-place-\(id)")
            region.notifyOnEntry = events.contains("arrive")
            region.notifyOnExit = events.contains("leave")
            lm.startMonitoring(for: region)
            keep.insert(region.identifier)
        }
        for r in lm.monitoredRegions where r.identifier.hasPrefix("sara-place-") && !keep.contains(r.identifier) {
            lm.stopMonitoring(for: r)
        }
    }

    private func report(_ region: CLRegion, _ event: String) {
        guard Self.isOn, let id = Int(region.identifier.replacingOccurrences(of: "sara-place-", with: "")),
              let req = request("/api/places/\(id)/event", method: "POST", body: ["event": event]) else { return }
        URLSession.shared.dataTask(with: req) { _, _, _ in
            Task { @MainActor in self.sync() }
        }.resume()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if Self.isOn, self.lm.authorizationStatus == .authorizedWhenInUse, !self.askedAlways {
                self.askedAlways = true
                self.lm.requestAlwaysAuthorization()
            }
            if self.pendingName != nil, [.authorizedAlways, .authorizedWhenInUse].contains(self.lm.authorizationStatus) { self.lm.requestLocation() }
            self.sync()
            self.onState?(self.state)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
        Task { @MainActor in
            guard let name = self.pendingName else { return }
            self.pendingName = nil
            guard let req = self.request("/api/places", method: "POST", body: ["name": name, "lat": lat, "lon": lon]) else { return }
            URLSession.shared.dataTask(with: req) { data, res, _ in
                let ok = (res as? HTTPURLResponse)?.statusCode == 201
                let err = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["error"] as? String
                Task { @MainActor in
                    self.onSaved?(ok, ok ? "Saved: \(name)" : err ?? "Couldn't reach your server.")
                    self.sync()
                }
            }.resume()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard self.pendingName != nil else { return }
            self.pendingName = nil
            self.onSaved?(false, "Couldn't find where you are. Try again outside or near a window.")
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        Task { @MainActor in self.report(region, "arrive") }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        Task { @MainActor in self.report(region, "leave") }
    }
}
