// Phase 87 (computer use CU1, docs/design/COMPUTER_USE.md §2–§4): Sara's hands on this Mac.
// When the owner switches on "Let Sara use this computer" (Settings → Computer use in the app), the
// page gets a `hands` token from the server and hands it to this app; the app keeps it in the
// Keychain, opens its own WebSocket to <server>/api/hands (Authorization header, no cookies) and runs
// only CU1's command set in the Sara browser: a visible Chrome or Edge window with its own profile,
// driven over the DevTools protocol through a pipe (fds 3 and 4, no port). Reading pages goes through
// the one shared page agent (desktop/shared/page-agent.js, in Resources). The same protocol, command
// set and limits as the Windows app (desktop/windows/src/hands.cpp) and the reference hands
// (src/hands-ref.ts): the op allowlist, http(s) only, never the Sara server's own pages (except preview
// links), 20 page loads a minute, password fields never read, key-shaped text masked.
import Foundation
import Security

// MARK: small helpers

private func jsonText(_ o: Any) -> String {
  guard JSONSerialization.isValidJSONObject(o), let d = try? JSONSerialization.data(withJSONObject: o, options: [.fragmentsAllowed]) else { return "null" }
  return String(data: d, encoding: .utf8) ?? "null"
}
private func jsonQuote(_ s: String) -> String { jsonText([s]).dropFirst().dropLast().description }
private func parseJSON(_ s: String) -> [String: Any]? {
  guard let d = s.data(using: .utf8) else { return nil }
  return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}

