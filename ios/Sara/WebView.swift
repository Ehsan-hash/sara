import SwiftUI
import WebKit

/// The web app, with a small bridge (window.SaraPhone) the page uses to talk to the app.
struct WebView: UIViewRepresentable {
    @ObservedObject var model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Phase 68: each saved server has its own website data store (its own sign-in).
        config.websiteDataStore = Servers.dataStore(Servers.active)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // "SaraPhone/1" tells the server and the page this is the phone app (no adult-mode switch here).
        config.applicationNameForUserAgent = "Mobile/15E148 Safari/604.1 SaraPhone/1"
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: Coordinator.bridge(appLock: AppModel.appLockOn, canLock: AppModel.canLock, places: PlacesManager.shared.state, servers: Servers.json(active: model.activeId)), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(context.coordinator, name: "sara")
        config.userContentController = ucc

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.071, green: 0.063, blue: 0.086, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        model.web = web
        // Live call events go to the page, which shows the call.
        CallManager.shared.onEvent = { [weak web] json in
            web?.evaluateJavaScript("window.saraCallEvent&&window.saraCallEvent(\(json))", completionHandler: nil)
        }
        // Her ring answered or declined on the system call screen (CallKit): the page follows.
        CallKitCenter.shared.onAnsweredRing = { [weak web] ring, conversation in
            let args = (try? String(data: JSONSerialization.data(withJSONObject: [ring, conversation]), encoding: .utf8)) ?? "[]"
            web?.evaluateJavaScript("(function(a){window.saraAnswerRing&&window.saraAnswerRing(a[0],a[1])})(\(args))", completionHandler: nil)
        }
        CallKitCenter.shared.onRingClosed = { [weak web] ring in
            let args = (try? String(data: JSONSerialization.data(withJSONObject: [ring]), encoding: .utf8)) ?? "[]"
            web?.evaluateJavaScript("(function(a){window.saraRingClosed&&window.saraRingClosed(a[0])})(\(args))", completionHandler: nil)
        }
        // Phase 29: place reminders tell the page their state and "Save where I am" results.
        PlacesManager.shared.onState = { [weak web] state in
            web?.evaluateJavaScript("if(window.SaraPhone){window.SaraPhone.placesState='\(state)'};window.saraPlacesChanged&&window.saraPlacesChanged()", completionHandler: nil)
        }
        PlacesManager.shared.onSaved = { [weak web] ok, message in
            let text = (try? String(data: JSONSerialization.data(withJSONObject: [message]), encoding: .utf8)) ?? "[\"\"]"
            web?.evaluateJavaScript("window.saraPlaceSaved&&window.saraPlaceSaved(\(ok),\(text)[0])", completionHandler: nil)
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        guard let path = model.pending, let server = model.server, let url = URL(string: server + path) else { return }
        DispatchQueue.main.async { model.pending = nil }
        web.load(URLRequest(url: url))
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let model: AppModel
        init(model: AppModel) { self.model = model }

        /// window.SaraPhone: what the page can ask the app. Settings kept on the phone are read
        /// synchronously from here (the page reads them once).
        static func bridge(appLock: Bool, canLock: Bool, places: String, servers: String) -> String {
            """
            window.__saraServers = \(servers);
            window.SaraPhone = {
              platform: 'ios',
              servers: function () { return window.__saraServers; },
              useServer: function (id) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'useServer', id: String(id) }); },
              addServer: function () { window.webkit.messageHandlers.sara.postMessage({ cmd: 'changeServer' }); },
              removeServer: function (id) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'removeServer', id: String(id) }); },
              renameServer: function (id, name) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'renameServer', id: String(id), name: String(name) }); },
              serverName: function (name) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'serverName', name: String(name) }); },
              prefs: { appLock: \(appLock) },
              canLock: \(canLock),
              addWidget: function () { return false; },
              changeServer: function () { window.webkit.messageHandlers.sara.postMessage({ cmd: 'changeServer' }); },
              ready: function () { window.webkit.messageHandlers.sara.postMessage({ cmd: 'ready' }); },
              getPref: function (n) { return String(!!this.prefs[n]); },
              placesState: '\(places)',
              placesStatus: function () { return this.placesState; },
              fixPlacePermissions: function () { window.webkit.messageHandlers.sara.postMessage({ cmd: 'fixPlaces' }); },
              savePlaceHere: function (name) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'savePlace', name: String(name) }); },
              setPref: function (n, v) {
                if (n === 'places') {
                  this.placesState = v ? 'need-location' : 'off';
                  window.webkit.messageHandlers.sara.postMessage({ cmd: 'places', value: !!v });
                  return true;
                }
                if (n !== 'appLock') return false;
                if (v && !this.canLock) { alert('Set a passcode for this iPhone first (Settings → Face ID & Passcode).'); return false; }
                this.prefs[n] = !!v;
                window.webkit.messageHandlers.sara.postMessage({ cmd: 'setPref', name: n, value: !!v });
                return true;
              },
              startCall: function (id) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'startCall', conversation: String(id) }); },
              answerCall: function (id, ring) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'startCall', conversation: String(id), ring: String(ring) }); },
              hangUp: function () { window.webkit.messageHandlers.sara.postMessage({ cmd: 'hangUp' }); },
              ring: function (id, conversation, seconds) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'ring', id: String(id), conversation: String(conversation), seconds: Number(seconds) || 45 }); return true; },
              ringEnded: function (id, state) { window.webkit.messageHandlers.sara.postMessage({ cmd: 'ringEnded', id: String(id), state: String(state) }); }
            };
            """
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
            switch cmd {
            case "changeServer": model.changeServer()
            // Phase 68: the page's ⇄ menu (names and hosts only reach the page).
            case "useServer":
                if let id = body["id"] as? String { model.switchTo(id) }
            case "removeServer":
                if let id = body["id"] as? String { model.removeServer(id) }
            case "renameServer", "serverName":
                let byUser = cmd == "renameServer"
                if let id = byUser ? body["id"] as? String : model.activeId { model.renameServer(id, body["name"] as? String ?? "", byUser: byUser) }
                message.webView?.evaluateJavaScript("window.__saraServers=\(Servers.json(active: model.activeId));window.saraServersChanged&&window.saraServersChanged()", completionHandler: nil)
            case "ready":
                model.signedIn()
                model.registerToken()
            case "setPref":
                if body["name"] as? String == "appLock" { AppModel.appLockOn = body["value"] as? Bool ?? false }
            case "startCall":
                guard let id = body["conversation"] as? String, let server = model.server else { return }
                model.saveCookies()
                CallManager.shared.start(server: server, conversation: id, cookie: SharedStore.cookie, ring: body["ring"] as? String)
            case "hangUp":
                CallManager.shared.hangUp()
            case "ring":
                // She is calling while the app is open: the system's incoming call screen (CallKit).
                guard let id = body["id"] as? String, let conv = body["conversation"] as? String else { return }
                model.saveCookies()
                _ = CallKitCenter.shared.reportRing(id: id, conversation: conv, seconds: body["seconds"] as? Double ?? 45)
            case "ringEnded":
                if let id = body["id"] as? String { CallKitCenter.shared.ringEnded(id: id, state: body["state"] as? String ?? "missed") }
            case "places":
                PlacesManager.shared.setOn(body["value"] as? Bool ?? false)
            case "fixPlaces":
                PlacesManager.shared.askPermission()
            case "savePlace":
                if let name = body["name"] as? String { PlacesManager.shared.savePlaceHere(name) }
            default: break
            }
        }

        private var serverHost: String? { model.server.flatMap { URL(string: $0)?.host } }

        // Links to other sites open in Safari; sara:// links are handled here.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.allow) }
            if scheme == "sara" {
                model.handle(url: url)
                return decisionHandler(.cancel)
            }
            if scheme == "http" || scheme == "https" {
                if url.host != serverHost, action.targetFrame?.isMainFrame ?? true {
                    UIApplication.shared.open(url)
                    return decisionHandler(.cancel)
                }
                return decisionHandler(.allow)
            }
            if ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }
            UIApplication.shared.open(url) // mailto:, tel:, …
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.saveCookies()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let e = error as NSError
            if e.code == NSURLErrorCancelled { return }
            let server = model.server ?? ""
            let html = """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="background:#121016;color:#eee9f3;font:17px -apple-system,sans-serif;padding:48px 28px">
            <h2>Can't reach your companion</h2>
            <p style="color:#a49cae">\(e.localizedDescription)</p>
            <p><a style="color:#e0789a" href="\(server)/">Try again</a> &nbsp;·&nbsp; <a style="color:#e0789a" href="sara://setup">Change server</a></p>
            </body>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // Microphone and camera (voice notes, calls, photos) only for her own server.
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == serverHost ? .grant : .deny)
        }

        // alert(), confirm() and prompt() from the page.
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            if !present(a, from: webView) { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            if !present(a, from: webView) { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
            if !present(a, from: webView) { completionHandler(nil) }
        }

        private func present(_ vc: UIViewController, from view: UIView) -> Bool {
            guard var top = view.window?.rootViewController else { return false }
            while let p = top.presentedViewController { top = p }
            top.present(vc, animated: true)
            return true
        }
    }
}
