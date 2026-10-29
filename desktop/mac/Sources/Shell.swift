// Phase 75 (the new look): the window around the page.
// - The page is drawn under a transparent, full-size title bar; the traffic lights sit centred in
//   the page's header strip (macTitlebar points tall, inset from the corner).
// - window.saraShell = { platform: 'mac', titlebar, controls, theme, backdrop, backdrops, version }
//   and <html class="shell-mac"> are set before any page script runs (shellScript()).
// - The page says it draws its header in that strip with {type:'shell', titlebar:true}. Until then
//   (an older Sara server, or a page still loading) the app keeps a plain title strip of its own and
//   the page starts below it, so nothing hides under the traffic lights.
// - The theme follows the page ({type:'theme', theme:'night'|'day'|'system'}): window appearance
//   (darkAqua / aqua), the window and web view background (no white flash on start, navigation or
//   resize), the setup sheet. Remembered, so the next start opens in the right colours.
// - {type:'backdrop', backdrop:'vibrancy'} puts an NSVisualEffectView behind a see-through page;
//   'solid' (the default) is the theme colour.
// - WebKit has no CSS app-region: a press on the strip that isn't on a control asks the app to move
//   the window (performDrag), a double press zooms or minimizes as set in System Settings.
import AppKit
import WebKit

let nightColor = NSColor(srgbRed: 0x0f / 255, green: 0x0d / 255, blue: 0x17 / 255, alpha: 1)
let dayColor = NSColor(srgbRed: 0xfa / 255, green: 0xf7 / 255, blue: 0xf5 / 255, alpha: 1)
/// The page's header strip on the Mac (points = CSS px at 100% zoom); the traffic lights sit in it.
let macTitlebar: CGFloat = 38
/// Where the first traffic light starts, from the window's left edge.
let trafficLightInset: CGFloat = 16

enum Shell {
  /// night | day | system, as the page last said (night until it says anything).
  static var themePref: String {
    let v = prefs.string(forKey: "theme") ?? "night"
    return v == "day" || v == "system" ? v : "night"
  }
  static var systemIsLight: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua
  }
  static var isDay: Bool {
    if themePref == "day" { return true }
    if themePref == "system" { return systemIsLight }
    return false
  }
  static var color: NSColor { isDay ? dayColor : nightColor }
  /// nil follows the system ("Follow the system" in the page).
  static var appearance: NSAppearance? {
    themePref == "system" ? nil : NSAppearance(named: isDay ? .aqua : .darkAqua)
  }
  static var vibrancy: Bool { prefs.string(forKey: "backdrop") == "vibrancy" }

  /// Put into the app's own pages' <head>: the theme class, and "this page draws the title strip".
  static var localPageScript: String {
    "<script>document.documentElement.classList.add('\(isDay ? "day" : "night")');"
      + "if(window.saraShell)window.saraShell.drawsTitlebar=true;"
      + "try{webkit.messageHandlers.sara.postMessage({type:'shell',titlebar:true}).catch(()=>{})}catch(e){}</script>"
  }
}

extension AppDelegate {
  // MARK: the window