private let secretShapes: [NSRegularExpression] = [
  "sk-[A-Za-z0-9_-]{16,}", "[sr]k_(live|test)_[A-Za-z0-9]{10,}", "gh[pousr]_[A-Za-z0-9]{20,}", "github_pat_[A-Za-z0-9_]{20,}",
  "xox[abprs]-[A-Za-z0-9-]{10,}", "AKIA[0-9A-Z]{16}", "AIza[0-9A-Za-z_-]{30,}", "xai-[A-Za-z0-9]{20,}",
  "sara_(dev|hands|m)\\.[\\w-]+\\.[\\w-]+", "eyJ[\\w-]{8,}\\.[\\w-]{8,}\\.[\\w-]{8,}",
].compactMap { try? NSRegularExpression(pattern: $0) }
/// Text that looks like a key or token is masked before it leaves this Mac.
func handsMask(_ s: String) -> String {
  var t = s
  for re in secretShapes { t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: "[hidden]") }
  return t
}
private func shortText(_ s: String, _ n: Int = 500) -> String {
  handsMask(String(s.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\r" || $0 == "\t" }).joined(separator: " ").prefix(n)))
}

/// The origin of an http(s) address, its path, and whether it has a user name in it.
private func httpOrigin(_ raw: String) -> (origin: String, path: String, userinfo: Bool)? {
  guard let u = URLComponents(string: raw), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https", let host = u.host?.lowercased(), !host.isEmpty else { return nil }
  let port = u.port.flatMap { (scheme == "http" && $0 == 80) || (scheme == "https" && $0 == 443) ? nil : $0 }
  return ("\(scheme)://\(host)" + (port.map { ":\($0)" } ?? ""), u.percentEncodedPath.isEmpty ? "/" : u.percentEncodedPath, u.user != nil || u.password != nil)
}
/// Whether the Sara browser may load an address (§4.1); the reason when not.
func handsAddressAllowed(_ url: String, serverOrigin: String) -> String? {
  if url == "about:blank" { return nil }
  guard let o = httpOrigin(url) else { return "The Sara browser only opens web addresses (http or https)." }
  if o.userinfo { return "Addresses with a user name or password are not opened." }
  if o.origin == serverOrigin && o.path.range(of: "^/preview/[0-9a-f]{32}(/|$)", options: .regularExpression) == nil { return "Sara's own server is never opened in the Sara browser." }
  return nil
}

struct HandsOpError: Error {
  let code: String
  let message: String
}

/// A request's stop flag (Stop, the server's cancel, the deadline).
final class HandsCancel {
  private let lock = NSLock()
  private var flag = false
  var isSet: Bool { lock.lock(); defer { lock.unlock() }; return flag }
  func set() { lock.lock(); flag = true; lock.unlock() }
}

// MARK: the Sara browser (Chrome or Edge over a DevTools pipe)

final class HandsBrowser {
  struct Tab {
    var id = "", targetId = "", sessionId = "", frameId = ""
    var logs: [[String: Any]] = []
    var consoleErrors = 0, failedRequests = 0, status = 0, loads = 0
    var requests: [String: (String, String)] = [:]
  }
  let serverOrigin: String
  let profileDir: URL
  let found: (path: String, kind: String, name: String)?
  private let cond = NSCondition()
  private var alive = false
  private var pid: pid_t = 0
  private var wfd: Int32 = -1, rfd: Int32 = -1
  private var nextId = 1
  private var results: [Int: [String: Any]] = [:]
  private var tabs: [String: Tab] = [:]
  private var order: [String] = []
  private var active = ""
  private var tabN = 0
  private(set) var seq = 0
  private let writeLock = NSLock()

  init(serverOrigin: String, profileDir: URL) {
    self.serverOrigin = serverOrigin
    self.profileDir = profileDir
    found = HandsBrowser.find()
  }

  static func find() -> (path: String, kind: String, name: String)? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    for (p, k, n) in [("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chrome", "Google Chrome"), ("\(home)/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chrome", "Google Chrome"),
                      ("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "edge", "Microsoft Edge"), ("/Applications/Chromium.app/Contents/MacOS/Chromium", "chromium", "Chromium")]
    where FileManager.default.isExecutableFile(atPath: p) { return (p, k, n) }
    return nil
  }

  var running: Bool { cond.lock(); defer { cond.unlock() }; return alive }

  func start() throws {
    if running { return }
    guard let f = found else { throw HandsOpError(code: "perm_missing", message: "There is no Google Chrome or Microsoft Edge on this Mac for the Sara browser.") }
    try? FileManager.default.createDirectory(at: profileDir, withIntermediateDirectories: true)
    var toChild: [Int32] = [0, 0], fromChild: [Int32] = [0, 0]
    guard pipe(&toChild) == 0, pipe(&fromChild) == 0 else { throw HandsOpError(code: "error", message: "Couldn't make the pipe to the Sara browser.") }
    var fa: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fa)
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0)
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0)
    // The browser reads DevTools commands from fd 3 and writes answers to fd 4.
    posix_spawn_file_actions_adddup2(&fa, toChild[0], 3)
    posix_spawn_file_actions_adddup2(&fa, fromChild[1], 4)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    // Nothing else of this app is inherited (only the descriptors set up above).
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT))
    let args = [f.path, "--user-data-dir=\(profileDir.path)", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
                "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-breakpad", "--no-pings", "--use-mock-keychain", "--password-store=basic",
                "--disable-features=Translate,MediaRouter,OptimizationHints,msEdgeSync,msImplicitSignin,msSignInFRE", "--window-size=1280,860", "about:blank"]
    var cargs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
    defer { for p in cargs { free(p) } }
    var child: pid_t = 0
    let rc = posix_spawn(&child, f.path, &fa, &attr, &cargs, environ)
    posix_spawn_file_actions_destroy(&fa)
    posix_spawnattr_destroy(&attr)
    Darwin.close(toChild[0])
    Darwin.close(fromChild[1])
    guard rc == 0 else {
      Darwin.close(toChild[1]); Darwin.close(fromChild[0])
      throw HandsOpError(code: "error", message: "The Sara browser didn't start.")
    }
    cond.lock()
    pid = child; wfd = toChild[1]; rfd = fromChild[0]; alive = true
    tabs = [:]; order = []; results = [:]
    cond.unlock()
    let reader = Thread { [weak self] in self?.readLoop() }
    reader.start()
    for _ in 0..<50 {
      let r = try call("Target.getTargets", [:])
      for t in (r["targetInfos"] as? [[String: Any]] ?? []) where t["type"] as? String == "page" {
        _ = try attach(t["targetId"] as? String ?? "")
      }
      if tabCount > 0 { break }
      Thread.sleep(forTimeInterval: 0.15)
    }
    if tabCount == 0 { _ = try newTab() }
  }

  func close() {
    if running { send("Browser.close", [:], session: nil) }
    cond.lock()
    let p = pid
    cond.unlock()
    if p > 0 {
      var status: Int32 = 0
      var waited = 0
      while waitpid(p, &status, WNOHANG) == 0 && waited < 30 { Thread.sleep(forTimeInterval: 0.1); waited += 1 }
      if waited >= 30 { kill(p, SIGKILL); waitpid(p, &status, 0) }  // only the browser this app started
    }
    cond.lock()
    if wfd >= 0 { Darwin.close(wfd) }
    wfd = -1; pid = 0; alive = false; tabs = [:]; order = []
    cond.broadcast()
    cond.unlock()
  }

  private func write(_ msg: [String: Any]) -> Bool {
    cond.lock()
    let fd = wfd
    cond.unlock()
    guard fd >= 0 else { return false }
    var data = Data(jsonText(msg).utf8)
    data.append(0)
    writeLock.lock()
    defer { writeLock.unlock() }
    return data.withUnsafeBytes { buf -> Bool in
      var off = 0
      while off < buf.count {
        let n = Darwin.write(fd, buf.baseAddress! + off, buf.count - off)
        if n <= 0 { return false }
        off += n
      }
      return true
    }
  }

  func send(_ method: String, _ params: [String: Any], session: String?) {
    cond.lock()
    let id = nextId; nextId += 1
    cond.unlock()
    var m: [String: Any] = ["id": id, "method": method, "params": params]
    if let session { m["sessionId"] = session }
    _ = write(m)
  }

  /// A DevTools command and its answer.
  func call(_ method: String, _ params: [String: Any], session: String? = nil, timeout: TimeInterval = 15, cancel: HandsCancel? = nil) throws -> [String: Any] {
    cond.lock()
    guard alive else { cond.unlock(); throw HandsOpError(code: "error", message: "The Sara browser was closed.") }
    let id = nextId; nextId += 1
    cond.unlock()
    var m: [String: Any] = ["id": id, "method": method, "params": params]
    if let session { m["sessionId"] = session }
    guard write(m) else { throw HandsOpError(code: "error", message: "The Sara browser was closed.") }
    let until = Date().addingTimeInterval(timeout)
    cond.lock()
    defer { cond.unlock() }
    while results[id] == nil {
      if !alive { throw HandsOpError(code: "error", message: "The Sara browser was closed.") }
      if cancel?.isSet == true { throw HandsOpError(code: "stopped", message: "Stopped.") }
      if Date() >= until { throw HandsOpError(code: "timeout", message: "\(method) took too long.") }
      _ = cond.wait(until: min(until, Date().addingTimeInterval(0.1)))
    }
    let r = results.removeValue(forKey: id)!
    if let e = r["error"] as? [String: Any] { throw HandsOpError(code: "error", message: e["message"] as? String ?? "DevTools error") }
    return r["result"] as? [String: Any] ?? [:]
  }

  func attach(_ targetId: String) throws -> String {
    let r = try call("Target.attachToTarget", ["targetId": targetId, "flatten": true])
    let session = r["sessionId"] as? String ?? ""
    cond.lock()
    tabN += 1
    var t = Tab()
    t.id = "t\(tabN)"; t.targetId = targetId; t.sessionId = session
    tabs[t.id] = t; order.append(t.id); active = t.id
    cond.unlock()
    for d in ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"] { _ = try? call(d, [:], session: session) }
    // §4.1: the server's own pages are refused even when a page sends the browser there.
    _ = try? call("Fetch.enable", ["patterns": [["urlPattern": serverOrigin + "/*"]]], session: session)
    let tree = try? call("Page.getFrameTree", [:], session: session)
    cond.lock()
    tabs[t.id]?.frameId = ((tree?["frameTree"] as? [String: Any])?["frame"] as? [String: Any])?["id"] as? String ?? ""
    cond.unlock()
    return t.id
  }

  func newTab() throws -> String {
    let r = try call("Target.createTarget", ["url": "about:blank"])
    return try attach(r["targetId"] as? String ?? "")
  }

  var tabCount: Int { cond.lock(); defer { cond.unlock() }; return tabs.count }
  var activeId: String { cond.lock(); defer { cond.unlock() }; return active }
  func tab(_ want: String) throws -> Tab {
    cond.lock()
    defer { cond.unlock() }
    if let t = tabs[want.isEmpty ? active : want] { return t }
    if want.isEmpty, let last = order.last(where: { tabs[$0] != nil }), let t = tabs[last] { return t }
    throw HandsOpError(code: "not_found", message: want.isEmpty ? "No tab is open." : "No tab \(want) (pc_browser_tabs lists them).")
  }
  func activate(_ id: String) { cond.lock(); if tabs[id] != nil { active = id }; cond.unlock() }
  func resetCounts(_ id: String, clearLogs: Bool = false) {
    cond.lock()
    tabs[id]?.consoleErrors = 0; tabs[id]?.failedRequests = 0; tabs[id]?.status = 0
    if clearLogs { tabs[id]?.logs = [] }
    cond.unlock()
  }
  func forget(_ id: String) {
    cond.lock()
    tabs[id] = nil
    order.removeAll { $0 == id }
    if active == id { active = order.last ?? "" }
    cond.unlock()
  }
  func allTabs() -> [Tab] { cond.lock(); defer { cond.unlock() }; return order.compactMap { tabs[$0] } }
  func loads(_ id: String) -> Int { cond.lock(); defer { cond.unlock() }; return tabs[id]?.loads ?? -1 }
  func waitLoad(_ id: String, after: Int, timeout: TimeInterval, cancel: HandsCancel) -> Bool {
    let until = Date().addingTimeInterval(timeout)
    cond.lock()
    defer { cond.unlock() }
    while alive, let t = tabs[id], t.loads == after {
      if cancel.isSet || Date() >= until { return false }
      _ = cond.wait(until: min(until, Date().addingTimeInterval(0.1)))
    }
    return alive && tabs[id] != nil
  }
  func logs(_ id: String, since: Int) -> [[String: Any]] {
    cond.lock()
    defer { cond.unlock() }
    return Array((tabs[id]?.logs ?? []).filter { ($0["seq"] as? Int ?? 0) > since }.suffix(200))
  }
  func statusOf(_ id: String, request: String) -> Int {
    cond.lock()
    defer { cond.unlock() }
    return (tabs[id]?.logs ?? []).first { $0["requestId"] as? String == request }?["status"] as? Int ?? 0
  }

  private func readLoop() {
    cond.lock()
    let fd = rfd
    cond.unlock()
    var buf = Data()
    var chunk = [UInt8](repeating: 0, count: 65536)
    while true {
      let n = read(fd, &chunk, chunk.count)
      if n <= 0 { break }
      buf.append(chunk, count: n)
      while let z = buf.firstIndex(of: 0) {
        let msg = buf.subdata(in: buf.startIndex..<z)
        buf.removeSubrange(buf.startIndex...z)
        guard let m = (try? JSONSerialization.jsonObject(with: msg)) as? [String: Any] else { continue }
        if let id = m["id"] as? Int {
          cond.lock(); results[id] = m; cond.broadcast(); cond.unlock()
        } else { event(m) }
      }
    }
    Darwin.close(fd)
    cond.lock()
    alive = false; tabs = [:]; order = []; rfd = -1
    cond.broadcast()
    cond.unlock()
  }

  private func tabKey(session: String?) -> String? { tabs.first { $0.value.sessionId == session }?.key }
  private func log(_ key: String, _ e: [String: Any]) {
    seq += 1
    var x = e
    x["seq"] = seq
    tabs[key]?.logs.append(x)
    if (tabs[key]?.logs.count ?? 0) > 500 { tabs[key]?.logs.removeFirst() }
  }

  private func event(_ m: [String: Any]) {
    let method = m["method"] as? String ?? ""
    let p = m["params"] as? [String: Any] ?? [:]
    let session = m["sessionId"] as? String
    if method == "Fetch.requestPaused" {
      let url = (p["request"] as? [String: Any])?["url"] as? String ?? ""
      let ok = handsAddressAllowed(url, serverOrigin: serverOrigin) == nil
      let rid = p["requestId"] as? String ?? ""
      send(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? ["requestId": rid] : ["requestId": rid, "errorReason": "BlockedByClient"], session: session)
      if !ok {
        cond.lock()
        if let k = tabKey(session: session) { log(k, ["kind": "network", "method": "GET", "url": shortText(url), "error": "blocked by the Sara browser (Sara\u{2019}s own server)"]) }
        cond.unlock()
      }
      return
    }
    cond.lock()
    defer { cond.broadcast(); cond.unlock() }
    if method == "Target.detachedFromTarget" {
      if let k = tabs.first(where: { $0.value.sessionId == p["sessionId"] as? String })?.key {
        tabs[k] = nil; order.removeAll { $0 == k }
        if active == k { active = order.last ?? "" }
      }
      return
    }
    guard let k = tabKey(session: session) else { return }
    switch method {
    case "Page.loadEventFired": tabs[k]?.loads += 1
    case "Page.frameNavigated":
      if let f = p["frame"] as? [String: Any], f["parentId"] == nil { tabs[k]?.frameId = f["id"] as? String ?? "" }
    case "Runtime.consoleAPICalled":
      let type = p["type"] as? String ?? ""
      guard ["error", "warning", "assert"].contains(type) else { return }
      let text = (p["args"] as? [[String: Any]] ?? []).map { a -> String in
        if let v = a["value"] { return v as? String ?? jsonText(v) }
        return a["description"] as? String ?? ""
      }.joined(separator: " ")
      if type != "warning" { tabs[k]?.consoleErrors += 1 }
      var e: [String: Any] = ["kind": "console", "level": type == "warning" ? "warning" : "error", "text": shortText(text)]
      if let f = ((p["stackTrace"] as? [String: Any])?["callFrames"] as? [[String: Any]])?.first { e["url"] = shortText(f["url"] as? String ?? ""); e["line"] = (f["lineNumber"] as? Int ?? 0) + 1 }
      log(k, e)
    case "Runtime.exceptionThrown":
      let d = p["exceptionDetails"] as? [String: Any] ?? [:]
      let desc = ((d["exception"] as? [String: Any])?["description"] as? String ?? d["text"] as? String ?? "error").components(separatedBy: "\n")[0]
      tabs[k]?.consoleErrors += 1
      var e: [String: Any] = ["kind": "exception", "text": shortText(desc)]
      if let u = d["url"] as? String { e["url"] = shortText(u); e["line"] = (d["lineNumber"] as? Int ?? 0) + 1 }
      log(k, e)
    case "Log.entryAdded":
      let e = p["entry"] as? [String: Any] ?? [:]
      let level = e["level"] as? String ?? ""
      guard level == "error" || level == "warning", e["source"] as? String != "network" else { return }
      if level == "error" { tabs[k]?.consoleErrors += 1 }
      log(k, ["kind": "console", "level": level, "text": shortText(e["text"] as? String ?? "")])
    case "Network.requestWillBeSent":
      let r = p["request"] as? [String: Any] ?? [:]
      tabs[k]?.requests[p["requestId"] as? String ?? ""] = (r["method"] as? String ?? "GET", shortText(r["url"] as? String ?? ""))
    case "Network.responseReceived":
      let r = p["response"] as? [String: Any] ?? [:]
      let status = r["status"] as? Int ?? Int(r["status"] as? Double ?? 0)
      let url = r["url"] as? String ?? ""
      if p["type"] as? String == "Document" && p["frameId"] as? String == tabs[k]?.frameId { tabs[k]?.status = status }
      if status >= 400 && !url.hasSuffix("/favicon.ico") {
        tabs[k]?.failedRequests += 1
        let rid = p["requestId"] as? String ?? ""
        log(k, ["kind": "network", "method": tabs[k]?.requests[rid]?.0 ?? "GET", "url": shortText(url), "status": status, "type": p["type"] as? String ?? "", "requestId": rid])
      }
    case "Network.loadingFailed":
      if p["canceled"] as? Bool == true || p["blockedReason"] as? String == "inspector" { return }
      tabs[k]?.failedRequests += 1
      let rid = p["requestId"] as? String ?? ""
      let was = tabs[k]?.requests[rid]
      log(k, ["kind": "network", "method": was?.0 ?? "GET", "url": was?.1 ?? "", "error": shortText(p["errorText"] as? String ?? ""), "type": p["type"] as? String ?? "", "requestId": rid])
    default: break
    }
  }
}

