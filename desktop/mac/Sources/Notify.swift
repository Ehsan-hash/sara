// Phase 75 stage 3 (native): notifications with buttons, and files dropped on the Dock icon.
//
// Notifications (UNUserNotificationCenter), from the quick-ask page's data (QuickAsk.swift):
//   - category "approval": an approval waiting, with what she wants to run (summary + command) and
//     Allow / Deny / Open in Sara. Allow and Deny call the same route as the menu bar's Allow and
//     the chat's card (saraQuick.decide), and only for an approval this app showed, for the server
//     in use, that is still waiting: anything else opens the conversation, so the owner decides
//     there. Never decided by itself. Decided anywhere else: the notification is taken away.
//   - category "reminder": a reminder that went off, with Done and Snooze 10 min (the normal
//     reminders route, again in 10 minutes).
//   - the page's own notify() (messages, calls) stays a plain notification; a reminder the page
//     also announces gets the same identifier (her conversation + the text), so the one with the
//     buttons replaces it, and the page's is dropped when ours came first. The web app never
//     notifies for approvals.
// Shown only when the window isn't in front, with the page's Notifications switch on, signed in and
// not on the demo. macOS asks for permission the first time Sara has something to show (not at start).
//
// Dock icon drops (application(_:open:)): files go into the message box as attachments by the
// page's own attach code (types, sizes, how many as for a drop on the window), never sent by
// themselves. They travel to the page as data, so each one is capped (kMaxDockFile).
import AppKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

let kMaxDockFiles = 10
let kMaxDockFile = 50 * 1024 * 1024

/// State for the notifications this app showed (per running app, for the server in use).
final class NativeNotes {
  var approvals: [String: String] = [:]  // approval id → notification identifier
  var approvalsServer = ""
  var reminders: [String: (rid: String, conv: String, text: String, at: Date)] = [:]  // identifier → reminder
  var pageShown: [String: Date] = [:]  // identifier → when the page's own notify showed it
  var pendingFiles: [URL] = []
  var filesInFlight = false
}

/// A short stable identifier (FNV-1a 64) for one event: her conversation and the text.
func noteKey(_ prefix: String, _ key: String) -> String {
  var h: UInt64 = 1469598103934665603
  for u in key.unicodeScalars { h ^= UInt64(u.value); h = h &* 1099511628211 }
  return prefix + String(format: "%016llx", h)
}
func messageNoteId(_ conv: String, _ body: String) -> String { noteKey("m", conv + "\n" + String(body.prefix(500))) }
func plainId(_ s: String, _ max: Int = 80) -> String { String(s.prefix(max).filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) }

