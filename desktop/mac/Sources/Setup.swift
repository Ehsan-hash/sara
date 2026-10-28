// "Run Sara on this Mac" (Phase 46d, Phase 55): the first-launch choice (this Mac, or a Sara somewhere
// else), the setup sheet, the Login Items approval step, the owner key, and the "Sara server" menu
// (status, back up, data folder, how you reach her, stop / start, command line tool, uninstall, and
// switching between this Mac and a Sara somewhere else). The work itself is in Server.swift.
import AppKit
import ServiceManagement
import WebKit

let httpsGuide = URL(string: "https://github.com/farena-ai/sara/blob/main/docs/INSTALL.md#2-reach-her-securely-https")!

/// A label that wraps.
func wrapLabel(_ s: String, size: CGFloat = 12, color: NSColor = .secondaryLabelColor, width: CGFloat = 460) -> NSTextField {
  let l = NSTextField(wrappingLabelWithString: s)
  l.font = .systemFont(ofSize: size)
  l.textColor = color
  l.preferredMaxLayoutWidth = width
  return l
}

func heading(_ s: String) -> NSTextField {
  let l = NSTextField(labelWithString: s)
  l.font = .boldSystemFont(ofSize: 13)
  return l
}

/// The setup sheet: how she runs, how you reach her, the port.
final class SetupSheet: NSObject, NSTextFieldDelegate {
  let window: NSWindow
  var accessButtons: [Access: NSButton] = [:]
  var portField: NSTextField!, portNote: NSTextField!, accessNote: NSTextField!, progress: NSTextField!
  var spinner: NSProgressIndicator!
  var setUpButton: NSButton!, otherButton: NSButton!, cancelButton: NSButton!
  var guideButton: NSButton!
  var ts = TailscaleInfo()
  let changing: Bool
  let local: LocalServer
  var onDone: (Access, Int) -> Void = { _, _ in }
  var onOther: () -> Void = {}
  var onCancel: () -> Void = {}