// MARK: the hands connection

final class Hands: NSObject, URLSessionWebSocketDelegate {
  static let ops: Set<String> = ["b.start", "b.tabs", "b.open", "b.navigate", "b.snapshot", "b.read", "b.screenshot", "b.logs", "b.request", "b.close", "c.ping"]
  static var shared: Hands?

  let server: String
  let token: String
  let computer: String
  let pageAgent: String
  let version: String
  var localOnly: Bool
  let browser: HandsBrowser
  private var session: URLSession!
  private var task: URLSessionWebSocketTask?
  private var stopping = false
  private var attempt = 0
  private let queue = DispatchQueue(label: "sara.hands.ops")
  private let lock = NSLock()
  private var cancels: [String: HandsCancel] = [:]
  private var answers: [String: String] = [:]
  private var answerOrder: [String] = []
  private var opens: [Date] = []
  private var frameN = 0
  private var lastFrame = Date.distantPast
  private var lastFrameHash = 0
  private(set) var connected = false
  private(set) var lastError = ""

  init(server: String, token: String, computer: String, profileDir: URL, pageAgent: String, version: String, localOnly: Bool) {
    self.server = server
    self.token = token
    self.computer = computer
    self.pageAgent = pageAgent
    self.version = version
    self.localOnly = localOnly
    browser = HandsBrowser(serverOrigin: server.lowercased(), profileDir: profileDir)
    super.init()
    let cfg = URLSessionConfiguration.ephemeral
    // Never cookies: the token is the only sign-in this connection has.
    cfg.httpShouldSetCookies = false
    cfg.httpCookieStorage = nil
    cfg.urlCache = nil
    session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
  }

