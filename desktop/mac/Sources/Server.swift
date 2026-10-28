// Sara's server on this Mac (Phase 46d). The app carries the server (Contents/Resources/server) and
// its own Node (Contents/Resources/node). launchd runs it through SMAppService as a LaunchAgent
// ("while you're signed in"), which starts this same program with --run-server: a small supervisor
// that runs Node with the settings in ~/Library/Application Support/Sara/service/server.env and can
// be stopped and started again without administrator rights.
// Phase 55: the LaunchDaemon ("from startup") option is gone (owner decision for 1.0). A Mac that
// still has it is moved to the agent on update (migrateFromDaemon), and the program refuses to run
// as root.
import Darwin
import Foundation
import ServiceManagement

let agentPlistName = "com.backstagecoding.sara.server.plist"
let agentLabel = "com.backstagecoding.sara.server"
/// Only to unregister what versions before Phase 55 may have registered (the plist is no longer shipped).
let legacyDaemonPlistName = "com.backstagecoding.sara.server-daemon.plist"
let defaultPort = 7860

enum Access: String, CaseIterable {
  case tailscale, local, lan, domain
  var label: String {
    switch self {
    case .tailscale: return "Tailscale (private, your phones and computers anywhere)"
    case .local: return "Just this Mac"
    case .lan: return "My home network"
    case .domain: return "My own web address"
    }
  }
}

/// Runs a program and returns its exit code and output (stdout + stderr), with a time limit.
@discardableResult
func runProgram(_ path: String, _ args: [String], env: [String: String]? = nil, cwd: String? = nil, timeout: TimeInterval = 60) -> (code: Int32, out: String) {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: path)
  p.arguments = args
  if let env { p.environment = env }
  if let cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
  let pipe = Pipe()
  p.standardOutput = pipe
  p.standardError = pipe
  p.standardInput = FileHandle.nullDevice
  var data = Data()
  let lock = NSLock()
  pipe.fileHandleForReading.readabilityHandler = { h in
    let d = h.availableData
    lock.lock(); data.append(d); lock.unlock()
  }
  do { try p.run() } catch { return (-1, "Couldn't start \(path): \(error.localizedDescription)") }
  let deadline = Date().addingTimeInterval(timeout)
  while p.isRunning && Date() < deadline { usleep(50_000) }
  if p.isRunning { p.terminate(); usleep(300_000); if p.isRunning { kill(p.processIdentifier, SIGKILL) } }
  p.waitUntilExit()
  pipe.fileHandleForReading.readabilityHandler = nil
  let rest = pipe.fileHandleForReading.readDataToEndOfFile()
  lock.lock(); data.append(rest); lock.unlock()
  return (p.terminationStatus, String(decoding: data, as: UTF8.self))
}

/// Is this TCP port free to listen on?
func portIsFree(_ port: Int, anyAddress: Bool = false) -> Bool {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { return false }
  defer { close(fd) }
  // As Node does: a port that only has closed connections waiting (TIME_WAIT) counts as free.
  var one: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
  var addr = sockaddr_in()
  addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = in_port_t(UInt16(port).bigEndian)
  addr.sin_addr.s_addr = anyAddress ? INADDR_ANY : inet_addr("127.0.0.1")
  let r = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
  return r == 0
}