  /// Called once the window exists, before the web view is made.
  func setUpWindowChrome() {
    let root = NSView(frame: window.contentLayoutRect)
    root.autoresizingMask = [.width, .height]
    root.wantsLayer = true
    window.contentView = root
    chromeRoot = root
    window.titleVisibility = .visible
    applyTheme()
    // "Follow the system": the backgrounds follow macOS switching light / dark.
    DistributedNotificationCenter.default().addObserver(forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil, queue: .main) { [weak self] _ in
      if Shell.themePref == "system" { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self?.applyTheme() } }
    }
    mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] e in
      if e.window === self?.window { self?.lastMouseDown = e }
      return e
    }
  }

  /// makeWebView's new web view goes into the window (the old one out).
  func attachWebView(old: WKWebView?) {
    old?.removeFromSuperview()
    guard let root = chromeRoot else { window?.contentView = web; return }
    web.autoresizingMask = [.width, .height]
    root.addSubview(web)
    if #available(macOS 12.0, *) { web.underPageBackgroundColor = Shell.vibrancy ? .clear : Shell.color }
    layoutWebView()
  }

  /// The page fills the window, under the title bar when it draws the strip itself.
  func layoutWebView() {
    guard let root = chromeRoot, let web else { return }
    let full = window.styleMask.contains(.fullScreen)
    let inset: CGFloat = pageDrawsTitlebar || full ? 0 : macTitlebar
    let b = root.bounds
    web.frame = NSRect(x: 0, y: 0, width: b.width, height: max(0, b.height - inset))
    vibrancyView?.frame = b
    window.titleVisibility = pageDrawsTitlebar ? .hidden : .visible
    placeTrafficLights()
  }

  /// The traffic lights centred in the page's header strip, inset from the corner. AppKit puts
  /// them back on some layouts, so this runs again after resizes and full screen.
  func placeTrafficLights() {
    guard let window, !window.styleMask.contains(.fullScreen),
          let close = window.standardWindowButton(.closeButton),
          let titlebar = close.superview, let container = titlebar.superview else { return }
    var f = container.frame
    f.size.height = macTitlebar
    f.origin.y = window.frame.height - macTitlebar
    container.frame = f
    let mini = window.standardWindowButton(.miniaturizeButton)
    let spacing = mini.map { $0.frame.minX - close.frame.minX } ?? 20
    for (i, kind) in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].enumerated() {
      guard let b = window.standardWindowButton(kind) else { continue }
      b.setFrameOrigin(NSPoint(x: trafficLightInset + CGFloat(i) * (spacing > 0 ? spacing : 20), y: ((macTitlebar - b.frame.height) / 2).rounded()))
    }
  }

  /// Night or Day (or the system's): the appearance, every background, the setup sheet.
  func applyTheme() {
    guard let window else { return }
    window.appearance = Shell.appearance
    let color = Shell.color
    if Shell.vibrancy {
      if vibrancyView == nil, let root = chromeRoot {
        let v = NSVisualEffectView(frame: root.bounds)
        v.autoresizingMask = [.width, .height]
        v.material = .underWindowBackground
        v.blendingMode = .behindWindow
        v.state = .followsWindowActiveState
        root.addSubview(v, positioned: .below, relativeTo: nil)
        vibrancyView = v
      }
      window.isOpaque = false
      window.backgroundColor = .clear
    } else {
      vibrancyView?.removeFromSuperview()
      vibrancyView = nil
      window.isOpaque = true
      window.backgroundColor = color
    }
    chromeRoot?.layer?.backgroundColor = Shell.vibrancy ? NSColor.clear.cgColor : color.cgColor
    if let web, #available(macOS 12.0, *) { web.underPageBackgroundColor = Shell.vibrancy ? .clear : color }
    if let sheet = setupSheet?.window {
      sheet.appearance = Shell.appearance
      sheet.backgroundColor = color
    }
  }

  // MARK: the page's messages

  /// "https://host:port" for server pages, "local" for the app's own pages.
  func pageOrigin(_ frame: WKFrameInfo) -> String {
    let o = frame.securityOrigin
    if o.protocol != "http" && o.protocol != "https" { return "local" }
    return originOf("\(o.protocol)://\(o.host)" + (o.port > 0 ? ":\(o.port)" : "")) ?? "local"
  }

  /// A new page loads: if it comes from another place, it says again whether it draws the strip.
  func pageWillLoad(_ url: URL?) {
    let origin: String
    if let url, url.scheme == "http" || url.scheme == "https" { origin = originOf(url.absoluteString) ?? "" } else { origin = "local" }
    if pageDrawsTitlebar && origin != pageTitleOrigin { setPageDrawsTitlebar(false, origin: "") }
  }

  func setPageDrawsTitlebar(_ on: Bool, origin: String) {
    pageTitleOrigin = on ? origin : ""
    guard on != pageDrawsTitlebar else { return }
    pageDrawsTitlebar = on
    layoutWebView()
    if on { web?.evaluateJavaScript("if(window.saraShell)window.saraShell.drawsTitlebar=true") }
  }

  func handleShellMessage(_ kind: String, _ body: [String: Any], origin: String) {
    switch kind {
    case "shell":
      setPageDrawsTitlebar((body["titlebar"] as? Bool) ?? false, origin: origin)
    case "theme":
      var t = (body["theme"] as? String ?? "").lowercased()
      if t == "dark" { t = "night" }  // the page's own words (localStorage sara.theme)
      if t == "light" { t = "day" }
      guard ["night", "day", "system"].contains(t) else { return }
      if let b = body["backdrop"] as? String, ["solid", "vibrancy"].contains(b) { prefs.set(b, forKey: "backdrop") }
      prefs.set(t, forKey: "theme")
      applyTheme()
    case "backdrop":
      guard let b = body["backdrop"] as? String, ["solid", "vibrancy"].contains(b) else { return }
      prefs.set(b, forKey: "backdrop")
      applyTheme()
    case "dragWindow":
      // The press that started it, while the button is still down.
      guard pageDrawsTitlebar, let e = lastMouseDown, NSEvent.pressedMouseButtons & 1 == 1,
            ProcessInfo.processInfo.systemUptime - e.timestamp < 2 else { return }
      window.performDrag(with: e)
    case "zoomWindow":
      guard pageDrawsTitlebar else { return }
      switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
      case "Minimize": window.performMiniaturize(nil)
      case "None": break
      default: window.performZoom(nil)
      }
    default: break
    }
  }

  // MARK: window delegate: keep the traffic lights where the page expects them

  func windowDidResize(_ notification: Notification) { layoutWebView() }
  func windowDidEndLiveResize(_ notification: Notification) { placeTrafficLights() }
  func windowDidExitFullScreen(_ notification: Notification) { layoutWebView() }
  func windowDidEnterFullScreen(_ notification: Notification) { layoutWebView() }

  /// The page's view of the window, before any page script runs (see the top of this file).
  func shellScript() -> String {
    let backdrop = Shell.vibrancy ? "vibrancy" : "solid"
    // The three traffic lights and the space after them, so the page keeps that part of its strip free.
    let controls = Int(trafficLightInset + 3 * 20 + 14)
    return """
    (() => {
      if (window.top !== window) return;
      window.saraShell = { platform: 'mac', titlebar: \(Int(macTitlebar)), controls: { side: 'left', width: \(controls) }, theme: '\(Shell.themePref)', backdrop: '\(backdrop)', backdrops: ['solid', 'vibrancy'], version: '\(appVersion)' };
      const mark = () => {
        const d = document.documentElement;
        if (!d) return false;
        d.classList.add('shell-mac');
        d.style.setProperty('--shell-titlebar', window.saraShell.titlebar + 'px');
        d.style.setProperty('--shell-controls-left', window.saraShell.controls.width + 'px');
        return true;
      };
      if (!mark()) new MutationObserver((_, o) => { if (mark()) o.disconnect(); }).observe(document, { childList: true });
      // WebKit has no CSS app-region: a press on the strip that isn't on a control moves the window,
      // a double press zooms it (once the page said it draws the strip).
      const controls = 'a,button,input,select,textarea,label,summary,option,video,audio,[role=button],[role=link],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[contenteditable=""],[contenteditable=true],[data-no-drag],.no-drag';
      addEventListener('mousedown', (e) => {
        const s = window.saraShell;
        if (e.button !== 0 || !s || !s.drawsTitlebar || e.clientY >= s.titlebar) return;
        if (e.target instanceof Element && e.target.closest(controls)) return;
        e.preventDefault();
        try { webkit.messageHandlers.sara.postMessage({ type: e.detail === 2 ? 'zoomWindow' : 'dragWindow' }).catch(() => {}); } catch (err) {}
      }, true);
    })();
    """
  }

  #if DEBUG
  // MARK: test builds only (swiftc -D DEBUG): screenshots of this window, synthetic clicks, quit

  /// testShot {path}: this app's own window as a PNG (no screen-recording permission needed for
  /// your own windows). testClick {x, y} from the window's top-left. testQuit.
  func testShellHook(_ kind: String, _ body: [String: Any]) {
    switch kind {
    case "testShot":
      // Screen capture needs a permission an SSH session can't give, so this composes the window
      // from its own views: the window (background, title), the web view's snapshot, then the title
      // bar (traffic lights) on top, as on screen.
      guard let path = body["path"] as? String, let frameView = window.contentView?.superview, let web else { return }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
        guard let self else { return }
        let bounds = frameView.bounds
        guard let base = frameView.bitmapImageRepForCachingDisplay(in: bounds) else { return }
        frameView.cacheDisplay(in: bounds, to: base)
        web.takeSnapshot(with: nil) { img, err in
          let out = NSImage(size: bounds.size)
          out.lockFocus()
          self.window.backgroundColor.setFill()
          bounds.fill()
          base.draw(in: bounds)
          img?.draw(in: web.convert(web.bounds, to: frameView))
          // The base's title bar area comes out black: draw the strip's colour, then the buttons.
          if !self.pageDrawsTitlebar {
            Shell.color.setFill()
            NSRect(x: 0, y: bounds.height - macTitlebar, width: bounds.width, height: macTitlebar).fill()
            let title = NSAttributedString(string: self.window.title, attributes: [.font: NSFont.titleBarFont(ofSize: 13), .foregroundColor: Shell.isDay ? NSColor(white: 0, alpha: 0.85) : NSColor(white: 1, alpha: 0.85)])
            title.draw(at: NSPoint(x: (bounds.width - title.size().width) / 2, y: bounds.height - macTitlebar / 2 - title.size().height / 2))
          }
          for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let b = self.window.standardWindowButton(kind), let r = b.bitmapImageRepForCachingDisplay(in: b.bounds) else { continue }
            b.cacheDisplay(in: b.bounds, to: r)
            r.draw(in: b.convert(b.bounds, to: frameView), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
          }
          out.unlockFocus()
          if let tiff = out.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
            try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
          }
          testLog("shot \(path) \(Int(bounds.width))x\(Int(bounds.height)) web=\(img.map { "\($0.size)" } ?? "nil") webFrame=\(web.frame) root=\(self.chromeRoot?.bounds ?? .zero) pageTitle=\(self.pageDrawsTitlebar) \(err.map { "\($0)" } ?? "")")
        }
      }
    case "testClick":
      let x = body["x"] as? Double ?? 0, y = body["y"] as? Double ?? 0
      let p = NSPoint(x: x, y: window.frame.height - y)
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        if let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) {
          window.sendEvent(e)
        }
      }
      testLog("click \(x),\(y) hit \(window.contentView?.superview?.hitTest(p).map { String(describing: type(of: $0)) } ?? "nil") titlebar=\(window.standardWindowButton(.closeButton)?.superview?.superview?.frame ?? .zero) close=\(window.standardWindowButton(.closeButton)?.frame ?? .zero)")
    case "testQuit":
      quitting = true
      NSApp.terminate(nil)
    default: break
    }
  }
  #endif
}