  func start() { connect() }

  func stop() {
    lock.lock()
    stopping = true
    for c in cancels.values { c.set() }
    lock.unlock()
    task?.cancel(with: .goingAway, reason: nil)
    session.invalidateAndCancel()
    queue.async { [browser] in browser.close() }
  }

  private func connect() {
    lock.lock()
    if stopping { lock.unlock(); return }
    lock.unlock()
    guard var u = URLComponents(string: server + "/api/hands") else { return }
    u.scheme = u.scheme == "https" ? "wss" : "ws"
    var req = URLRequest(url: u.url!)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpShouldHandleCookies = false
    let t = session.webSocketTask(with: req)
    task = t
    t.resume()
    receive(t)
  }

  private func later() {
    lock.lock()
    let stop = stopping
    lock.unlock()
    if stop { return }
    let backoff: [Double] = [1, 2, 5, 10, 30]
    let s = lastError.contains("signed out") ? 300 : backoff[min(attempt, backoff.count - 1)]
    attempt += 1
    DispatchQueue.global().asyncAfter(deadline: .now() + s) { [weak self] in self?.connect() }
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    guard webSocketTask === task else { return }
    connected = true
    attempt = 0
    lastError = ""
    NSLog("Sara hands: connected to \(server)")
    sendText(hello())
  }

