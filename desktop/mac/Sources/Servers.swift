// Phase 68: several Sara servers in one app, each with its own sign-in.
//
// The list (id, name, address, emoji, last used) is kept in the app's preferences; no sign-in is
// stored there. Each server's sign-in is its session cookie in a WebKit website data store of its
// own: the first server (the one from before 1.8) keeps the default store, so an update keeps its
// sign-in; every other one gets WKWebsiteDataStore(forIdentifier:) (macOS 14+), which WebKit keeps
// apart from the others (and in this user's protected Library). The menu bar's "Your Saras" menu
// and the page's ⇄ menu switch between them without signing out.
import AppKit
import WebKit

struct SavedServer {
  var id: String
  var name: String
  var named: Bool
  var url: String
  var emoji: String
  var lastUsed: Double
  /// The website data store of this server (nil: the default store, used by s1).
  var store: String?

  var dict: [String: Any] {
    var d: [String: Any] = ["id": id, "name": name, "named": named, "url": url, "emoji": emoji, "lastUsed": lastUsed]
    if let store { d["store"] = store }
    return d
  }

  init(id: String, name: String, named: Bool = false, url: String, emoji: String = "", lastUsed: Double = Date().timeIntervalSince1970, store: String? = nil) {
    self.id = id
    self.name = name
    self.named = named
    self.url = url
    self.emoji = emoji
    self.lastUsed = lastUsed
    self.store = store
  }

  init?(_ d: [String: Any]) {
    guard let id = d["id"] as? String, let url = d["url"] as? String, !id.isEmpty, !url.isEmpty else { return nil }
    self.init(id: id, name: d["name"] as? String ?? hostOf(url), named: d["named"] as? Bool ?? false, url: url, emoji: d["emoji"] as? String ?? "", lastUsed: d["lastUsed"] as? Double ?? 0, store: d["store"] as? String)
  }
}

func hostOf(_ url: String) -> String {
  guard let r = url.range(of: "://") else { return url }
  return String(url[r.upperBound...])
}

enum Servers {
  /// The saved servers. The one server from before 1.8 becomes s1 (default store), nothing to do.
  static func list() -> [SavedServer] {
    if let raw = prefs.array(forKey: "servers") as? [[String: Any]] { return raw.compactMap(SavedServer.init) }
    guard let old = prefs.string(forKey: "server"), !old.isEmpty else { return [] }
    let one = SavedServer(id: "s1", name: hostOf(old), url: old)
    save([one], active: "s1")
    return [one]
  }

  static func save(_ list: [SavedServer], active: String?) {
    prefs.set(list.map(\.dict), forKey: "servers")
    if let a = list.first(where: { $0.id == active }) {
      prefs.set(a.id, forKey: "activeServer")
      prefs.set(a.url, forKey: "server")  // the rest of the app reads "server"
    } else {
      prefs.removeObject(forKey: "activeServer")
      prefs.removeObject(forKey: "server")
    }
  }

  static var activeId: String? { prefs.string(forKey: "activeServer") ?? list().first?.id }
  static var active: SavedServer? { list().first { $0.id == activeId } }

  /// A name no other saved server uses: "Sara", then "Sara (192.168.1.20:7882)".
  static func uniqueName(_ wanted: String, url: String, except id: String?) -> String {
    let taken = Set(list().filter { $0.id != id }.map { $0.name.lowercased() })
    let w = wanted.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = w.isEmpty ? hostOf(url) : String(w.prefix(60))
    if !taken.contains(base.lowercased()) { return base }
    let withHost = "\(base) (\(hostOf(url)))"
    if !taken.contains(withHost.lowercased()) { return withHost }
    var i = 2
    while taken.contains("\(withHost) \(i)".lowercased()) { i += 1 }
    return "\(withHost) \(i)"
  }

  /// The saved server at exactly this address, or a new one (not signed in yet).
  static func idFor(_ url: String) -> String {
    var l = list()
    if let p = l.first(where: { $0.url == url }) { return p.id }
    var n = 1
    while l.contains(where: { $0.id == "s\(n)" }) { n += 1 }
    let id = "s\(n)"
    // s1 is the default store (as before 1.8); every other server has a store of its own.
    l.append(SavedServer(id: id, name: uniqueName("", url: url, except: id), url: url, store: id == "s1" ? nil : UUID().uuidString))
    save(l, active: activeId)
    return id
  }

  static func update(_ id: String, _ change: (inout SavedServer) -> Void) {
    var l = list()
    guard let i = l.firstIndex(where: { $0.id == id }) else { return }
    change(&l[i])
    save(l, active: activeId)
  }

  static func remove(_ id: String) {
    let l = list().filter { $0.id != id }
    save(l, active: activeId == id ? nil : activeId)
  }

  /// {"servers":[{id,name,host,active,emoji}]} for the page: names and hosts only.
  static func json() -> [String: Any] {
    let a = activeId
    return ["servers": list().map { ["id": $0.id, "name": $0.name, "host": hostOf($0.url), "emoji": $0.emoji, "active": $0.id == a] as [String: Any] }]
  }