  init(local: LocalServer, changing: Bool) {
    self.local = local
    self.changing = changing
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 560), styleMask: [.titled], backing: .buffered, defer: false)
    super.init()
    build()
    DispatchQueue.global().async {
      let info = Tailscale.status()
      DispatchQueue.main.async { self.ts = info; self.tailscaleChecked() }
    }
  }

  func build() {
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 22, left: 26, bottom: 20, right: 26)

    let reviving = local.switchedOff  // set up before, switched to a Sara elsewhere, now back
    let title = NSTextField(labelWithString: changing && !reviving ? "How you reach her" : "Run Sara on this Mac")
    title.font = .boldSystemFont(ofSize: 18)
    stack.addArrangedSubview(title)
    if !changing || reviving {
      stack.addArrangedSubview(wrapLabel("Sara's server runs on this Mac while you're signed in and keeps everything here. Two quick choices; the suggested ones are already picked."))
    }

    stack.addArrangedSubview(spacer(6))
    stack.addArrangedSubview(heading("How you'll reach her"))
    for a in Access.allCases {
      let b = NSButton(radioButtonWithTitle: a.label, target: self, action: #selector(accessChanged))
      accessButtons[a] = b
      stack.addArrangedSubview(b)
    }
    accessButtons[.tailscale]?.title = "Tailscale (checking…)"
    accessButtons[.tailscale]?.isEnabled = false
    accessButtons[changing ? local.access : .local]?.state = .on
    accessNote = wrapLabel("")
    stack.addArrangedSubview(indent(accessNote))
    guideButton = NSButton(title: "Open the HTTPS guide", target: self, action: #selector(openGuide))
    guideButton.bezelStyle = .inline
    guideButton.isHidden = true
    stack.addArrangedSubview(indent(guideButton))

    stack.addArrangedSubview(spacer(6))
    let portRow = NSStackView()
    portRow.orientation = .horizontal
    portRow.spacing = 8
    portRow.addArrangedSubview(heading("Port"))
    let startPort = changing ? local.port : (defaultPort...(defaultPort + 20)).first { portIsFree($0) } ?? defaultPort
    portField = NSTextField(string: String(startPort))
    portField.delegate = self
    portField.widthAnchor.constraint(equalToConstant: 70).isActive = true
    portRow.addArrangedSubview(portField)
    portNote = wrapLabel("", width: 330)
    portRow.addArrangedSubview(portNote)
    stack.addArrangedSubview(portRow)

    stack.addArrangedSubview(spacer(8))
    let progressRow = NSStackView()
    progressRow.orientation = .horizontal
    spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false
    progress = wrapLabel("", color: .labelColor, width: 430)
    progressRow.addArrangedSubview(spinner)
    progressRow.addArrangedSubview(progress)
    stack.addArrangedSubview(progressRow)

    let buttons = NSStackView()
    buttons.orientation = .horizontal
    buttons.spacing = 10
    otherButton = NSButton(title: "Connect to a Sara somewhere else instead", target: self, action: #selector(other))
    otherButton.bezelStyle = .inline
    cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
    cancelButton.keyEquivalent = "\u{1b}"
    setUpButton = NSButton(title: changing && !reviving ? "Save" : "Set up", target: self, action: #selector(go))
    setUpButton.keyEquivalent = "\r"
    if !changing { buttons.addArrangedSubview(otherButton) }
    buttons.addArrangedSubview(NSView())
    if changing { buttons.addArrangedSubview(cancelButton) }
    buttons.addArrangedSubview(setUpButton)
    stack.addArrangedSubview(buttons)
    buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

    window.contentView = stack
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.widthAnchor.constraint(equalToConstant: 520).isActive = true
    checkPort()
    accessChanged()
  }

  func spacer(_ h: CGFloat) -> NSView {
    let v = NSView()
    v.heightAnchor.constraint(equalToConstant: h).isActive = true
    return v
  }

  func indent(_ v: NSView) -> NSView {
    let row = NSStackView(views: [v])
    row.edgeInsets = NSEdgeInsets(top: 0, left: 20, bottom: 0, right: 0)
    return row
  }

  var access: Access { accessButtons.first { $0.value.state == .on }?.key ?? .local }

  func tailscaleChecked() {
    let b = accessButtons[.tailscale]!
    if ts.running, let name = ts.dnsName {
      b.title = "Tailscale: \(name) (private, your phones and computers anywhere)"
      b.isEnabled = true
      if !changing || local.access == .tailscale { b.state = .on }
    } else {
      b.title = ts.cli == nil ? "Tailscale (not installed on this Mac)" : "Tailscale (not signed in on this Mac)"
      b.isEnabled = false
      if b.state == .on { accessButtons[.local]?.state = .on }
    }
    accessChanged()
  }

  @objc func accessChanged() {
    guideButton.isHidden = access != .domain
    switch access {
    case .tailscale:
      accessNote.stringValue = ts.httpsReady || ts.dnsName == nil
        ? "Open her on any device signed in to your Tailscale with https://\(ts.dnsName ?? "this-mac")."
        : "One more thing after setup: turn on HTTPS for your tailnet (Sara tells you where)."
    case .local: accessNote.stringValue = "Only this Mac can open her. You can change this later from the menu bar: Sara server → Change how you reach her…"
    case .lan: accessNote.stringValue = "Phones and computers on your home network can open her. No HTTPS: anyone on that network could read what you send. Fine at home on a network you trust."
    case .domain: accessNote.stringValue = "Your own web address needs a domain name, HTTPS and port forwarding on your router. The guide explains it; for now Sara is set up for this Mac only."
    }
  }

  func controlTextDidChange(_ obj: Notification) { checkPort() }

  @discardableResult
  func checkPort() -> Int? {
    guard let p = Int(portField.stringValue.trimmingCharacters(in: .whitespaces)), (1024...65535).contains(p) else {
      portNote.stringValue = "Use a number from 1024 to 65535."
      portNote.textColor = .systemRed
      return nil
    }
    let ours = changing && p == local.port
    if !ours && !portIsFree(p, anyAddress: access == .lan) {
      portNote.stringValue = "Something else uses port \(p). Try \((p + 1...p + 20).first { portIsFree($0) } ?? p + 1)."
      portNote.textColor = .systemRed
      return nil
    }
    portNote.stringValue = p == defaultPort ? "Free (Sara's usual port)." : "Free."
    portNote.textColor = .secondaryLabelColor
    return p
  }

  @objc func openGuide() { NSWorkspace.shared.open(httpsGuide) }
  @objc func other() { onOther() }
  @objc func cancel() { onCancel() }

  @objc func go() {
    guard let p = checkPort() else { NSSound.beep(); return }
    if access == .domain { NSWorkspace.shared.open(httpsGuide) }
    busy(true, changing ? "Saving…" : "Setting her up…")
    onDone(access, p)
  }

  func busy(_ on: Bool, _ text: String = "") {
    progress.stringValue = text
    on ? spinner.startAnimation(nil) : spinner.stopAnimation(nil)
    for b in [setUpButton, otherButton, cancelButton] { b?.isEnabled = !on }
    for (a, b) in accessButtons { b.isEnabled = !on && (a != .tailscale || ts.running) }
    portField.isEnabled = !on
  }
}

extension AppDelegate {
  // MARK: first launch

  /// Started from the disk image or a quarantine copy: services can't be set up from there.
  var runningFromDiskImage: Bool {
    let p = Bundle.main.bundlePath
    return p.hasPrefix("/Volumes/") || p.contains("/AppTranslocation/")
  }

  func offerMoveToApplications() {
    let a = NSAlert()
    a.messageText = "Move Sara to Applications first"
    a.informativeText = "Sara is running from the disk image. Move her to your Applications folder, then she can set herself up on this Mac."
    a.addButton(withTitle: "Move to Applications")
    a.addButton(withTitle: "Not now")
    guard a.runModal() == .alertFirstButtonReturn else { return showSetup() }
    let dest = "/Applications/Sara.app"
    do {
      if FileManager.default.fileExists(atPath: dest) { try FileManager.default.trashItem(at: URL(fileURLWithPath: dest), resultingItemURL: nil) }
      try FileManager.default.copyItem(atPath: Bundle.main.bundlePath, toPath: dest)
      NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: dest), configuration: NSWorkspace.OpenConfiguration()) { _, _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
    } catch {
      let e = NSAlert()
      e.messageText = "Couldn't move Sara"
      e.informativeText = "Drag Sara from the disk image onto the Applications folder, then open her from there. (\(error.localizedDescription))"
      e.runModal()
      showSetup()
    }
  }

  /// First launch with no server chosen: "Run Sara on this Mac" or "Connect to a Sara somewhere else".
  func startFirstRun() {
    if local.active {
      // Set up before (an upgrade or a reinstall that kept her data): just use her.
      useLocalServer()
      return
    }
    guard local.hasBundledServer else { return showSetup() }
    showChoice()
  }

  /// The two choices, worded as in the Windows installer.
  func showChoice() {
    let card = "display:block;width:100%;text-align:left;margin:12px 0 0;padding:16px 18px;border-radius:12px;border:1px solid #3a3442;background:#24202b;color:#eee;font-size:16px;font-weight:600;cursor:pointer"
    let html = """
    <!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>How do you want to use Sara?</h1><p>You can change this later from the menu bar.</p>
    <button id=l style='\(card)'>Run Sara on this Mac<br><span style='font-weight:400;font-size:13px;color:#aaa'>Her server (where her memories and settings live) runs on this Mac while you're signed in. Your phone and other devices connect to it.</span></button>
    <button id=r style='\(card)'>Connect to a Sara somewhere else<br><span style='font-weight:400;font-size:13px;color:#aaa'>For a Sara that already runs on another computer or server. You sign in with a code.</span></button>
    </div><script>
    document.getElementById('l').onclick=()=>webkit.messageHandlers.sara.postMessage({m:'chooseLocal'});
    document.getElementById('r').onclick=()=>webkit.messageHandlers.sara.postMessage({m:'chooseRemote'});</script></body></html>
    """
    web.loadHTMLString(html, baseURL: nil)
  }

  /// "Run Sara on this Mac" (first launch, or later from the menu).
  func chooseLocal() {
    if local.active { return useLocalServer() }
    if runningFromDiskImage { return offerMoveToApplications() }
    // Switched off before: her old settings are pre-filled.
    showServerSetup(changing: local.switchedOff)
  }

  func useLocalServer() {
    prefs.set(local.localURL, forKey: "server")
    prefs.set(true, forKey: "localServer")
    openServer()
  }

  var isLocalServer: Bool { prefs.bool(forKey: "localServer") && local.active }

  func showServerSetup(changing: Bool) {
    showWindow()
    if !changing { web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body></body></html>", baseURL: nil) }
    let sheet = SetupSheet(local: local, changing: changing)
    setupSheet = sheet
    sheet.onOther = { [weak self] in
      guard let self else { return }
      self.window.endSheet(sheet.window)
      self.setupSheet = nil
      self.showSetup()
    }
    sheet.onCancel = { [weak self] in
      self?.window.endSheet(sheet.window)
      self?.setupSheet = nil
    }
    let reviving = local.switchedOff
    sheet.onDone = { [weak self] access, port in
      guard let self else { return }
      DispatchQueue.global().async {
        let outcome = self.local.setUp(access: access, port: port) { msg in DispatchQueue.main.async { sheet.progress.stringValue = msg } }
        DispatchQueue.main.async { self.afterSetUp(outcome, sheet: sheet, changing: changing && !reviving) }
      }
    }
    window.beginSheet(sheet.window)
  }

  func afterSetUp(_ o: LocalServer.Outcome, sheet: SetupSheet, changing: Bool) {
    if !o.ok {
      sheet.busy(false, o.notes.joined(separator: "\n"))
      sheet.progress.textColor = .systemRed
      return
    }
    window.endSheet(sheet.window)
    setupSheet = nil
    let notes = o.notes
    if o.needsApproval { return askForApproval(notes: notes, changing: changing) }
    waitForServer(notes: notes, changing: changing)
  }

  /// The service waits for the owner's OK in System Settings → Login Items (only when Sara's
  /// background switch there is off).
  func askForApproval(notes: [String], changing: Bool) {
    let a = NSAlert()
    a.messageText = "One more step: allow Sara in the background"
    a.informativeText = "System Settings opens at General → Login Items. Under \"Allow in the Background\", turn on Sara. She starts as soon as you do."
    a.addButton(withTitle: "Open Login Items")
    a.beginSheetModal(for: window) { [weak self] _ in
      guard let self else { return }
      SMAppService.openSystemSettingsLoginItems()
      self.pollApproval(notes: notes, changing: changing, until: Date().addingTimeInterval(600))
    }
  }

  func pollApproval(notes: [String], changing: Bool, until: Date) {
    if local.agent.status == .enabled { return waitForServer(notes: notes, changing: changing) }
    if Date() > until {
      alert("Sara is waiting for your OK", "Turn on Sara in System Settings → General → Login Items (Allow in the Background).")
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.pollApproval(notes: notes, changing: changing, until: until) }
  }

  func waitForServer(notes: [String], changing: Bool) {
    web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Starting Sara…</h1><p>The first start takes a few seconds.</p></div></body></html>", baseURL: nil)
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let up = self.local.waitHealthy(seconds: 60)
      let token = up && !changing ? self.local.waitToken(seconds: 15) : nil
      DispatchQueue.main.async {
        if !up {
          self.alert("Sara didn't start", "She isn't answering on \(self.local.localURL). The reason is in her log: Sara server → Open data folder → logs (service.log and sara.log).")
          return
        }
        if !notes.isEmpty { self.alert(changing ? "Saved" : "Sara is set up", notes.joined(separator: "\n\n")) }
        if let token { self.showToken(token) { self.useLocalServer() } } else {
          if !changing { self.alert("Sign in with your owner key", "Sara was set up on this Mac before, so she already has an owner key. Lost it? Sara server → New owner key…") }
          self.useLocalServer()
        }
      }
    }
  }

  func showToken(_ token: String, then: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = "Your owner key"
    a.informativeText = "You paste this once to sign in. Keep it in a password manager: it's the key to her. Sara deletes her copy after your first sign-in.\n\nOn this Mac, commands she runs are kept in a sandbox: they can only change files in her workspace, and can't see her data, your keychains or SSH keys."
    let field = NSTextField(string: token)
    field.isEditable = false
    field.isSelectable = true
    field.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
    field.frame = NSRect(x: 0, y: 0, width: 380, height: 24)
    a.accessoryView = field
    a.addButton(withTitle: "Copy and continue")
    a.addButton(withTitle: "Continue")
    #if DEBUG
    if ProcessInfo.processInfo.environment["SARA_TEST_SETUP"] != nil { testLog("token shown (\(token.count) characters)"); return then() }
    #endif
    a.beginSheetModal(for: window) { r in
      if r == .alertFirstButtonReturn {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(token, forType: .string)
      }
      then()
    }
  }

  func alert(_ title: String, _ text: String) {
    #if DEBUG
    if ProcessInfo.processInfo.environment["SARA_TEST_SETUP"] != nil { testLog("alert: \(title): \(text)"); return }
    #endif
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    if window.isVisible && window.attachedSheet == nil { a.beginSheetModal(for: window) } else { a.runModal() }
  }

  /// After an upgrade, the running supervisor is the old app's: restart it so the new one runs (it
  /// backs up her data before the new server starts).
  /// Returns true when it asked for a restart (the caller waits before loading her page).
  func checkUpgrade() -> Bool {
    guard local.configured, local.pid(local.supervisorPidFile) != nil else { return false }
    let ran = (try? String(contentsOfFile: local.versionFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !ran.isEmpty && ran != local.bundledVersion else { return false }
    local.restartSupervisor()
    return true
  }

  /// After an upgrade: "Updating Sara…" until the new server answers, then carry on.
  func waitForUpgrade(then: @escaping () -> Void) {
    web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Updating Sara…</h1><p>She makes a backup first, then starts the new version. This takes a few seconds.</p></div></body></html>", baseURL: nil)
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let end = Date().addingTimeInterval(90)
      while Date() < end {
        let ran = (try? String(contentsOfFile: self.local.versionFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if ran == self.local.bundledVersion && self.local.running && self.local.healthy() { break }
        usleep(500_000)
      }
      DispatchQueue.main.async { then() }
    }
  }

  // MARK: the "Sara server" menu

  func refreshServerState() {
    guard local.active else { serverState = server.map { "Connected to \($0)" } ?? "Not set up on this Mac"; return }
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let st = self.local.agent.status
      let text: String
      if st == .requiresApproval { text = "Waiting for your OK in Login Items" }
      else if self.local.stopped { text = "Stopped" }
      else if self.local.healthy() { text = "Running · \(self.local.publicURL)" }
      else if st != .enabled { text = "Not running (\(self.local.statusWord(st)))" }
      else { text = "Starting…" }
      DispatchQueue.main.async { self.serverState = text }
    }
  }

  func serverMenu() -> NSMenu {
    let m = NSMenu()
    m.autoenablesItems = false
    let status = NSMenuItem(title: serverState, action: nil, keyEquivalent: "")
    status.isEnabled = false
    m.addItem(status)
    m.addItem(.separator())
    if !local.active {
      // Connected to a Sara somewhere else (or nothing chosen yet).
      m.addItem(withTitle: "Connect to a different Sara…", action: #selector(connectElsewhere), keyEquivalent: "")
      if local.hasBundledServer { m.addItem(withTitle: "Set up Sara on this Mac…", action: #selector(setUpFromMenu), keyEquivalent: "") }
      if local.configured {
        // Switched off: her data is still here until it's deleted.
        m.addItem(.separator())
        m.addItem(withTitle: "Uninstall…", action: #selector(uninstallServer), keyEquivalent: "")
      }
      for i in m.items where i.action != nil { i.target = self }
      return m
    }
    if !isLocalServer { m.addItem(withTitle: "Open this Mac's Sara", action: #selector(openLocalFromMenu), keyEquivalent: "") }
    m.addItem(withTitle: "Back up now", action: #selector(backupNow), keyEquivalent: "")
    m.addItem(withTitle: "Open data folder", action: #selector(openDataFolder), keyEquivalent: "")
    m.addItem(withTitle: "Change how you reach her…", action: #selector(changeAccess), keyEquivalent: "")
    m.addItem(withTitle: local.stopped ? "Start" : "Stop", action: #selector(toggleServer), keyEquivalent: "")
    m.addItem(withTitle: "New owner key…", action: #selector(newOwnerKey), keyEquivalent: "")
    m.addItem(.separator())
    m.addItem(withTitle: "Connect to a Sara somewhere else instead…", action: #selector(switchToElsewhere), keyEquivalent: "")
    m.addItem(withTitle: FileManager.default.fileExists(atPath: local.cliPath) ? "Command line tool installed (sara)" : "Install command line tool", action: #selector(installCLI), keyEquivalent: "")
    m.addItem(withTitle: "Uninstall…", action: #selector(uninstallServer), keyEquivalent: "")
    for i in m.items where i.action != nil { i.target = self }
    return m
  }

  @objc func setUpFromMenu() { showWindow(); chooseLocal() }

  /// Connected to a Sara somewhere else: a different address. This app signs out of the old one and
  /// keeps nothing from it (its website data is cleared), so the new one never gets the old sign-in.
  @objc func connectElsewhere() {
    showWindow()
    if let s = server {
      let a = NSAlert()
      a.messageText = "Connect to a different Sara?"
      a.informativeText = "This app signs out of \(s) and forgets it. Then you type the new address and sign in there with a code. Nothing changes on \(s)."
      a.addButton(withTitle: "Connect to a different Sara")
      a.addButton(withTitle: "Cancel")
      guard a.runModal() == .alertFirstButtonReturn else { return }
    }
    forgetServer()
  }

  /// Signs this app out of the server it shows and asks for an address.
  func forgetServer() {
    prefs.removeObject(forKey: "server")
    prefs.removeObject(forKey: "localServer")
    WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
      self?.refreshServerState()
      self?.showSetup()
    }
  }

  /// Sara runs on this Mac: stop her here and connect to a Sara somewhere else instead.
  @objc func switchToElsewhere() {
    showWindow()
    let a = NSAlert()
    a.messageText = "Connect to a Sara somewhere else instead?"
    a.informativeText = "Sara on this Mac stops and won't start when you sign in\(local.readEnv()["SARA_MAC_TS_SERVE"] == "1" ? ", and her Tailscale address is removed" : ""). Then you type the address of the other Sara and sign in there with a code.\n\nHer data stays in ~/Library/Application Support/Sara until you uninstall with sara uninstall --delete-data (or Sara server → Uninstall… → Also delete her data). Sara server → Set up Sara on this Mac… brings her back as she was."
    a.addButton(withTitle: "Stop her here and connect elsewhere")
    a.addButton(withTitle: "Cancel")
    a.alertStyle = .warning
    guard a.runModal() == .alertFirstButtonReturn else { return }
    web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Stopping Sara on this Mac…</h1></div></body></html>", baseURL: nil)
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      self.local.switchOff()
      DispatchQueue.main.async { self.forgetServer() }
    }
  }
  @objc func openLocalFromMenu() { showWindow(); useLocalServer() }
  @objc func changeAccess() { showServerSetup(changing: true) }

  @objc func backupNow() {
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let b = self.local.backup()
      DispatchQueue.main.async {
        if b.ok { self.postNotification(title: "Backup made", body: b.message, conv: "") } else { self.showWindow(); self.alert("The backup didn't work", b.message) }
      }
    }
  }

  @objc func openDataFolder() { NSWorkspace.shared.open(URL(fileURLWithPath: local.dataDir)) }

  @objc func toggleServer() {
    let starting = local.stopped
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      if starting { self.local.start(); _ = self.local.waitHealthy(seconds: 30) } else { self.local.stop() }
      DispatchQueue.main.async {
        self.refreshServerState()
        if starting && self.isLocalServer { self.openServer() }
      }
    }
  }

  @objc func newOwnerKey() {
    let a = NSAlert()
    a.messageText = "Make a new owner key?"
    a.informativeText = "The old key stops working, and passkeys and two-step sign-in are turned off (set them up again in Settings). Devices already signed in stay signed in. Sara restarts for a moment."
    a.addButton(withTitle: "Make a new key")
    a.addButton(withTitle: "Cancel")
    guard a.runModal() == .alertFirstButtonReturn else { return }
    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let wasStopped = self.local.stopped
      self.local.stop()
      let r = self.local.runNode(["--reset-token"], timeout: 60)
      if !wasStopped { self.local.start() }
      let token = self.local.firstToken()
      DispatchQueue.main.async {
        self.showWindow()
        if let token, r.code == 0 { self.showToken(token) { self.openServer() } } else { self.alert("Couldn't make a new key", r.out) }
      }
    }
  }

  @objc func installCLI() {
    do { alert("Command line tool", try local.installCommandLineTool() + "\n\nsara status · sara doctor · sara backup · sara logs · sara access · sara reset-token") } catch { alert("Couldn't install it", error.localizedDescription) }
  }

  @objc func uninstallServer() {
    showWindow()
    let a = NSAlert()
    a.messageText = "Uninstall Sara's server from this Mac?"
    a.informativeText = "She stops and won't start with your Mac any more\(local.readEnv()["SARA_MAC_TS_SERVE"] == "1" ? ", and her Tailscale address is removed" : ""). A last backup goes to your Desktop first.\n\nHer data stays in \(local.dataDir) unless you tick the box, so setting her up again later brings everything back."
    let box = NSButton(checkboxWithTitle: "Also delete her data (memories, conversations, keys)", target: nil, action: nil)
    a.accessoryView = box
    a.addButton(withTitle: "Uninstall")
    a.addButton(withTitle: "Cancel")
    a.alertStyle = .warning
    a.beginSheetModal(for: window) { [weak self] r in
      guard let self, r == .alertFirstButtonReturn else { return }
      let delete = box.state == .on
      self.web.loadHTMLString("<!doctype html><html><head>\(pageStyle)</head><body><div class=c><h1>Uninstalling…</h1><p>Making a last backup first.</p></div></body></html>", baseURL: nil)
      DispatchQueue.global().async {
        let notes = self.local.uninstall(deleteData: delete, backupDir: NSHomeDirectory() + "/Desktop")
        DispatchQueue.main.async {
          prefs.removeObject(forKey: "server")
          prefs.removeObject(forKey: "localServer")
          WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
          self.refreshServerState()
          self.alert("Sara's server is uninstalled", notes.joined(separator: "\n") + "\n\nTo remove the app too, drag Sara from Applications to the Trash.")
          self.showSetup()
        }
      }
    }
  }
}