  func urlSession(_ session: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) {
    guard t === task else { return }
    if let r = t.response as? HTTPURLResponse {
      switch r.statusCode {
      case 401: lastError = "This Mac was signed out: switch \"Let Sara use this computer\" off and on again."
      case 403: lastError = "The server refused this Mac (computer use is off for you there)."
      case 101: break
      default: lastError = "The server doesn't take computer use (HTTP \(r.statusCode)): update Sara there."
      }
    } else if error != nil { lastError = "Couldn't reach the server." }
    dropped()
  }

  private func dropped() {
    let was = connected
    connected = false
    lock.lock()
    for c in cancels.values { c.set() }
    lock.unlock()
    if was { NSLog("Sara hands: disconnected") }
    later()
  }

  private func receive(_ t: URLSessionWebSocketTask) {
    t.receive { [weak self] result in
      guard let self, t === self.task else { return }
      switch result {
      case .failure: return  // didCompleteWithError reconnects
      case .success(let m):
        if case .string(let s) = m { self.onText(s) }
        self.receive(t)
      }
    }
  }

  func sendText(_ s: String) { task?.send(.string(s)) { _ in } }
  func sendBinary(_ header: [String: Any], _ data: Data) {
    let h = Data(jsonText(header).utf8)
    var out = Data([UInt8(h.count >> 24 & 0xff), UInt8(h.count >> 16 & 0xff), UInt8(h.count >> 8 & 0xff), UInt8(h.count & 0xff)])
    out.append(h)
    out.append(data)
    task?.send(.data(out)) { _ in }
  }