/// This Mac's address on the home network (Wi-Fi or Ethernet), e.g. 192.168.1.20.
func lanAddress() -> String? {
  var ifaddr: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
  defer { freeifaddrs(ifaddr) }
  var best: String?
  for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
    let i = p.pointee
    guard let a = i.ifa_addr, a.pointee.sa_family == UInt8(AF_INET), (i.ifa_flags & UInt32(IFF_LOOPBACK)) == 0, (i.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
    let name = String(cString: i.ifa_name)
    guard name.hasPrefix("en") else { continue }
    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    if getnameinfo(a, socklen_t(a.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
      let ip = String(cString: host)
      if ip.hasPrefix("169.254.") { continue }
      if best == nil || name == "en0" { best = ip }
    }
  }
  return best
}

// MARK: Tailscale

struct TailscaleInfo {
  var cli: String?
  var running = false
  var dnsName: String?
  var httpsReady = false  // the tailnet has HTTPS certificates switched on
  var url: String? { dnsName.map { "https://\($0)" } }
}

enum Tailscale {
  static let candidates = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]
  static var cli: String? { candidates.first { FileManager.default.isExecutableFile(atPath: $0) } }

  static func status() -> TailscaleInfo {
    var info = TailscaleInfo(cli: cli)
    guard let cli = info.cli else { return info }
    let r = runProgram(cli, ["status", "--json"], timeout: 10)
    guard let start = r.out.firstIndex(of: "{"), let j = try? JSONSerialization.jsonObject(with: Data(r.out[start...].utf8)) as? [String: Any] else { return info }
    info.running = (j["BackendState"] as? String) == "Running"
    if let s = j["Self"] as? [String: Any], let d = s["DNSName"] as? String, !d.isEmpty { info.dnsName = d.hasSuffix(".") ? String(d.dropLast()) : d }
    info.httpsReady = !((j["CertDomains"] as? [Any]) ?? []).isEmpty
    return info
  }

  /// What `tailscale serve` already does on this Mac (empty when nothing).
  static func serveConfig() -> [String: Any] {
    guard let cli else { return [:] }
    let r = runProgram(cli, ["serve", "status", "--json"], timeout: 10)
    guard let start = r.out.firstIndex(of: "{"), let j = try? JSONSerialization.jsonObject(with: Data(r.out[start...].utf8)) as? [String: Any] else { return [:] }
    return j
  }

  /// HTTPS on 443 of this Mac's tailnet name → Sara. Refuses to replace something else already
  /// served on 443. Returns nil on success, else a plain message.
  static func serve(port: Int) -> String? {
    guard let cli else { return "Tailscale isn't installed on this Mac." }
    let cfg = serveConfig()
    let text = String(decoding: (try? JSONSerialization.data(withJSONObject: cfg)) ?? Data(), as: UTF8.self)
    let mine = "127.0.0.1:\(port)"
    if let tcp = cfg["TCP"] as? [String: Any], tcp["443"] != nil, !text.contains(mine) {
      return "Tailscale already serves something else on this Mac's HTTPS address, so Sara left it alone. Sara is set up for this Mac only for now; you can free the address with `tailscale serve status` and choose Tailscale again (Sara server → Change how you reach her…)."
    }
    let r = runProgram(cli, ["serve", "--bg", "--https=443", "http://127.0.0.1:\(port)"], timeout: 25)
    if r.code == 0 { return nil }
    if let range = r.out.range(of: "https://login.tailscale.com/[^\\s]+", options: .regularExpression) {
      return "Tailscale needs you to allow sharing (\"Serve\") on your tailnet once: open \(r.out[range]) , allow it, then choose Change how you reach her… again."
    }
    return "Tailscale couldn't share Sara: \(r.out.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))"
  }

  /// Removes Sara's HTTPS sharing (only if it still points at her port).
  static func unserve(port: Int) {
    guard let cli else { return }
    let text = String(decoding: (try? JSONSerialization.data(withJSONObject: serveConfig())) ?? Data(), as: UTF8.self)
    if text.contains("127.0.0.1:\(port)") { runProgram(cli, ["serve", "--https=443", "off"], timeout: 20) }
  }
}

// MARK: the local server

final class LocalServer {
  let home: String
  init(home: String = NSHomeDirectory()) { self.home = home }

  var dataDir: String { home + "/Library/Application Support/Sara" }
  var serviceDir: String { dataDir + "/service" }
  var envFile: String { serviceDir + "/server.env" }
  var stopFlag: String { serviceDir + "/stopped" }
  var supervisorPidFile: String { serviceDir + "/supervisor.pid" }
  var nodePidFile: String { serviceDir + "/node.pid" }
  var versionFile: String { serviceDir + "/version" }
  var logsDir: String { dataDir + "/logs" }
  var serviceLog: String { logsDir + "/service.log" }
  var tokenFile: String { dataDir + "/first-token.txt" }
  var resources: String { Bundle.main.resourcePath ?? (Bundle.main.bundlePath + "/Contents/Resources") }
  var node: String { resources + "/node/bin/node" }
  var serverRoot: String { resources + "/server" }
  var hasBundledServer: Bool { FileManager.default.fileExists(atPath: serverRoot + "/src/main.ts") && FileManager.default.isExecutableFile(atPath: node) }

  /// The server version inside this app (its package.json).
  var bundledVersion: String {
    guard let d = FileManager.default.contents(atPath: serverRoot + "/package.json"),
          let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let v = j["version"] as? String else { return "?" }
    return v
  }

  var configured: Bool { FileManager.default.fileExists(atPath: envFile) }

  func readEnv() -> [String: String] {
    guard let s = try? String(contentsOfFile: envFile, encoding: .utf8) else { return [:] }
    var out: [String: String] = [:]
    for line in s.split(separator: "\n") {
      let l = line.trimmingCharacters(in: .whitespaces)
      if l.isEmpty || l.hasPrefix("#") { continue }
      guard let eq = l.firstIndex(of: "=") else { continue }
      let k = String(l[..<eq]), v = String(l[l.index(after: eq)...])
      if k.range(of: "^[A-Z_][A-Z0-9_]*$", options: .regularExpression) != nil { out[k] = v }
    }
    return out
  }