extension AppDelegate {
  /// The two kinds with buttons. Done once at start (asks nothing).
  func registerNoteCategories() {
    let allow = UNNotificationAction(identifier: "allow", title: "Allow", options: [])
    let deny = UNNotificationAction(identifier: "deny", title: "Deny", options: [.destructive])
    let open = UNNotificationAction(identifier: "open", title: "Open in Sara", options: [.foreground])
    let done = UNNotificationAction(identifier: "done", title: "Done", options: [])
    let snooze = UNNotificationAction(identifier: "snooze", title: "Snooze 10 min", options: [])
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(identifier: "approval", actions: [allow, deny, open], intentIdentifiers: [], options: []),
      UNNotificationCategory(identifier: "reminder", actions: [done, snooze], intentIdentifiers: [], options: []),
    ])
  }

  /// macOS asks once, the first time there's something to show (then the answer is kept).
  func withNotePermission(_ go: @escaping () -> Void) {
    let c = UNUserNotificationCenter.current()
    c.getNotificationSettings { s in
      DispatchQueue.main.async {
        switch s.authorizationStatus {
        case .authorized, .provisional: go()
        case .notDetermined:
          c.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in if ok { DispatchQueue.main.async(execute: go) } }
        default: break  // turned off in System Settings → Notifications
        }
      }
    }
  }

  /// Notifications are on and the owner isn't looking at Sara already.
  var notifyNow: Bool { notificationsOn && !(window.isKeyWindow && NSApp.isActive) && !(quick?.panel?.isKeyWindow ?? false) }

  func addNote(id: String, title: String, body: String, category: String = "", info: [String: String] = [:]) {
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    c.sound = .default
    if !category.isEmpty { c.categoryIdentifier = category }
    var all = info
    all["server"] = Servers.activeId ?? ""
    c.userInfo = all
    #if DEBUG
    testLog("note id=\(id) category=\(category) title=\(title) body=\(body.replacingOccurrences(of: "\n", with: " / "))")
    testNoteAction(id: id, category: category, info: all)
    #endif
    withNotePermission {
      UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil)) { err in
        #if DEBUG
        testLog("note added id=\(id) error=\(err.map { "\($0)" } ?? "none")")
        #endif
      }
    }
  }

  /// SaraDesktop.notify() from the page: a plain notification that opens that conversation.
  func notifyFromPage(title: String, body: String, conv: String) {
    guard notificationsOn, !(window.isKeyWindow && NSApp.isActive) else { return }
    let id = messageNoteId(plainId(conv, 64), body)
    if let r = notes.reminders[id], Date().timeIntervalSince(r.at) < 300 { return }  // ours (Done / Snooze) is there
    notes.pageShown = notes.pageShown.filter { Date().timeIntervalSince($0.value) < 300 }
    notes.pageShown[id] = Date()
    addNote(id: id, title: title, body: body, info: ["conv": conv])
  }

  /// Approvals waiting ("id\tconv\tsummary\tcommand" lines): one notification each; decided ones go.
  func notifyApprovals(_ lines: String) {
    let server = Servers.activeId ?? ""
    let center = UNUserNotificationCenter.current()
    if notes.approvalsServer != server {
      center.removeDeliveredNotifications(withIdentifiers: Array(notes.approvals.values))
      notes.approvals = [:]
      notes.approvalsServer = server
    }
    var waiting = Set<String>()
    for line in lines.split(separator: "\n").prefix(10) {
      let f = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
      guard f.count == 4, !f[0].isEmpty, plainId(f[0]) == f[0] else { continue }
      waiting.insert(f[0])
      guard notes.approvals[f[0]] == nil, notifyNow else { continue }
      let id = noteKey("a", f[0])
      notes.approvals[f[0]] = id
      let who = quick?.name ?? "Sara"
      // What she wants to do and the command itself, so Allow is an informed OK.
      addNote(id: id, title: "\(who) wants your OK", body: String(f[2].prefix(160)) + (f[3].isEmpty ? "" : "\n" + String(f[3].prefix(300))), category: "approval",
              info: ["approval": f[0], "conv": plainId(f[1], 64)])
    }
    let gone = notes.approvals.filter { !waiting.contains($0.key) }
    if !gone.isEmpty { center.removeDeliveredNotifications(withIdentifiers: Array(gone.values)) }
    for k in gone.keys { notes.approvals.removeValue(forKey: k) }
  }

  /// {a:'reminder'} from the quick-ask page: a notification with Done / Snooze 10 min.
  func notifyReminder(conv rawConv: String, rid rawRid: String, text rawText: String) {
    guard let q = quick, q.signedIn, !q.demo, notifyNow else { return }
    let conv = plainId(rawConv, 64), rid = plainId(rawRid, 20), text = String(rawText.prefix(2000))
    guard !text.isEmpty else { return }
    let id = messageNoteId(conv, text)
    notes.reminders = notes.reminders.filter { Date().timeIntervalSince($0.value.at) < 3600 }
    notes.reminders[id] = (rid: rid, conv: conv, text: text, at: Date())
    // The same identifier as the page's notification for it: this one (with the buttons) replaces it.
    addNote(id: id, title: "Reminder", body: String(text.prefix(400)), category: "reminder", info: ["conv": conv, "reminder": rid])
  }

  /// A click on a notification or one of its buttons.
  func handleNoteResponse(_ r: UNNotificationResponse) {
    handleNoteAction(r.actionIdentifier, id: r.notification.request.identifier, info: r.notification.request.content.userInfo)
  }

  func handleNoteAction(_ action: String, id: String, info: [AnyHashable: Any]) {
    let conv = info["conv"] as? String ?? ""
    let here = (info["server"] as? String ?? "") == (Servers.activeId ?? "")
    #if DEBUG
    testLog("note action \(action) on \(id)")
    #endif
    switch action {
    case "allow", "deny":
      let aid = info["approval"] as? String ?? ""
      let still = quick?.items.contains { $0.kind == "approval" && $0.id == aid } ?? false
      if here, !aid.isEmpty, notes.approvals[aid] != nil, still, quick?.ready ?? false {
        // The owner's explicit OK (or no) for exactly what the notification showed: the menu bar's Allow / Deny.
        quick?.decide(aid, action == "allow")
        notes.approvals.removeValue(forKey: aid)
        return
      }
      showWindow()
      openConversation(conv)  // not one we can vouch for: the owner decides on the card
    case "snooze":
      guard here else { return }
      let rem = notes.reminders[id]
      quick?.snooze(rid: rem?.rid ?? (info["reminder"] as? String ?? ""), conv: conv, text: rem?.text ?? "")
    case "done", UNNotificationDismissActionIdentifier:
      break
    default:
      showWindow()
      if here { openConversation(conv) }
    }
  }

  // MARK: files dropped on the Dock icon (or "Open With → Sara")

  func application(_ application: NSApplication, open urls: [URL]) {
    let files = urls.filter { $0.isFileURL && !$0.hasDirectoryPath }.prefix(kMaxDockFiles)
    guard !files.isEmpty else { return }
    for f in files where notes.pendingFiles.count < kMaxDockFiles { notes.pendingFiles.append(f) }
    showWindow()
    deliverDockFiles()
  }

  /// Hands the waiting files to her page (once it's her page, signed in) as File objects.
  func deliverDockFiles() {
    guard !notes.pendingFiles.isEmpty, !notes.filesInFlight, isServer(web.url), web.url?.path.hasPrefix("/pair") == false else { return }
    var items: [[String: String]] = []
    var tooBig: [String] = []
    for url in notes.pendingFiles {
      let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      guard size > 0, size <= kMaxDockFile, let data = try? Data(contentsOf: url) else { tooBig.append(url.lastPathComponent); continue }
      let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
      items.append(["name": url.lastPathComponent, "type": type, "data": data.base64EncodedString()])
    }
    notes.pendingFiles = []
    if !tooBig.isEmpty { addNote(id: UUID().uuidString, title: "Drag big files into Sara's window", body: "\(tooBig.joined(separator: ", ")) is over 50 MB for the Dock icon. Drag it into her window instead.") }
    guard !items.isEmpty else { return }
    notes.filesInFlight = true
    web.callAsyncJavaScript(dockAttachJS, arguments: ["items": items], in: nil, in: .page) { [weak self] result in
      guard let self else { return }
      self.notes.filesInFlight = false
      #if DEBUG
      testLog("dock files: \(items.count) given to the page, result \(result)")
      #endif
      if case .success(let v) = result, (v as? Bool) == true { return }
      self.addNote(id: UUID().uuidString, title: "Sara couldn't take the files yet", body: "Sign in to her in the window first (and not on the demo), then drop them again.")
    }
  }
}

