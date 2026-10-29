// Sara for Mac (Phase 33): a native window around the owner's own Sara server, using the system's
// WebKit. Menu bar icon (keeps running when the window is closed), notifications, open at login,
// microphone for calls, first-run setup (server address, then the server's own /pair page for the
// sign-in code). No credentials are stored here: the sign-in is the server's session cookie, kept in
// the app's own WebKit storage.
// Phase 46d: the app also carries Sara's server and sets it up on this Mac (Setup.swift,
// Server.swift); `Sara --run-server` is launchd's supervisor and `Sara --cli …` the `sara` command.
// Phase 55: the first launch asks "Run Sara on this Mac" or "Connect to a Sara somewhere else"; the
// menu switches both ways later, and an unreachable server shows "Can't reach your Sara".
// Phase 68: several Sara servers, each with its own sign-in (Servers.swift).
import AppKit
import ServiceManagement
import UserNotifications
import WebKit

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.33.0"
let prefs = UserDefaults.standard

/// Reached without HTTPS when no scheme is typed: localhost, *.local and IP addresses (a home
/// network, Tailscale's 100.x addresses). The same rule as the Windows app and installer.
func plainHTTPHost(_ hostPort: String) -> Bool {
  if hostPort.hasPrefix("[") { return true }
  let name = hostPort.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
  if name == "localhost" || (name.count > 6 && name.hasSuffix(".local")) { return true }
  let parts = name.split(separator: ".", omittingEmptySubsequences: false)
  return parts.count == 4 && parts.allSatisfy { p in !p.isEmpty && p.count <= 3 && p.allSatisfy(\.isASCII) && p.allSatisfy(\.isNumber) && (Int(p) ?? 999) <= 255 }
}

/// "https://host:port/anything" → "https://host:port"; nil if it isn't an http(s) address.
/// Without a scheme: https, except for plainHTTPHost addresses.
func originOf(_ raw: String) -> String? {
  var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if !s.contains("://") {
    let host = String(s.prefix { $0 != "/" && $0 != "?" && $0 != "#" }).lowercased()
    s = (plainHTTPHost(host) ? "http://" : "https://") + s
  }
  guard let u = URLComponents(string: s), let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http",
        let host = u.host?.lowercased(), !host.isEmpty, u.user == nil else { return nil }
  return "\(scheme)://\(host)" + (u.port.map { ":\($0)" } ?? "")
}

func htmlEscape(_ s: String) -> String {
  s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "'", with: "&#39;").replacingOccurrences(of: "\"", with: "&quot;")
}

let pageStyle = """
<meta name=viewport content='width=device-width'><style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#121016;color:#eee;
display:flex;align-items:center;justify-content:center;height:100vh}.c{max-width:420px;padding:28px;background:#1c1922;border-radius:16px;box-shadow:0 10px 40px #0006}
h1{font-size:22px;margin:0 0 8px}p{color:#aaa;line-height:1.45;font-size:14px}input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;
border:1px solid #444;background:#0f0d12;color:#eee;font-size:15px}button{margin-top:14px;padding:10px 18px;border:0;border-radius:9px;background:#c76b98;color:#fff;
font-size:15px;cursor:pointer}button.g{background:none;border:1px solid #555;color:#ccc;margin-left:8px}#e{color:#f88;font-size:13px;min-height:1em}</style>
"""