  /// The website data store of a server (default for s1 / older macOS).
  static func dataStore(_ p: SavedServer?) -> WKWebsiteDataStore {
    if let s = p?.store, let uuid = UUID(uuidString: s) {
      if #available(macOS 14.0, *) { return WKWebsiteDataStore(forIdentifier: uuid) }
    }
    return .default()
  }

  /// A second server needs a data store of its own (macOS 14 or newer).
  static var canHoldSeveral: Bool {
    if #available(macOS 14.0, *) { return true }
    return false
  }
}

extension AppDelegate {
  /// Shows a saved server in a web view on its own data store; nobody is signed out.
  func useServer(_ id: String, path: String = "/") {
    guard let p = Servers.list().first(where: { $0.id == id }) else { return }
    let changing = web == nil || webServerId != p.id
    Servers.update(id) { $0.lastUsed = Date().timeIntervalSince1970 }
    Servers.save(Servers.list(), active: id)
    prefs.set(p.url == local.localURL, forKey: "localServer")
    statusItem?.button?.toolTip = "Sara · \(p.name)"  // her mood replaces it once the quick-ask page says it
    if changing { makeWebView(store: Servers.dataStore(p), for: p.id) }
    openServer(path)
    refreshServerState()
    if changing { handsSync() }  // Phase 87: the hands follow the Sara in use
  }

  /// "Add a Sara…": the address page; the new server gets a store of its own.
  @objc func addServerFromMenu() {
    showWindow()
    if !Servers.list().isEmpty && !Servers.canHoldSeveral {
      return alert("Several Saras need macOS 14", "This Mac can keep one Sara signed in. To use another one, remove this one first (Your Saras → Remove…), or update macOS.")
    }
    showSetup()
  }

  @objc func useServerFromMenu(_ item: NSMenuItem) {
    guard let id = item.representedObject as? String else { return }
    showWindow()
    useServer(id)
  }

  /// Signs out of one server (on the server, from its own page) and forgets only its sign-in.
  func removeServer(_ id: String) {
    guard Servers.list().contains(where: { $0.id == id }) else { return }
    if id != Servers.activeId {
      // Its sign-in is in its own store: open it, then sign out there (see didFinish).
      pendingRemove = id
      return useServer(id)
    }
    removeActiveServer()
  }

  func removeActiveServer() {
    guard let p = Servers.active else { return }
    var finished = false
    let finish = { [weak self] in
      guard let self, !finished else { return }
      finished = true
      let done = { [weak self] in
        Servers.remove(p.id)
        if p.url == self?.local.localURL { prefs.removeObject(forKey: "localServer") }
        self?.afterRemove()
      }
      self.web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body></body></html>", baseURL: nil)
      if let s = p.store, let uuid = UUID(uuidString: s), #available(macOS 14.0, *) {
        self.makeWebView(store: .default(), for: nil)
        WKWebsiteDataStore.remove(forIdentifier: uuid) { _ in DispatchQueue.main.async { done() } }
      } else {
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { done() }
      }
    }
    web.evaluateJavaScript("fetch('/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(()=>1,()=>0)") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { finish() }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish() }  // offline: forget it here anyway
  }

  /// After a removal: the most recently used other server, or the address page.
  func afterRemove() {
    refreshServerState()
    if let next = Servers.list().max(by: { $0.lastUsed < $1.lastUsed }) { return useServer(next.id) }
    prefs.removeObject(forKey: "localServer")
    startFirstRun()
  }

  /// The menu bar's list of saved servers (✓ the one in use) and Add / Remove.
  func addServerItems(to m: NSMenu) {
    let list = Servers.list()
    let a = Servers.activeId
    for p in list {
      // "Sara (host)", or just the host while she has no name yet (the same as the Windows tray).
      let host = hostOf(p.url)
      let label = (p.emoji.isEmpty ? "" : p.emoji + " ") + p.name + (p.name.lowercased() == host.lowercased() ? "" : "  (\(host))")
      let item = NSMenuItem(title: label, action: #selector(useServerFromMenu(_:)), keyEquivalent: "")
      item.representedObject = p.id
      item.state = p.id == a ? .on : .off
      item.target = self
      m.addItem(item)
    }
    if !list.isEmpty { m.addItem(.separator()) }
    let add = NSMenuItem(title: "Add a Sara…", action: #selector(addServerFromMenu), keyEquivalent: "")
    add.target = self
    m.addItem(add)
    if list.count > 1, let cur = Servers.active {
      let rm = NSMenuItem(title: "Remove \(cur.name)…", action: #selector(removeActiveFromMenu), keyEquivalent: "")
      rm.target = self
      m.addItem(rm)
    }
  }

  @objc func removeActiveFromMenu() {
    guard let cur = Servers.active else { return }
    showWindow()
    let q = NSAlert()
    q.messageText = "Remove \(cur.name) from this app?"
    q.informativeText = "This app signs out of \(cur.url) and forgets it. Your other Saras stay signed in. Nothing else changes on that server."
    q.addButton(withTitle: "Remove")
    q.addButton(withTitle: "Cancel")
    guard q.runModal() == .alertFirstButtonReturn else { return }
    removeActiveServer()
  }
}