  func hello() -> String {
    let os = ProcessInfo.processInfo.operatingSystemVersion
    var browserInfo: [String: Any] = ["found": browser.found != nil]
    if let f = browser.found { browserInfo["kind"] = f.kind; browserInfo["name"] = f.name }
    return jsonText(["t": "hello", "v": 1, "app": version, "os": "macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", "computer": computer, "screens": [] as [Any],
                     "browser": browserInfo, "perms": ["capture": false, "input": false, "ax": false], "optIn": ["browser": true, "desktop": false], "approvalsHere": false,
                     "logins": [] as [Any], "busy": false, "localOnly": localOnly, "ops": Array(Hands.ops).sorted()] as [String: Any])
  }

  func pressStop() {
    lock.lock()
    for c in cancels.values { c.set() }
    lock.unlock()
    sendText(jsonText(["t": "ev", "kind": "stopped", "by": "user"]))
  }
  func tellLocalOnly(_ on: Bool) {
    localOnly = on
    sendText(jsonText(["t": "ev", "kind": "optin", "optIn": ["browser": true, "desktop": false], "localOnly": on] as [String: Any]))
  }

  private func onText(_ raw: String) {
    guard let m = parseJSON(raw) else { return }
    let t = m["t"] as? String
    if t == "cancel" {
      lock.lock()
      if m["all"] as? Bool == true { for c in cancels.values { c.set() } } else if let id = m["id"] as? String { cancels[id]?.set() }
      lock.unlock()
      return
    }
    guard t == "req", let id = m["id"] as? String, !id.isEmpty, id.count <= 100 else { return }
    lock.lock()
    // A retried request gets the first answer (a running one isn't run twice).
    if let a = answers[id] { lock.unlock(); return sendText(a) }
    if cancels[id] != nil { lock.unlock(); return }
    let cancel = HandsCancel()
    cancels[id] = cancel
    lock.unlock()
    let op = m["op"] as? String ?? ""
    let args = m["args"] as? [String: Any] ?? [:]
    let deadline = min(120, max(1, (m["deadlineMs"] as? Double ?? Double(m["deadlineMs"] as? Int ?? 30000)) / 1000))
    DispatchQueue.global().asyncAfter(deadline: .now() + deadline) { cancel.set() }
    queue.async { [weak self] in
      guard let self else { return }
      let started = Date()
      var reply: [String: Any]
      do {
        if cancel.isSet { throw HandsOpError(code: "stopped", message: "Stopped.") }
        let r = try self.run(id: id, op: op, args: args, cancel: cancel, deadline: deadline)
        reply = ["t": "res", "id": id, "ok": true, "result": r]
      } catch let e as HandsOpError {
        var code = e.code
        var msg = e.message
        if code == "stopped" && Date().timeIntervalSince(started) >= deadline - 0.05 { code = "timeout"; msg = "Took longer than \(Int(deadline)) s." }
        reply = ["t": "res", "id": id, "ok": false, "error": ["code": code, "message": String(handsMask(msg).prefix(500))]]
      } catch {
        reply = ["t": "res", "id": id, "ok": false, "error": ["code": "error", "message": "Something went wrong on the Mac."]]
      }
      let text = jsonText(reply)
      self.lock.lock()
      self.cancels[id] = nil
      self.answers[id] = text
      self.answerOrder.append(id)
      if self.answerOrder.count > 100 { self.answers[self.answerOrder.removeFirst()] = nil }
      self.lock.unlock()
      self.sendText(text)
    }
  }