/// The page side of window.SaraDesktop. call() returns a promise (WebKit replies to the message).
let shim = """
(() => {
  if (window.SaraDesktop || !window.webkit || !webkit.messageHandlers.sara) return;
  const post = (o) => webkit.messageHandlers.sara.postMessage(o);
  window.SaraDesktop = {
    platform: 'mac',
    call(m, a = {}) { return post({ m, ...a }); },
    notify(title, body, conv) { post({ m: 'notify', title: String(title || ''), body: String(body || ''), conv: String(conv || '') }).catch(() => {}); },
    attention(kind) { post({ m: 'attention', kind: String(kind || '') }).catch(() => {}); },
  };
})();
"""

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandlerWithReply, UNUserNotificationCenterDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var statusItem: NSStatusItem!
  var server: String? { prefs.string(forKey: "server").flatMap { $0.isEmpty ? nil : $0 } }
  var quitting = false
  let local = LocalServer()
  var setupSheet: SetupSheet?
  var serverState = "Checking…"
  var serverItems: [NSMenuItem] = []
  /// Phase 68: the saved server the web view's data store belongs to, and one being removed.
  var webServerId: String?
  var pendingRemove: String?

  // MARK: start-up
  /// The web view, on the data store of the server it shows (Phase 68: one store per server).
  func makeWebView(store: WKWebsiteDataStore, for id: String?) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = store
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15 SaraDesktop/1 (Mac)"
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "sara")
    config.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    if let old = web {
      old.stopLoading()
      old.configuration.userContentController.removeAllScriptMessageHandlers()
    }
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    web.allowsBackForwardNavigationGestures = true
    webServerId = id
    window?.contentView = web
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()
    // Phase 68: the saved servers (the one from before 1.8 becomes the first, as it was).
    let current = Servers.active
    makeWebView(store: Servers.dataStore(current), for: current?.id)

    let frame = NSRect(x: 0, y: 0, width: 1100, height: 780)
    window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.title = "Sara"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(red: 0x12 / 255, green: 0x10 / 255, blue: 0x16 / 255, alpha: 1)
    window.minSize = NSSize(width: 380, height: 500)
    window.contentView = web
    window.delegate = self
    window.isReleasedWhenClosed = false
    window.center()
    window.setFrameAutosaveName("SaraMain")

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    if let img = NSImage(systemSymbolName: "heart.circle", accessibilityDescription: "Sara") {
      img.isTemplate = true
      statusItem.button?.image = img
    } else { statusItem.button?.title = "S" }
    statusItem.button?.toolTip = current.map { "Sara · \($0.name)" } ?? "Sara"
    statusItem.menu = statusMenu()

    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }

    let background = ProcessInfo.processInfo.arguments.contains("--background")
      || (NSAppleEventManager.shared().currentAppleEvent?.paramDescriptor(forKeyword: keyAELaunchedAsLogInItem) != nil)
    if !background { showWindow() }
    let migrating = migrateFromDaemonIfNeeded()
    let upgrading = migrating ? false : checkUpgrade()
    refreshServerState()
    Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refreshServerState() }
    #if DEBUG
    if let t = ProcessInfo.processInfo.environment["SARA_TEST_SETUP"], server == nil, !local.configured {
      // Test builds: "agent,local,7861" sets up without the sheet (no screen over SSH; the first
      // field is the old run mode and is ignored: she always runs while you're signed in).
      let p = t.split(separator: ",").map(String.init)
      let access = Access(rawValue: p.count > 1 ? p[1] : "") ?? .local
      let port = p.count > 2 ? Int(p[2]) ?? defaultPort : defaultPort
      DispatchQueue.global().async {
        let o = self.local.setUp(access: access, port: port)
        testLog("setup ok=\(o.ok) approval=\(o.needsApproval) notes=\(o.notes)")
        DispatchQueue.main.async { if o.needsApproval { self.askForApproval(notes: o.notes, changing: false) } else { self.waitForServer(notes: [], changing: false) } }
      }
      return
    }
    #endif
    if migrating { return }  // it opens her page when done
    if upgrading { return waitForUpgrade { [weak self] in self?.server == nil ? self?.startFirstRun() : self?.openServer() } }
    if server == nil { startFirstRun() } else { openServer() }
  }

  /// Phase 55: "from startup" (the LaunchDaemon) is gone; a Mac that used it moves to the agent.
  /// Returns true when it started (it then opens her page itself).
  func migrateFromDaemonIfNeeded() -> Bool {
    guard local.configured, local.readEnv()["SARA_MAC_RUN"] == "daemon" else { return false }
    web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Updating Sara…</h1><p>She now runs while you're signed in to this Mac.</p></div></body></html>", baseURL: nil)
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let o = self.local.migrateFromDaemon() ?? LocalServer.Outcome()
      DispatchQueue.main.async {
        if o.needsApproval { return self.askForApproval(notes: o.notes, changing: true) }
        if !o.ok { self.alert("Sara couldn't move to the new way of running", o.notes.joined(separator: "\n\n")) }
        if self.server == nil { self.startFirstRun() } else if self.isLocalServer { self.waitForServer(notes: o.notes, changing: true) } else { self.openServer() }
      }
    }
    return true
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    showWindow()
    return true
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { .terminateNow }

  func showWindow() {
    NSApp.setActivationPolicy(.regular)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  // Closing the window keeps her running in the menu bar (unless that's turned off).
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if quitting || !keepRunning { NSApp.terminate(nil); return true }
    window.orderOut(nil)
    NSApp.setActivationPolicy(.accessory)
    if !prefs.bool(forKey: "toldMenuBar") {
      prefs.set(true, forKey: "toldMenuBar")
      postNotification(title: "Sara is still here", body: "She keeps running in the menu bar so she can reach you. Click her icon there to quit.", conv: "")
    }
    return false
  }

  var keepRunning: Bool { prefs.object(forKey: "keepRunning") as? Bool ?? true }
  var notificationsOn: Bool { prefs.object(forKey: "notifications") as? Bool ?? true }
  var startAtLogin: Bool { SMAppService.mainApp.status == .enabled }

  // MARK: menus
  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Sara", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    let srv = NSMenuItem(title: "Sara server", action: nil, keyEquivalent: "")
    srv.submenu = serverMenu()
    serverItems.append(srv)
    appMenu.addItem(srv)
    appMenu.delegate = self
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Sara", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit Sara", action: #selector(quit), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)
    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    main.addItem(editItem)
    let viewItem = NSMenuItem()
    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
    viewItem.submenu = view
    main.addItem(viewItem)
    let winItem = NSMenuItem()
    let win = NSMenu(title: "Window")
    win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    winItem.submenu = win
    main.addItem(winItem)
    NSApp.mainMenu = main
    NSApp.windowsMenu = win
  }

  func statusMenu() -> NSMenu {
    let m = NSMenu()
    m.addItem(withTitle: "Open Sara", action: #selector(openFromMenu), keyEquivalent: "")
    let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
    m.addItem(login)
    let srv = NSMenuItem(title: "Sara server", action: nil, keyEquivalent: "")
    srv.submenu = serverMenu()
    serverItems.append(srv)
    m.addItem(srv)
    m.addItem(.separator())
    m.addItem(withTitle: "Quit Sara", action: #selector(quit), keyEquivalent: "")
    m.delegate = self
    return m
  }

  @objc func openFromMenu() { showWindow() }
  @objc func reload() {
    if server == nil { showSetup() } else { web.reload() }
  }
  @objc func toggleLogin() { setStartAtLogin(!startAtLogin) }
  @objc func quit() {
    quitting = true
    NSApp.terminate(nil)
  }

  func setStartAtLogin(_ on: Bool) {
    do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } } catch { NSLog("Sara login item: \(error)") }
  }

  // MARK: pages
  func openServer(_ path: String = "/") {
    guard let s = server, let url = URL(string: s + path) else { return showSetup() }
    web.load(URLRequest(url: url))
  }

  func showSetup(_ error: String = "") {
    // Phase 68: with a Sara already here, this page adds another one; Back returns to her.
    let here = Servers.active
    let last = here == nil ? htmlEscape(prefs.string(forKey: "lastServer") ?? "") : ""
    let back = here.map { "<p>Your other Saras stay signed in.</p><button class=g id=k>Back to \(htmlEscape($0.name))</button>" } ?? ""
    let html = """
    <!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>\(here == nil ? "Connect to your Sara" : "Add a Sara")</h1><p>Type the address of \(here == nil ? "your" : "another") Sara (the one you open in a web browser,
    for example <b>sara.example.com</b>).</p><input id=u autofocus placeholder='sara.example.com' value='\(last)'><p id=e>\(htmlEscape(error))</p><button id=b>Continue</button>
    <p>Next you sign in with a code from Settings → Devices and sign-in on a device where you're already signed in.</p>\(local.hasBundledServer ? "<p><a href='#' id=l style='color:#e3a3c3'>Or run Sara on this Mac instead</a></p>" : "")\(back)</div><script>
    const k=document.getElementById('k');if(k)k.onclick=()=>webkit.messageHandlers.sara.postMessage({m:'retry'});
    const l=document.getElementById('l');if(l)l.onclick=(e)=>{e.preventDefault();webkit.messageHandlers.sara.postMessage({m:'setupLocal'})};
    const go=()=>webkit.messageHandlers.sara.postMessage({m:'setServer',url:document.getElementById('u').value});
    document.getElementById('b').onclick=go;document.getElementById('u').onkeydown=e=>e.key==='Enter'&&go();</script></body></html>
    """
    web.loadHTMLString(html, baseURL: nil)
  }

  func showOffline() {
    let why = isLocalServer
      ? (local.stopped ? "She is stopped on this Mac. Start her from the menu bar: Sara server → Start." : "She runs on this Mac and may still be starting; if not, her log says why (Sara server → Open data folder → logs).")
      : "Check your internet connection, that the address is right, and that Sara is running there."
    // Phase 68: the other saved Saras are one click away.
    let others = Servers.list().filter { $0.id != Servers.activeId }.map { "<button class=g data-id='\(htmlEscape($0.id))'>\(htmlEscape($0.name))</button>" }.joined()
    let html = """
    <!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Can't reach your Sara</h1><p>Sara at <b>\(htmlEscape(server ?? ""))</b> isn't answering.</p><p>\(htmlEscape(why))</p><button id=r>Try again</button><button class=g id=s>Add a Sara</button>\(others)</div><script>
    document.getElementById('r').onclick=()=>webkit.messageHandlers.sara.postMessage({m:'retry'});
    for(const b of document.querySelectorAll('[data-id]'))b.onclick=()=>webkit.messageHandlers.sara.postMessage({m:'useServer',id:b.dataset.id});
    document.getElementById('s').onclick=()=>webkit.messageHandlers.sara.postMessage({m:'changeServer'});
    setTimeout(()=>webkit.messageHandlers.sara.postMessage({m:'retry'}),30000);</script></body></html>
    """
    web.loadHTMLString(html, baseURL: nil)
  }

  func isServer(_ url: URL?) -> Bool {
    guard let url, let s = server, let o = originOf(url.absoluteString) else { return false }
    return o == s
  }

  // MARK: the bridge
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard let body = message.body as? [String: Any], let kind = body["m"] as? String else { return replyHandler(nil, "Bad message") }
    let origin = message.frameInfo.securityOrigin
    let fromServer = server.map { s in originOf("\(origin.protocol)://\(origin.host)" + (origin.port > 0 ? ":\(origin.port)" : "")) == s } ?? false
    switch kind {
    // The local setup/offline pages may only set the server, retry or change server.
    case "setServer":
      guard let o = originOf(body["url"] as? String ?? "") else {
        showSetup("That doesn't look like a web address. Try something like sara.example.com.")
        return replyHandler(nil, nil)
      }
      prefs.set(o, forKey: "lastServer")
      // Phase 68: a saved server again, or a new one next to the others (nobody is signed out).
      if !Servers.list().contains(where: { $0.url == o }) && Servers.list().contains(where: { $0.url != o }) && !Servers.canHoldSeveral {
        alert("Several Saras need macOS 14", "This Mac can keep one Sara server signed in. Remove the other one first (Sara server → Remove…), or update macOS.")
        return replyHandler(nil, nil)
      }
      useServer(Servers.idFor(o), path: "/pair")
      return replyHandler(true, nil)
    case "retry":
      openServer()
      return replyHandler(true, nil)
    case "setupLocal", "chooseLocal":
      chooseLocal()
      return replyHandler(true, nil)
    case "chooseRemote":
      showSetup()
      return replyHandler(true, nil)
    case "changeServer":
      showSetup()
      return replyHandler(true, nil)
    case "useServer" where !fromServer:
      useServer(body["id"] as? String ?? "")
      return replyHandler(true, nil)
    default: break
    }
    guard fromServer else { return replyHandler(nil, "Not allowed") }  // everything else only from the owner's own server
    switch kind {
    case "getPrefs": replyHandler(prefsDict(), nil)
    case "setPref":
      let on = body["value"] as? Bool ?? false
      switch body["key"] as? String {
      case "startAtLogin": setStartAtLogin(on)
      case "keepRunning": prefs.set(on, forKey: "keepRunning")
      case "notifications": prefs.set(on, forKey: "notifications")
      default: return replyHandler(nil, "Unknown setting")
      }
      replyHandler(prefsDict(), nil)
    case "testNotification":
      postNotification(title: body["title"] as? String ?? "Sara", body: body["body"] as? String ?? "", conv: "")
      replyHandler(true, nil)
    case "notify":
      if notificationsOn && !(window.isKeyWindow && NSApp.isActive) {
        postNotification(title: body["title"] as? String ?? "Sara", body: body["body"] as? String ?? "", conv: body["conv"] as? String ?? "")
      }
      replyHandler(true, nil)
    case "attention":
      showWindow()
      NSApp.requestUserAttention(.criticalRequest)
      replyHandler(true, nil)
    // Phase 68: the page's ⇄ menu. Names and hosts only: no sign-in ever goes to a page.
    case "servers": replyHandler(Servers.json(), nil)
    case "useServer":
      replyHandler(true, nil)
      useServer(body["id"] as? String ?? "")
    case "addServer":
      replyHandler(true, nil)
      addServerFromMenu()
    case "removeServer":
      replyHandler(true, nil)
      removeServer(body["id"] as? String ?? "")
    case "renameServer", "serverName":
      let byUser = kind == "renameServer"
      let id = byUser ? body["id"] as? String ?? "" : Servers.activeId ?? ""
      let name = (body["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if !name.isEmpty, let p = Servers.list().first(where: { $0.id == id }), byUser || !p.named {
        Servers.update(id) { s in
          s.name = Servers.uniqueName(name, url: s.url, except: s.id)
          if byUser { s.named = true }
        }
        if id == Servers.activeId { statusItem?.button?.toolTip = "Sara · \(Servers.active?.name ?? name)" }
      }
      replyHandler(Servers.json(), nil)
    default: replyHandler(nil, "Unknown")
    }
  }

  func prefsDict() -> [String: Any] {
    ["platform": "mac", "version": appVersion, "startAtLogin": startAtLogin, "keepRunning": keepRunning, "notifications": notificationsOn, "server": server ?? ""]
  }

  // MARK: notifications
  func postNotification(title: String, body: String, conv: String) {
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    c.sound = .default
    if !conv.isEmpty { c.userInfo = ["conv": conv] }
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    showWindow()
    if let conv = r.notification.request.content.userInfo["conv"] as? String, !conv.isEmpty,
       let data = try? JSONSerialization.data(withJSONObject: [conv]), let arr = String(data: data, encoding: .utf8) {
      web.evaluateJavaScript("location.hash = 'c=' + \(arr)[0]")
    }
    done()
  }

  // MARK: navigation: only the owner's server opens inside the app; other links go to the browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
    let url = action.request.url
    if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
    if url?.scheme == "about" || url?.scheme == "blob" || url?.scheme == "data" || isServer(url) || (url?.absoluteString == "about:blank") {
      return decisionHandler(.allow, preferences)
    }
    decisionHandler(.cancel, preferences)
    if let url, url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" { NSWorkspace.shared.open(url) }
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType ? .download : .allow)
  }

  func webView(_ webView: WKWebView, didFinish nav: WKNavigation!) {
    // Phase 68: removing a server that wasn't in use: now it's open, sign out there.
    if let r = pendingRemove, r == Servers.activeId, isServer(webView.url) {
      pendingRemove = nil
      removeActiveServer()
    }
    #if DEBUG
    testHook(webView)
    #endif
  }

  #if DEBUG
  // Test builds only (swiftc -D DEBUG): SARA_TEST_JS runs that script after each page load and
  // appends its result to SARA_TEST_OUT, so the app can be checked over SSH without a screen.
  func testHook(_ webView: WKWebView) {
    let env = ProcessInfo.processInfo.environment
    guard let js = env["SARA_TEST_JS"].flatMap({ try? String(contentsOfFile: $0, encoding: .utf8) }), let out = env["SARA_TEST_OUT"] else { return }
    webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
      let line: String
      switch result {
      case .success(let v): line = "\(webView.url?.absoluteString ?? "?") => \(v)\n"
      case .failure(let e): line = "\(webView.url?.absoluteString ?? "?") !! \(e)\n"
      }
      if let h = FileHandle(forWritingAtPath: out) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile() }
      else { try? line.write(toFile: out, atomically: true, encoding: .utf8) }
    }
  }
  #endif

  func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
    let e = error as NSError
    if e.code == NSURLErrorCancelled || e.domain == "WebKitErrorDomain" { return }
    showOffline()
  }

  func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url {
      if isServer(url) { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  // Microphone (calls, voice messages): allowed for the owner's server only.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    let o = "\(origin.protocol)://\(origin.host)" + (origin.port > 0 ? ":\(origin.port)" : "")
    decisionHandler(server != nil && originOf(o) == server && type == .microphone ? .grant : .deny)
  }

  // alert / confirm / prompt and file pickers, as a browser would.
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let a = NSAlert()
    a.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    field.stringValue = defaultText ?? ""
    a.accessoryView = field
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let p = NSOpenPanel()
    p.allowsMultipleSelection = parameters.allowsMultipleSelection
    p.canChooseDirectories = parameters.allowsDirectories
    p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
  }

  // Downloads (log, export, files she made) go to Downloads.
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var url = dir.appendingPathComponent(suggestedFilename)
    var n = 1
    let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
    while FileManager.default.fileExists(atPath: url.path) {
      n += 1
      url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
    }
    completionHandler(url)
  }
  func downloadDidFinish(_ download: WKDownload) {
    postNotification(title: "Downloaded", body: "Saved to your Downloads folder.", conv: "")
  }
}

extension AppDelegate: NSMenuDelegate {
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.item(withTitle: "Open at Login")?.state = startAtLogin ? .on : .off
    for i in serverItems where i.menu === menu { i.submenu = serverMenu() }
  }
}

#if DEBUG
/// Test builds: a line into SARA_TEST_OUT.
func testLog(_ s: String) {
  guard let out = ProcessInfo.processInfo.environment["SARA_TEST_OUT"] else { return }
  let line = "native => \(s)\n"
  if let h = FileHandle(forWritingAtPath: out) { h.seekToEndOfFile(); h.write(Data(line.utf8)); h.closeFile() } else { try? line.write(toFile: out, atomically: true, encoding: .utf8) }
}
#endif

// launchd's supervisor and the `sara` command run without a window.
let argv = CommandLine.arguments
if argv.count > 1 && argv[1] == "--run-server" { Supervisor.run() }
if argv.count > 1 && argv[1] == "--cli" { exit(CLI.run(Array(argv.dropFirst(2)))) }

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