  func writeEnv(_ env: [String: String]) throws {
    try ensureFolders()
    var s = "# Sara's server on this Mac. Written by the Sara app (Sara server → Change how you reach her…).\n"
    for k in env.keys.sorted() { s += "\(k)=\(env[k]!.replacingOccurrences(of: "\n", with: " "))\n" }
    let tmp = envFile + ".tmp"
    FileManager.default.createFile(atPath: tmp, contents: Data(s.utf8), attributes: [.posixPermissions: 0o600])
    _ = try FileManager.default.replaceItemAt(URL(fileURLWithPath: envFile), withItemAt: URL(fileURLWithPath: tmp))
  }

  func ensureFolders() throws {
    let fm = FileManager.default
    for d in [dataDir, serviceDir, logsDir] where !fm.fileExists(atPath: d) {
      try fm.createDirectory(atPath: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
  }

  /// Set up before, then switched to "a Sara somewhere else": the service is off and unregistered,
  /// her data and settings stay (Sara server → Set up Sara on this Mac… brings her back).
  var offFlag: String { serviceDir + "/off" }
  var switchedOff: Bool { FileManager.default.fileExists(atPath: offFlag) }
  /// Set up here and in use (not switched off).
  var active: Bool { configured && !switchedOff }
  var port: Int { Int(readEnv()["SARA_PORT"] ?? "") ?? defaultPort }
  var access: Access { Access(rawValue: readEnv()["SARA_ACCESS"] ?? "") ?? .local }
  var localURL: String { "http://127.0.0.1:\(port)" }
  var publicURL: String { readEnv()["SARA_PUBLIC_URL"].flatMap { $0.isEmpty ? nil : $0 } ?? localURL }

  /// The environment Node runs with: a clean one plus the SARA_* settings (not the app's own).
  func nodeEnv() -> [String: String] {
    var env: [String: String] = [
      "PATH": "\(resources)/node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      "HOME": home,
      "LANG": "en_US.UTF-8",
      "SARA_DATA": dataDir,
      "SARA_PORT": String(defaultPort),
      "SARA_HOST": "127.0.0.1",
      "SARA_INSTALLED": "1",
    ]
    if let u = getpwuid(getuid()) { env["USER"] = String(cString: u.pointee.pw_name); env["LOGNAME"] = env["USER"] }
    var buf = [CChar](repeating: 0, count: 1024)
    if confstr(_CS_DARWIN_USER_TEMP_DIR, &buf, buf.count) > 0 { env["TMPDIR"] = String(cString: buf) }
    for (k, v) in readEnv() where k.hasPrefix("SARA_") && !k.hasPrefix("SARA_MAC_") { env[k] = v }
    env["SARA_DATA"] = dataDir
    return env
  }

  /// `node src/main.ts <args>` with the server's settings (status, doctor, backup, …).
  func runNode(_ args: [String], timeout: TimeInterval = 600) -> (code: Int32, out: String) {
    runProgram(node, ["--disable-warning=ExperimentalWarning", serverRoot + "/src/main.ts"] + args, env: nodeEnv(), cwd: serverRoot, timeout: timeout)
  }

  /// Answers on /api/health (call off the main thread).
  func healthy(timeout: TimeInterval = 2) -> Bool {
    guard let url = URL(string: localURL + "/api/health") else { return false }
    var req = URLRequest(url: url)
    req.timeoutInterval = timeout
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: req) { _, r, _ in ok = ((r as? HTTPURLResponse)?.statusCode ?? 500) < 500; sem.signal() }.resume()
    _ = sem.wait(timeout: .now() + timeout + 1)
    return ok
  }

  func waitHealthy(seconds: TimeInterval) -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end { if healthy() { return true }; usleep(500_000) }
    return false
  }

