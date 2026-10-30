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
        ucc.addUserScript(WKUserScript(source: Coordinator.lookScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        ucc.add(context.coordinator, name: "sara")
        config.userContentController = ucc

        let web = SaraWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        // No white flash: until the page draws, and behind it when it scrolls, the theme's colour.
        web.isOpaque = false
        web.backgroundColor = model.look.uiBg
        web.scrollView.backgroundColor = web.backgroundColor
        web.underPageBackgroundColor = web.backgroundColor
        // The page draws under the status bar and home indicator itself (viewport-fit=cover and
        // env(safe-area-inset-*)): no automatic insets on top, so nothing is padded twice.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // The page is an app shell (its own lists scroll): no rubber band around the whole page.
        web.scrollView.bounces = false
        web.scrollView.alwaysBounceVertical = false
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

        /// The app's own script in each page (not the page's): tells the app the theme the page shows
        /// (html[data-theme], from web/theme-boot.js and the page's appearance settings) and the
        /// colour at its top edge, for the status bar. Checked when the theme changes and once a second.
        static let lookScript = """
        (function(){if(window.__saraLook)return;var H=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.sara;if(!H)return;
        var last='';function hex(n){n=Math.max(0,Math.min(255,Math.round(n)));return(n<16?'0':'')+n.toString(16)}
        function parse(c){if(!c)return null;var m=c.match(/-?[\\d.]+/g);if(!m||m.length<3)return null;var k=/^color\\(/.test(c)?255:1;return[+m[0]*k,+m[1]*k,+m[2]*k,m.length>3?+m[3]:1]}
        function at(y,base){var e=document.elementFromPoint(innerWidth/2,y),L=[];while(e&&e.nodeType===1){var c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0){L.push(c);if(c[3]>=1)break}e=e.parentElement}
        var d=document.querySelector('dialog[open]');try{if(d&&d.matches(':modal')){var r=d.getBoundingClientRect();if(y<r.top||y>r.bottom){var b=parse(getComputedStyle(d,'::backdrop').backgroundColor);if(b&&b[3]>0)L.unshift(b)}}}catch(x){}
        var o=base.slice();for(var i=L.length-1;i>=0;i--){var a=L[i][3];o=[o[0]*(1-a)+L[i][0]*a,o[1]*(1-a)+L[i][1]*a,o[2]*(1-a)+L[i][2]*a]}return'#'+hex(o[0])+hex(o[1])+hex(o[2])}
        function send(){var R=document.documentElement,day=R.getAttribute('data-theme')==='light',m=document.querySelector('meta[name="theme-color"]'),base=day?[250,247,245]:[15,13,23];
        if(m&&/^#[0-9a-f]{6}$/i.test(m.content))base=[parseInt(m.content.slice(1,3),16),parseInt(m.content.slice(3,5),16),parseInt(m.content.slice(5,7),16)];
        var top=at(1,base),k=day+'|'+top;if(k===last)return;last=k;H.postMessage({cmd:'look',theme:day?'day':'night',top:top})}
        function safe(){try{send()}catch(e){}}window.__saraLook=safe;setInterval(function(){if(!document.hidden)safe()},1000);addEventListener('resize',safe);
        try{new MutationObserver(safe).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']})}catch(e){}safe()})();
        """

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
            switch cmd {
            case "look":
                // Only from her server's own pages (not the app's offline card).
                guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == serverHost else { return }
                model.pageLook(theme: body["theme"] as? String ?? "night", top: body["top"] as? String ?? "")
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
            #if DEBUG
            // Test runs: -SaraTestJS <script> runs once in the first page that finishes loading.
            if let js = UserDefaults.standard.string(forKey: "SaraTestJS"), !Self.testJSDone {
                Self.testJSDone = true
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
            #endif
        }

        #if DEBUG
        static var testJSDone = false
        #endif

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let e = error as NSError
            if e.code == NSURLErrorCancelled { return }
            let server = model.server ?? ""
            let host = server.components(separatedBy: "://").last ?? server
            // The same card as the web's and the desktop apps' "Can't reach your Sara" page, in the
            // new look's Night or Day colours (whichever the page showed last).
            let day = model.look.day
            model.topDark = !day
            let tokens = day
                ? "--bg:#faf7f5;--card:#ffffff;--line:rgba(46,22,54,.16);--text:#221a2a;--muted:#5e5469;--btn:linear-gradient(135deg,#b8436a,#7a50d2);--quiet:#f4eef1;--glow1:rgba(155,107,255,.07);--glow2:rgba(224,96,126,.06);--shadow:0 2px 6px rgba(60,30,70,.08),0 18px 44px rgba(60,30,70,.14)"
                : "--bg:#0f0d17;--card:#17141f;--line:rgba(255,255,255,.14);--text:#f1edf7;--muted:#aea6bd;--btn:linear-gradient(135deg,#a8456d,#6d48c4);--quiet:#1e1a29;--glow1:rgba(155,107,255,.10);--glow2:rgba(224,96,126,.08);--shadow:0 18px 48px rgba(0,0,0,.5)"
            let html = """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
            <style>
            :root{\(tokens);color-scheme:\(day ? "light" : "dark")}
            *{box-sizing:border-box}html,body{height:100%;margin:0}
            body{background:radial-gradient(1200px 600px at 70% -10%,var(--glow1),transparent 60%),radial-gradient(900px 500px at 0% 110%,var(--glow2),transparent 60%),var(--bg);color:var(--text);font:17px/1.45 -apple-system,system-ui,sans-serif;display:grid;place-items:center;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));-webkit-user-select:none}
            .c{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px 24px 24px;box-shadow:var(--shadow)}
            h1{font-size:24px;line-height:1.2;font-weight:650;letter-spacing:-.02em;margin:0 0 10px}p{color:var(--muted);margin:0 0 12px}b{color:var(--text)}.small{font-size:14px}
            a{display:flex;align-items:center;justify-content:center;min-height:48px;text-decoration:none;font-weight:600;padding:0 16px;border-radius:12px;margin-top:10px}
            .p{background:var(--btn);color:#fff;margin-top:20px}.g{background:var(--quiet);border:1px solid var(--line);color:var(--text)}
            </style>
            <div class=c><h1>Can't reach your Sara</h1>
            <p><b>\(htmlEscape(host))</b> isn't answering. Check your connection, that the address is right, and that Sara is running there.</p>
            <p class=small>\(htmlEscape(e.localizedDescription))</p>
            <a class=p href="\(htmlEscape(server))/">Try again</a><a class=g href="sara://setup">Add a Sara</a></div>
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

/// For text put into the app's own small pages.
func htmlEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "'", with: "&#39;").replacingOccurrences(of: "\"", with: "&quot;")
}

/// The web view. It keeps the phone's own light/dark setting even while the app's screens follow
/// the page's theme for the status bar (AppModel.applyStatusStyle), so the page's "Follow the
/// system" theme (prefers-color-scheme) still works.
final class SaraWebView: WKWebView {
    private var watching: UITraitChangeRegistration?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        followSystemStyle()
        // The window keeps the system's traits (only the root view controller follows the page),
        // so it tells us when the phone switches between light and dark while the app is open.
        if watching == nil, let window {
            watching = window.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (_: UIWindow, _: UITraitCollection) in
                self?.followSystemStyle()
            }
        }
    }

    func followSystemStyle() {
        guard let window else { return }
        let style = window.traitCollection.userInterfaceStyle
        if overrideUserInterfaceStyle != style { overrideUserInterfaceStyle = style }
    }
}