  // MARK: the ops
  private func shot(_ t: HandsBrowser.Tab, maxWidth: Double, quality: Int, cancel: HandsCancel?) throws -> (Data, Int, Int) {
    let m = try browser.call("Page.getLayoutMetrics", [:], session: t.sessionId, cancel: cancel)
    let vv = m["cssVisualViewport"] as? [String: Any] ?? [:]
    let vw = max(1, vv["clientWidth"] as? Double ?? Double(vv["clientWidth"] as? Int ?? 1280)), vh = max(1, vv["clientHeight"] as? Double ?? Double(vv["clientHeight"] as? Int ?? 800))
    let scale = min(1, maxWidth / vw)
    let r = try browser.call("Page.captureScreenshot", ["format": "jpeg", "quality": quality, "clip": ["x": 0, "y": 0, "width": vw, "height": vh, "scale": scale]], session: t.sessionId, timeout: 30, cancel: cancel)
    return (Data(base64Encoded: r["data"] as? String ?? "") ?? Data(), Int((vw * scale).rounded()), Int((vh * scale).rounded()))
  }
  private func thumb(_ id: String, _ t: HandsBrowser.Tab, _ args: [String: Any], _ cancel: HandsCancel) {
    let w = args["thumb"] as? Double ?? Double(args["thumb"] as? Int ?? 0)
    guard w >= 64 && w <= 640, let s = try? shot(t, maxWidth: w, quality: 55, cancel: cancel), !s.0.isEmpty else { return }
    sendBinary(["id": id, "kind": "thumb", "mime": "image/jpeg", "w": s.1, "h": s.2], s.0)
  }
  /// §3.5: a live-view frame after a change (at most one per 500 ms, only when the picture changed).
  private func frame(_ t: HandsBrowser.Tab) {
    guard Date().timeIntervalSince(lastFrame) >= 0.5, let s = try? shot(t, maxWidth: 960, quality: 60, cancel: nil), !s.0.isEmpty else { return }
    let h = s.0.hashValue
    if h == lastFrameHash { return }
    lastFrameHash = h
    lastFrame = Date()
    frameN += 1
    sendBinary(["frame": frameN, "mime": "image/jpeg", "w": s.1, "h": s.2], s.0)
  }
  private func info(_ t: HandsBrowser.Tab) -> [String: Any] {
    let r = (try? browser.call("Target.getTargetInfo", ["targetId": t.targetId]))?["targetInfo"] as? [String: Any] ?? [:]
    return ["url": r["url"] as? String ?? "", "title": handsMask(r["title"] as? String ?? "")]
  }
  private func counts(_ id: String) -> [String: Any] {
    let t = try? browser.tab(id)
    return ["consoleErrors": t?.consoleErrors ?? 0, "failedRequests": t?.failedRequests ?? 0]
  }
  /// One page-agent function in an isolated world (the page's own scripts can't touch it).
  private func agent(_ t: HandsBrowser.Tab, _ fn: String, _ args: [String: Any], _ cancel: HandsCancel) throws -> [String: Any] {
    let tree = try browser.call("Page.getFrameTree", [:], session: t.sessionId, cancel: cancel)
    let frameId = ((tree["frameTree"] as? [String: Any])?["frame"] as? [String: Any])?["id"] as? String ?? ""
    let w = try browser.call("Page.createIsolatedWorld", ["frameId": frameId, "worldName": "sara-page-agent"], session: t.sessionId, cancel: cancel)
    let expr = "(\(pageAgent)).call(\(jsonQuote(fn)), \(jsonText(args)))"
    let r = try browser.call("Runtime.evaluate", ["expression": expr, "contextId": w["executionContextId"] ?? 0, "returnByValue": true], session: t.sessionId, timeout: 20, cancel: cancel)
    if r["exceptionDetails"] != nil { throw HandsOpError(code: "error", message: "The page couldn't be read.") }
    return (r["result"] as? [String: Any])?["value"] as? [String: Any] ?? [:]
  }
  private func tabsList() -> [[String: Any]] {
    let act = browser.activeId
    return browser.allTabs().map { t in (["tab": t.id, "active": t.id == act] as [String: Any]).merging(info(t)) { a, _ in a } }
  }