  /// The one-time owner token, while it hasn't been used yet.
  func firstToken() -> String? {
    (try? String(contentsOfFile: tokenFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
  }

  func waitToken(seconds: TimeInterval) -> String? {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end { if let t = firstToken() { return t }; usleep(300_000) }
    return nil
  }

  // MARK: launchd (SMAppService)

  var agent: SMAppService { SMAppService.agent(plistName: agentPlistName) }

  func statusWord(_ s: SMAppService.Status) -> String {
    switch s {
    case .enabled: return "on"
    case .requiresApproval: return "waiting for your OK in System Settings → General → Login Items"
    case .notRegistered: return "not set up"
    case .notFound: return "not found"
    @unknown default: return "unknown"
    }
  }

  /// Registers launchd's job (the LaunchAgent).
  func register() throws -> SMAppService.Status {
    unregisterLegacyDaemon()
    let s = agent
    if s.status == .enabled || s.status == .requiresApproval { return s.status }
    try s.register()
    return s.status
  }

  func unregisterAll() {
    if agent.status != .notRegistered { try? agent.unregister() }
    unregisterLegacyDaemon()
  }

  /// A LaunchDaemon registered by a version before Phase 55 (best effort: the new app no longer has
  /// its plist, so macOS may already show it as gone).
  func unregisterLegacyDaemon() {
    let d = SMAppService.daemon(plistName: legacyDaemonPlistName)
    if d.status == .enabled || d.status == .requiresApproval { try? d.unregister() }
  }

  /// Phase 55 migration: this Mac ran her "from startup" (SARA_MAC_RUN=daemon). That option is gone:
  /// the daemon is unregistered and stopped, and the LaunchAgent ("while you're signed in") takes
  /// over with the same data and settings. Returns what happened, or nil when there was nothing to do.
  func migrateFromDaemon() -> Outcome? {
    guard configured, readEnv()["SARA_MAC_RUN"] == "daemon" else { return nil }
    unregisterLegacyDaemon()
    stop()
    if let p = pid(supervisorPidFile) { kill(p, SIGTERM) }
    var env = readEnv()
    env["SARA_MAC_RUN"] = "agent"
    var out = Outcome()
    do { try writeEnv(env) } catch { return Outcome(ok: false, notes: ["Couldn't save her settings: \(error.localizedDescription)"]) }
    start()
    if switchedOff { return out }
    out.notes.append("Sara now runs while you're signed in to this Mac (starting before anyone signs in is no longer offered). Her data and settings are as they were.")
    do {
      let s = try register()
      if s == .requiresApproval { out.needsApproval = true } else if s != .enabled { out.ok = false; out.notes.append("macOS didn't start her service (\(statusWord(s))).") }
    } catch {
      if agent.status == .requiresApproval { out.needsApproval = true } else { out.ok = false; out.notes.append("macOS refused to set up her service: \(error.localizedDescription)") }
    }
    return out
  }

  /// "Connect to a Sara somewhere else instead": she stops and won't start at sign-in any more, and
  /// her Tailscale address is removed. Her data and settings stay until uninstall --delete-data.
  func switchOff() {
    stop()
    if agent.status != .notRegistered { try? agent.unregister() }
    unregisterLegacyDaemon()
    if let p = pid(supervisorPidFile) { kill(p, SIGTERM) }
    var env = readEnv()
    if env["SARA_MAC_TS_SERVE"] == "1" {
      Tailscale.unserve(port: port)
      env["SARA_MAC_TS_SERVE"] = "0"
      env["SARA_ACCESS"] = Access.local.rawValue
      env["SARA_PUBLIC_URL"] = localURL
      env["SARA_SECURE_COOKIES"] = "0"
      env["SARA_TRUST_PROXY"] = "0"
      try? writeEnv(env)
    }
    FileManager.default.createFile(atPath: offFlag, contents: Data())
  }

  func pid(_ file: String) -> pid_t? {
    guard let s = try? String(contentsOfFile: file, encoding: .utf8), let p = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)), p > 1, kill(p, 0) == 0 else { return nil }
    return p
  }

  var stopped: Bool { FileManager.default.fileExists(atPath: stopFlag) }

  /// Stops her (the service stays registered and waits until Start).
  func stop(wait: TimeInterval = 20) {
    if FileManager.default.fileExists(atPath: serviceDir) { FileManager.default.createFile(atPath: stopFlag, contents: Data()) }
    if let p = pid(nodePidFile) {
      kill(p, SIGTERM)
      let end = Date().addingTimeInterval(wait)
      while kill(p, 0) == 0 && Date() < end { usleep(200_000) }
      if kill(p, 0) == 0 { kill(p, SIGKILL) }
    }
  }

  func start() { try? FileManager.default.removeItem(atPath: stopFlag) }

  /// Restarts the supervisor itself (after an upgrade, so the new app's copy runs).
  func restartSupervisor() {
    if let p = pid(supervisorPidFile) { kill(p, SIGHUP) }
  }

  var running: Bool { pid(nodePidFile) != nil }

  // MARK: set up, change, uninstall

  struct Outcome {
    var ok = true
    var needsApproval = false
    var notes: [String] = []
  }