/// The page's own hook when it has one, else its attach button's file input (so its own rules apply).
let dockAttachJS = """
const files = items.map((i) => {
  const b = atob(i.data), u = new Uint8Array(b.length);
  for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
  return new File([u], i.name, { type: i.type });
});
if (!files.length) return false;
if (typeof window.saraDesktopAttach === 'function') return (await window.saraDesktopAttach(files)) !== false;
const input = document.getElementById('attach-file');
if (!input || document.body.classList.contains('demo')) return false;
const dt = new DataTransfer();
for (const f of files) dt.items.add(f);
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
return true;
"""

#if DEBUG
extension AppDelegate {
  /// Test builds only (no screen over SSH): SARA_TEST_NOTE_ACTION=allow|deny presses that button on the
  /// first approval notification (after pressing Allow on a made-up approval id first, which must
  /// only open the conversation), SARA_TEST_NOTE_SNOOZE=1 presses Snooze on the first reminder.
  func testNoteAction(id: String, category: String, info: [String: String]) {
    let env = ProcessInfo.processInfo.environment
    if category == "approval", let a = env["SARA_TEST_NOTE_ACTION"], prefs.string(forKey: "testNoteActed") != id {
      prefs.set(id, forKey: "testNoteActed")
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        var forged = info
        forged["approval"] = "deadbeef-0000"
        self.handleNoteAction("allow", id: "forged", info: forged)
        testLog("after forged allow: still waiting=\(self.quick?.items.contains { $0.kind == "approval" } ?? false)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.handleNoteAction(a, id: id, info: info) }
      }
    }
    if category == "reminder", env["SARA_TEST_NOTE_SNOOZE"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.handleNoteAction("snooze", id: id, info: info) }
    }
  }
}
#endif