  private func run(id: String, op: String, args a: [String: Any], cancel: HandsCancel, deadline: Double) throws -> [String: Any] {
    guard Hands.ops.contains(op) else { throw HandsOpError(code: "unsupported", message: "This computer doesn't do \"\(op.prefix(40))\" (not in its command set).") }
    if op == "c.ping" { return ["pong": true, "at": Date().timeIntervalSince1970] }
    if op != "b.tabs" || browser.running { try browser.start() }
    switch op {
    case "b.start": return ["browser": ["kind": browser.found?.kind ?? "", "name": browser.found?.name ?? ""], "tabs": tabsList()]
    case "b.tabs": return ["tabs": browser.running ? tabsList() : []]
    case "b.open":
      let url = a["url"] as? String ?? ""
      if let why = handsAddressAllowed(url, serverOrigin: browser.serverOrigin) { throw HandsOpError(code: "denied_local", message: why) }
      opens = opens.filter { Date().timeIntervalSince($0) < 60 }
      if opens.count >= 20 { throw HandsOpError(code: "rate_limited", message: "At most 20 pages a minute in the Sara browser.") }
      opens.append(Date())
      var tid = ""
      if a["newTab"] as? Bool == true || browser.tabCount == 0 { tid = try browser.newTab() }
      let t = try browser.tab(tid)
      browser.activate(t.id)
      browser.resetCounts(t.id, clearLogs: true)
      let before = browser.loads(t.id)
      let nav = try browser.call("Page.navigate", ["url": url], session: t.sessionId, timeout: 30, cancel: cancel)
      if let err = nav["errorText"] as? String { throw HandsOpError(code: "not_found", message: "The page didn't open: \(err)") }
      _ = browser.waitLoad(t.id, after: before, timeout: min(deadline, 60), cancel: cancel)
      if cancel.isSet { throw HandsOpError(code: "stopped", message: "Stopped.") }
      Thread.sleep(forTimeInterval: 0.25)
      let now = try browser.tab(t.id)
      thumb(id, now, a, cancel)
      frame(now)
      return (["tab": now.id, "status": now.status] as [String: Any]).merging(info(now)) { x, _ in x }.merging(counts(now.id)) { x, _ in x }
    default: break
    }
    let t = try browser.tab(a["tab"] as? String ?? "")
    switch op {
    case "b.navigate":
      browser.activate(t.id)
      let action = a["action"] as? String ?? "reload"
      let before = browser.loads(t.id)
      if action == "reload" {
        browser.resetCounts(t.id)
        _ = try browser.call("Page.reload", [:], session: t.sessionId, timeout: 30, cancel: cancel)
      } else if action == "back" || action == "forward" {
        let h = try browser.call("Page.getNavigationHistory", [:], session: t.sessionId, cancel: cancel)
        let entries = h["entries"] as? [[String: Any]] ?? []
        let i = (h["currentIndex"] as? Int ?? 0) + (action == "back" ? -1 : 1)
        guard i >= 0 && i < entries.count else { throw HandsOpError(code: "not_found", message: "There is no page to go \(action) to.") }
        if handsAddressAllowed(entries[i]["url"] as? String ?? "", serverOrigin: browser.serverOrigin) != nil { throw HandsOpError(code: "denied_local", message: "That page isn't opened in the Sara browser.") }
        _ = try browser.call("Page.navigateToHistoryEntry", ["entryId": entries[i]["id"] ?? 0], session: t.sessionId, cancel: cancel)
      } else { throw HandsOpError(code: "unsupported", message: "action: back, forward or reload.") }
      _ = browser.waitLoad(t.id, after: before, timeout: min(deadline, 15), cancel: cancel)
      Thread.sleep(forTimeInterval: 0.2)
      thumb(id, t, a, cancel)
      frame(t)
      return (["tab": t.id] as [String: Any]).merging(info(t)) { x, _ in x }.merging(counts(t.id)) { x, _ in x }
    case "b.snapshot":
      var r = try agent(t, "snapshot", ["from": a["from"] ?? 0, "limit": 400], cancel)
      thumb(id, t, a, cancel)
      r["tab"] = t.id
      r["viewId"] = "v\(Int(Date().timeIntervalSince1970 * 1000))"
      return r.merging(counts(t.id)) { x, _ in x }
    case "b.read":
      var args: [String: Any] = ["max": a["max"] ?? 8000]
      if let ref = a["ref"] as? String { args["ref"] = ref }
      var r = try agent(t, "text", args, cancel)
      if let e = r["error"] as? String { throw HandsOpError(code: "not_found", message: e) }
      r["tab"] = t.id
      return r
    case "b.screenshot":
      let mw = min(1920, max(160, a["maxWidth"] as? Double ?? Double(a["maxWidth"] as? Int ?? 1280)))
      let q = min(90, max(30, a["quality"] as? Int ?? 70))
      let s = try shot(t, maxWidth: mw, quality: q, cancel: cancel)
      let viewId = "v\(Int(Date().timeIntervalSince1970 * 1000))"
      sendBinary(["id": id, "kind": "shot", "mime": "image/jpeg", "w": s.1, "h": s.2, "viewId": viewId], s.0)
      return ["tab": t.id, "w": s.1, "h": s.2, "viewId": viewId]
    case "b.logs":
      let since = a["since"] as? Int ?? Int(a["since"] as? Double ?? 0)
      return (["tab": t.id, "entries": browser.logs(t.id, since: since), "last": browser.seq] as [String: Any]).merging(info(t)) { x, _ in x }
    case "b.request":
      let rid = a["requestId"] as? String ?? ""
      guard let body = try? browser.call("Network.getResponseBody", ["requestId": rid], session: t.sessionId, cancel: cancel) else {
        throw HandsOpError(code: "not_found", message: "That response is no longer kept by the browser (reload and look again).")
      }
      let status = browser.statusOf(t.id, request: rid)
      if body["base64Encoded"] as? Bool == true { return ["status": status, "mime": "binary", "body": "(not text)", "truncated": false] }
      let text = handsMask(body["body"] as? String ?? "")
      return ["status": status, "mime": "text", "body": String(text.prefix(64 * 1024)), "truncated": text.count > 64 * 1024]
    case "b.close":
      _ = try browser.call("Target.closeTarget", ["targetId": t.targetId], cancel: cancel)
      browser.forget(t.id)
      return ["closed": t.id]
    default:
      throw HandsOpError(code: "unsupported", message: "This computer doesn't do \"\(op)\".")
    }
  }
}

// MARK: the token in the Keychain (this app's own item: a test copy with another bundle id has its own)

enum HandsKeychain {
  static var service: String { (Bundle.main.bundleIdentifier ?? "com.backstagecoding.sara.desktop") + ".hands" }
  static func save(_ token: String, account: String) -> Bool {
    delete(account: account)
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                            kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
  }
  static func load(account: String) -> String? {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
    return String(data: d, encoding: .utf8)
  }
  static func delete(account: String) {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    SecItemDelete(q as CFDictionary)
  }
}
