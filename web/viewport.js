// 2.7.1: the page is always exactly the window; it never scrolls as a whole (only its own lists do).
// Runs in <head> before anything is drawn (a plain script, like theme-boot.js).
//
// Why (seen on an iPhone simulator, iOS 27, and reported by the owner on his iPhone):
// - A web app added to the home screen with the status bar style "black-translucent" gets a web
//   view that is the status bar's height SHORTER than the screen but still starts at the very top
//   (innerHeight 812 on an 874 pt screen, env(safe-area-inset-top) 62): the header sat under the
//   clock and an empty strip was left at the bottom. index.html now asks for the "default" style
//   (new home-screen icons get a full-height view below the status bar); icons added before keep
//   the old style, so the page pads its top by the safe area (--safe-t in theme.css) and, when it
//   sees that short view, drops the bottom safe area too (the home indicator is below the view):
//   html.ios-short-view.
// - iOS zooms into a text field whose font is smaller than 16 px when it gets the focus and does
//   not zoom back out, so the whole app stayed bigger and shifted after typing: on iPhone/iPad the
//   viewport gets maximum-scale=1, which iOS applies to that automatic zoom only (pinch zoom keeps
//   working there; Android, where it would block pinch zoom, is left alone).
// - The keyboard scrolls the whole document up to show the field and does not always scroll it
//   back: once nothing is being typed, the page is put back at the top (settle()).
(function () {
  var root = document.documentElement;
  var nav = window.navigator || {};
  var ua = String(nav.userAgent || '');
  var ios = /iP(hone|ad|od)/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (ios) {
    var meta = document.querySelector('meta[name="viewport"]');
    var c = meta && meta.getAttribute('content');
    if (c && !/maximum-scale/.test(c)) meta.setAttribute('content', c + ', maximum-scale=1');
  }

  var typing = function () {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(a.type || '');
  };

  // Put the document back at the top unless a text field has the focus (then the keyboard may
  // need the scroll to keep the field in view). Called by every keyboard / viewport handler.
  var settle = function () {
    if (typing()) return;
    // Never fight a pinch zoom (iOS keeps it): only an unzoomed page is put back.
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    var se = document.scrollingElement;
    if (se && se.scrollTop) se.scrollTop = 0;
    if (document.body && document.body.scrollTop) document.body.scrollTop = 0;
  };

  // The short iOS home-screen view (see above): status-bar inset at the top AND a view that much
  // shorter than the screen. Measured with a probe element, since env() can't be read directly.
  var probe = null;
  var shortView = function () {
    if (!ios) return;
    var standalone = nav.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!standalone || !document.body) return;
    if (!probe) {
      probe = document.createElement('div');
      probe.className = 'vp-probe';
      probe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(probe);
    }
    var top = probe.offsetHeight;
    var portrait = window.innerHeight >= window.innerWidth;
    var screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    var gap = screenH - window.innerHeight;
    root.classList.toggle('ios-short-view', top > 0 && Math.abs(gap - top) <= 2);
  };

  var later = function (fn, ms) {
    return function () {
      setTimeout(fn, ms);
    };
  };
  document.addEventListener('focusout', later(settle, 120));
  window.addEventListener('scroll', later(settle, 250), { passive: true });
  window.addEventListener('orientationchange', later(function () {
    settle();
    shortView();
  }, 350));
  window.addEventListener('resize', function () {
    settle();
    shortView();
  });
  window.addEventListener('pageshow', settle);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) settle();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', settle);
    window.visualViewport.addEventListener('scroll', later(settle, 250));
  }
  document.addEventListener('DOMContentLoaded', shortView);
  window.saraViewport = { settle: settle, typing: typing, ios: ios };
})();