  /// Writes the settings, sets up how she's reached and registers the service. Safe to run again
  /// (keeps the data and any other settings in server.env; switches her back on after switchOff).
  func setUp(access: Access, port: Int, progress: (String) -> Void = { _ in }) -> Outcome {
    var out = Outcome()
    do { try ensureFolders() } catch { return Outcome(ok: false, notes: ["Couldn't make her data folder: \(error.localizedDescription)"]) }
    var env = readEnv()
    let oldPort = Int(env["SARA_PORT"] ?? "") ?? port
    let hadServe = env["SARA_MAC_TS_SERVE"] == "1"
    env["SARA_PORT"] = String(port)
    env["SARA_MAC_RUN"] = "agent"
    env["SARA_INSTALLED"] = "1"
    env["SARA_HOST"] = access == .lan ? "0.0.0.0" : "127.0.0.1"
    env["SARA_SECURE_COOKIES"] = "0"
    env["SARA_TRUST_PROXY"] = "0"
    env["SARA_MAC_TS_SERVE"] = "0"
    var chosen = access
    if hadServe && (access != .tailscale || oldPort != port) { progress("Removing the old Tailscale address…"); Tailscale.unserve(port: oldPort) }
    switch access {
    case .tailscale:
      progress("Sharing her privately on your tailnet…")
      let ts = Tailscale.status()
      if !ts.running || ts.dnsName == nil {
        out.notes.append("Tailscale isn't signed in on this Mac, so Sara is set up for this Mac only for now.")
        chosen = .local
      } else if let err = Tailscale.serve(port: port) {
        out.notes.append(err)
        chosen = .local
      } else {
        env["SARA_PUBLIC_URL"] = ts.url!
        env["SARA_SECURE_COOKIES"] = "1"
        env["SARA_TRUST_PROXY"] = "1"
        env["SARA_MAC_TS_SERVE"] = "1"
        if !ts.httpsReady {
          out.notes.append("Turn on HTTPS for your tailnet once, or the address won't open: https://login.tailscale.com/admin/dns → HTTPS Certificates → Enable.")
        }
      }
    case .lan:
      env["SARA_PUBLIC_URL"] = "http://\(lanAddress() ?? "this-mac.local"):\(port)"
      out.notes.append("Home network: anyone on the same network could read what you send (no HTTPS). Use it only at home on a network you trust; Tailscale works anywhere. Your Mac may ask whether \"node\" may accept incoming connections: choose Allow.")
    case .domain:
      // Needs a domain, HTTPS and a forwarded port: explained with the guide; this Mac only for now.
      chosen = .local
      out.notes.append("Your own web address needs a domain name, HTTPS and port forwarding on your router. Follow the guide (docs/INSTALL.md, section 2); until then Sara answers on this Mac only.")
    case .local: break
    }
    env["SARA_ACCESS"] = chosen.rawValue
    if chosen == .local { env["SARA_PUBLIC_URL"] = "http://127.0.0.1:\(port)" }
    do { try writeEnv(env) } catch { return Outcome(ok: false, notes: ["Couldn't save her settings: \(error.localizedDescription)"]) }

    progress("Starting her…")
    let wasRunning = running
    if wasRunning { stop() }  // picks up the new settings
    try? FileManager.default.removeItem(atPath: offFlag)
    start()
    do {
      let s = try register()
      if s == .requiresApproval { out.needsApproval = true; return out }
      if s != .enabled { out.ok = false; out.notes.append("macOS didn't start her service (\(statusWord(s))).") }
    } catch {
      // macOS answers "Operation not permitted" when the owner has to allow it first.
      if agent.status == .requiresApproval { out.needsApproval = true; return out }
      out.ok = false
      out.notes.append("macOS refused to set up her service: \(error.localizedDescription)")
    }
    return out
  }

