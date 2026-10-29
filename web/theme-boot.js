// Phase 75: runs in <head> before anything is drawn, so the page never flashes the wrong theme.
// Night is the default; Day only when it was picked on this device (or "Follow the system" and
// the system is light). Also the page side of the native-app contract (docs/design/NEW_LOOK.md →
// Native apps): the Windows/Mac apps add class shell-windows / shell-mac to <html> and set
// window.saraShell = { platform, titlebar } before the page runs; then the page leaves a drag
// strip of that height at the top. ?shell=windows&titlebar=32 (or mac) tries it in a browser.
(function () {
  // Messages to the Windows app (WebView2) or the Mac app (WKWebView), when the page runs in one.
  window.saraShellSay = function (msg) {
    try {
      if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(msg);
      else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sara) {
        var p = window.webkit.messageHandlers.sara.postMessage(msg);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {
      /* not in an app */
    }
  };
  var root = document.documentElement;
  var pick = null;
  var get = function (k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  pick = get('sara.theme');
  // Not picked on this device yet: the Windows/Mac app's own choice (its first paint used it).
  var appPick = window.saraShell && String(window.saraShell.theme || '');
  if (!pick && appPick) pick = appPick === 'day' || appPick === 'light' ? 'light' : appPick === 'system' ? 'system' : 'dark';
  if (pick !== 'light' && pick !== 'system') pick = 'dark';
  var light = pick === 'light' || (pick === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  root.classList.add(light ? 'theme-day' : 'theme-night');
  // The other per-device looks, so they don't change after the first paint either.
  var looks = { accent: 'rose', chatbg: 'none', density: 'comfy' };
  for (var k in looks) root.setAttribute('data-' + k, get('sara.' + k) || looks[k]);

  var shell = window.saraShell;
  var q = /[?&]shell=(windows|mac)\b/.exec(location.search);
  if (!shell && q) {
    var tb = /[?&]titlebar=(\d{1,3})\b/.exec(location.search);
    shell = window.saraShell = { platform: q[1], titlebar: tb ? Number(tb[1]) : 32, test: true };
  }
  var marked = root.classList.contains('shell-windows') || root.classList.contains('shell-mac');
  if (shell || marked) {
    var plat = (shell && shell.platform) || (root.classList.contains('shell-mac') ? 'mac' : 'windows');
    plat = plat === 'mac' || plat === 'darwin' ? 'mac' : 'windows';
    var h = Math.round(Number(shell && shell.titlebar));
    if (!(h >= 0 && h <= 96)) h = plat === 'mac' ? 28 : 32;
    root.classList.add('shell', 'shell-' + plat);
    if (shell && shell.test) root.classList.add('shell-test');
    root.style.setProperty('--titlebar', h + 'px');
    // Tell the app the page draws its header in the strip (until then it keeps its own title strip).
    if (h > 0 && !(shell && shell.test)) {
      window.saraShellSay && window.saraShellSay({ type: 'shell', titlebar: true });
    }
  }
})();