  /// A backup file (node --backup). nil file = her backups folder.
  func backup(to file: String? = nil) -> (ok: Bool, message: String) {
    let r = runNode(["--backup"] + (file.map { [$0] } ?? []))
    return (r.code == 0, r.out.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  /// Stops and removes the service and her Tailscale address. Her data stays unless deleteData;
  /// a last backup goes to backupDir (the Desktop) first.
  func uninstall(deleteData: Bool, backupDir: String?) -> [String] {
    var notes: [String] = []
    let env = readEnv()
    if configured, let dir = backupDir, FileManager.default.fileExists(atPath: dataDir + "/sara.db") {
      let f = DateFormatter()
      f.dateFormat = "yyyy-MM-dd HH.mm.ss"
      let file = "\(dir)/Sara backup \(f.string(from: Date())).tar.gz"
      stop()
      let b = backup(to: file)
      notes.append(b.ok ? "Last backup: \(file)" : "The last backup didn't work: \(b.message)")
      if !b.ok && deleteData { notes.append("Her data was kept because the backup failed."); return finishUninstall(env: env, deleteData: false, notes: notes) }
    }
    return finishUninstall(env: env, deleteData: deleteData, notes: notes)
  }

  private func finishUninstall(env: [String: String], deleteData: Bool, notes: [String]) -> [String] {
    var notes = notes
    stop()
    unregisterAll()
    if let p = pid(supervisorPidFile) { kill(p, SIGTERM) }
    if env["SARA_MAC_TS_SERVE"] == "1" { Tailscale.unserve(port: Int(env["SARA_PORT"] ?? "") ?? defaultPort); notes.append("Removed her Tailscale address.") }
    removeCommandLineTool()
    if deleteData {
      do { try FileManager.default.removeItem(atPath: dataDir); notes.append("Deleted her data folder.") } catch { notes.append("Couldn't delete \(dataDir): \(error.localizedDescription)") }
    } else {
      try? FileManager.default.removeItem(atPath: serviceDir)
      notes.append("Her data is kept in \(dataDir) (set her up again any time and she remembers everything).")
    }
    return notes
  }

  // MARK: the `sara` command (optional)

  var cliPath: String { home + "/.local/bin/sara" }
  static let cliMarker = "# Sara's command line tool (made by the Sara app)"

  func installCommandLineTool() throws -> String {
    let dir = home + "/.local/bin"
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    if let cur = try? String(contentsOfFile: cliPath, encoding: .utf8), !cur.contains(LocalServer.cliMarker) {
      throw NSError(domain: "Sara", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(cliPath) already exists and isn't Sara's."])
    }
    let exe = Bundle.main.executablePath ?? (Bundle.main.bundlePath + "/Contents/MacOS/Sara")
    let q = "'" + exe.replacingOccurrences(of: "'", with: "'\\''") + "'"
    let script = "#!/bin/sh\n\(LocalServer.cliMarker)\nexec \(q) --cli \"$@\"\n"
    FileManager.default.createFile(atPath: cliPath, contents: Data(script.utf8), attributes: [.posixPermissions: 0o755])
    let onPath = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").contains { $0 == dir }
    return onPath ? "Installed: type `sara status` in Terminal." : "Installed as \(cliPath). Add ~/.local/bin to your PATH (or type the full path)."
  }

  func removeCommandLineTool() {
    if let cur = try? String(contentsOfFile: cliPath, encoding: .utf8), cur.contains(LocalServer.cliMarker) { try? FileManager.default.removeItem(atPath: cliPath) }
  }
}

extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }

// MARK: the supervisor (launchd runs `Sara --run-server`)

enum Supervisor {
  static var child: pid_t = 0
  static var quitting = false
  static var restartSelf = false

  static func log(_ s: LocalServer, _ msg: String) {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    let line = "[\(f.string(from: Date()))] supervisor: \(msg)\n"
    if let h = FileHandle(forWritingAtPath: s.serviceLog) { h.seekToEndOfFile(); h.write(Data(line.utf8)); h.closeFile() }
    else { FileManager.default.createFile(atPath: s.serviceLog, contents: Data(line.utf8), attributes: [.posixPermissions: 0o600]) }
  }

  static func run() -> Never {
    if getuid() == 0 {
      // Never as root (Phase 55: there is no system-wide LaunchDaemon any more; a registration left
      // by an older version ends here, and exit 0 keeps launchd from starting it again).
      FileHandle.standardError.write(Data("Sara: not starting as root. Sara runs while you're signed in: open the Sara app (it moves an older \"from startup\" setup over by itself).\n".utf8))
      exit(0)
    }
    guard let pw = getpwuid(getuid()) else { exit(1) }
    let home = String(cString: pw.pointee.pw_dir)
    let s = LocalServer(home: home)
    try? s.ensureFolders()
    umask(0o077)
    try? "\(getpid())\n".write(toFile: s.supervisorPidFile, atomically: true, encoding: .utf8)
    log(s, "started (pid \(getpid()), user \(String(cString: pw.pointee.pw_name)), app \(Bundle.main.bundlePath), server \(s.bundledVersion))")

    signal(SIGTERM, SIG_IGN)
    signal(SIGHUP, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    term.setEventHandler { quitting = true; if child > 0 { kill(child, SIGTERM) } }
    term.resume()
    let hup = DispatchSource.makeSignalSource(signal: SIGHUP, queue: .main)
    hup.setEventHandler { quitting = true; restartSelf = true; if child > 0 { kill(child, SIGTERM) } }
    hup.resume()
    let intr = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    intr.setEventHandler { quitting = true; if child > 0 { kill(child, SIGTERM) } }
    intr.resume()

    Thread.detachNewThread { loop(s) }
    dispatchMain()
  }

  static func loop(_ s: LocalServer) {
    var fails = 0
    while !quitting {
      if !s.configured || s.stopped || s.switchedOff { sleep(1); continue }
      try? s.ensureFolders()  // a restore or a cleanup may have removed the logs folder
      upgradeIfNeeded(s)
      rotateLog(s)
      let started = Date()
      let pid = spawnNode(s)
      if pid <= 0 { log(s, "couldn't start Node"); sleep(10); continue }
      child = pid
      try? "\(pid)\n".write(toFile: s.nodePidFile, atomically: true, encoding: .utf8)
      log(s, "Sara started (pid \(pid), port \(s.port))")
      var status: Int32 = 0
      while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
      child = 0
      try? FileManager.default.removeItem(atPath: s.nodePidFile)
      let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
      log(s, "Sara stopped (exit \(code))")
      if quitting || s.stopped || code == 0 { continue }  // 0: a clean stop (Stop, settings changed)
      // Crashed or failed to start: wait a little longer each time (10 s … 2 min).
      fails = Date().timeIntervalSince(started) > 120 ? 0 : fails + 1
      sleep(UInt32(min(120, 10 * max(1, fails))))
    }
    try? FileManager.default.removeItem(atPath: s.supervisorPidFile)
    log(s, restartSelf ? "restarting (new app version)" : "stopped")
    // launchd starts it again after a non-zero exit (KeepAlive SuccessfulExit = false).
    exit(restartSelf ? 1 : 0)
  }

  /// A newer app: back up her data before the new server touches it, then remember the version.
  static func upgradeIfNeeded(_ s: LocalServer) {
    let now = s.bundledVersion
    let before = (try? String(contentsOfFile: s.versionFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if before == now { return }
    if !before.isEmpty && FileManager.default.fileExists(atPath: s.dataDir + "/sara.db") {
      let f = DateFormatter()
      f.dateFormat = "yyyy-MM-dd-HHmmss"
      let file = "\(s.dataDir)/backups/before-\(now)-\(f.string(from: Date())).tar.gz"
      try? FileManager.default.createDirectory(atPath: s.dataDir + "/backups", withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      let r = s.runNode(["--backup", file])
      log(s, "upgrade \(before) → \(now): backup \(r.code == 0 ? "written to \(file)" : "FAILED: \(r.out.prefix(300))")")
    }
    try? "\(now)\n".write(toFile: s.versionFile, atomically: true, encoding: .utf8)
  }

  static func rotateLog(_ s: LocalServer) {
    if let a = try? FileManager.default.attributesOfItem(atPath: s.serviceLog), (a[.size] as? Int ?? 0) > 5_000_000 {
      try? FileManager.default.removeItem(atPath: s.serviceLog + ".1")
      try? FileManager.default.moveItem(atPath: s.serviceLog, toPath: s.serviceLog + ".1")
    }
  }

  /// Node with the server; stdout goes nowhere (the one-time token is in first-token.txt, never in
  /// a log), stderr to logs/service.log. Sara keeps her own log in logs/sara.log.
  static func spawnNode(_ s: LocalServer) -> pid_t {
    var fa: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fa)
    defer { posix_spawn_file_actions_destroy(&fa) }
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0)
    posix_spawn_file_actions_addopen(&fa, 2, s.serviceLog, O_WRONLY | O_CREAT | O_APPEND, 0o600)
    posix_spawn_file_actions_addchdir_np(&fa, s.serverRoot)
    let args = [s.node, "--disable-warning=ExperimentalWarning", s.serverRoot + "/src/main.ts"]
    let env = s.nodeEnv().map { "\($0.key)=\($0.value)" }
    var cargs = args.map { strdup($0) } + [nil]
    var cenv = env.map { strdup($0) } + [nil]
    defer { cargs.forEach { free($0) }; cenv.forEach { free($0) } }
    var pid: pid_t = 0
    let r = posix_spawn(&pid, s.node, &fa, nil, &cargs, &cenv)
    return r == 0 ? pid : -1
  }
}

// MARK: `Sara --cli …` (the `sara` command)

enum CLI {
  static func say(_ s: String) { print(s) }

  static func run(_ argv: [String]) -> Int32 {
    let s = LocalServer()
    let cmd = argv.first ?? "help"
    let rest = Array(argv.dropFirst())
    func need() -> Bool {
      if !s.configured { say("Sara's server isn't set up on this Mac yet. Open the Sara app (or: sara setup)."); return false }
      return true
    }
    switch cmd {
    case "version", "--version":
      say("Sara \(s.bundledVersion) (app \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"))")
    case "status":
      guard need() else { return 1 }
      if let o = s.migrateFromDaemon() { o.notes.forEach(say) }
      say(s.switchedOff ? "Switched off: this Mac connects to a Sara somewhere else (her data is kept; sara setup turns her on again)." : "How she runs: while you're signed in (LaunchAgent): \(s.statusWord(s.agent.status))\(s.stopped ? ", stopped" : "")")
      let r = s.runNode(["--status"], timeout: 20); print(r.out, terminator: ""); return r.code
    case "doctor":
      guard need() else { return 1 }
      let r = s.runNode(["--doctor"], timeout: 120); print(r.out, terminator: ""); return r.code
    case "backup":
      guard need() else { return 1 }
      let b = s.backup(to: rest.first); say(b.message); return b.ok ? 0 : 1
    case "restore":
      guard need(), let file = rest.first else { say("Usage: sara restore <backup.tar.gz>"); return 2 }
      s.stop()
      let r = s.runNode(["--restore", file]); print(r.out, terminator: "")
      s.start()
      return r.code
    case "reset-token":
      guard need() else { return 1 }
      let wasStopped = s.stopped
      s.stop()
      let r = s.runNode(["--reset-token"], timeout: 60); print(r.out, terminator: "")
      if !wasStopped { s.start() }
      return r.code
    case "token":
      if let t = s.firstToken() { say(t); return 0 }
      say("No unused one-time owner key (it's deleted after the first sign-in). Make a new one: sara reset-token"); return 1
    case "logs":
      let n = Int(rest.first ?? "") ?? 60
      for f in [s.logsDir + "/sara.log", s.serviceLog] {
        guard let t = try? String(contentsOfFile: f, encoding: .utf8) else { continue }
        say("== \(f)")
        say(t.split(separator: "\n", omittingEmptySubsequences: false).suffix(n).joined(separator: "\n"))
      }
    case "stop":
      guard need() else { return 1 }
      s.stop(); say("Sara is stopped. Start her again with: sara start")
    case "start":
      guard need() else { return 1 }
      if s.switchedOff { say("Sara is switched off on this Mac (the app connects to a Sara somewhere else). Turn her on again with: sara setup"); return 1 }
      s.start(); say(s.waitHealthy(seconds: 30) ? "Sara is running: \(s.localURL)" : "Asked her to start; she isn't answering yet (sara logs).")
    case "access":
      guard need() else { return 1 }
      guard let a = rest.first.flatMap(Access.init(rawValue:)) else {
        say("How you reach her: \(s.access.label) — \(s.publicURL)\nChange: sara access tailscale|local|lan"); return 0
      }
      let o = s.setUp(access: a, port: s.port) { say($0) }
      o.notes.forEach(say)
      say("How you reach her: \(s.access.label) — \(s.publicURL)")
      return o.ok ? 0 : 1
    case "setup":
      var access = Access.local, port = defaultPort
      var i = 0
      while i < rest.count {
        let v = i + 1 < rest.count ? rest[i + 1] : ""
        switch rest[i] {
        case "--mode":
          if v == "daemon" { say("\"From startup\" (--mode daemon) was removed: Sara runs while you're signed in (LaunchAgent).") }
          i += 1
        case "--access": access = Access(rawValue: v) ?? access; i += 1
        case "--port": port = Int(v) ?? port; i += 1
        default: break
        }
        i += 1
      }
      if !s.configured && !portIsFree(port) { say("Port \(port) is in use. Choose another with --port."); return 1 }
      _ = s.migrateFromDaemon()
      let o = s.setUp(access: access, port: port) { say($0) }
      o.notes.forEach(say)
      if o.needsApproval { say("Turn on \"Sara\" in System Settings → General → Login Items (Allow in the Background). She starts right after."); return 3 }
      guard o.ok else { return 1 }
      if s.waitHealthy(seconds: 40) { say("Sara is running: \(s.localURL)") } else { say("She isn't answering yet: sara logs"); return 1 }
      if let t = s.waitToken(seconds: 15) { say("Owner key (sign in with it once, keep it in a password manager): \(t)") }
    case "uninstall":
      let del = rest.contains("--delete-data")
      let desk = rest.contains("--no-backup") ? nil : (s.home + "/Desktop")
      s.uninstall(deleteData: del, backupDir: desk).forEach(say)
    case "install-cli":
      do { say(try s.installCommandLineTool()) } catch { say(error.localizedDescription); return 1 }
    case "service-status":
      say("agent: \(s.statusWord(s.agent.status))\(s.switchedOff ? " (switched off)" : ""); supervisor pid \(s.pid(s.supervisorPidFile).map(String.init) ?? "-"); node pid \(s.pid(s.nodePidFile).map(String.init) ?? "-")")
    default:
      say("""
      sara — Sara's server on this Mac
        status · doctor · logs [lines] · version
        backup [file] · restore <file> · reset-token · token
        stop · start · access [tailscale|local|lan]
        setup [--access tailscale|local|lan] [--port 7860]
        uninstall [--delete-data] [--no-backup] · install-cli
      """)
      return cmd == "help" ? 0 : 2
    }
    return 0
  }
}
