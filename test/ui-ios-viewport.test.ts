// 2.7.1: the iPhone "everything shifted up" fix (web/viewport.js explains the cause). The app page
// can't scroll as a whole, the safe areas come from one place, iOS can't zoom into a small text
// field, and every keyboard / visual-viewport handler puts the page back at the top.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ROOT } from './helpers.ts';

const web = (f: string) => readFileSync(join(ROOT, 'web', f), 'utf8');
const html = web('index.html');
const head = html.slice(0, html.indexOf('</head>'));
const css = (f: string) => web(f).replace(/\/\*[\s\S]*?\*\//g, '');

test('index.html: the app page, a head script before the stylesheets, the iPhone status bar below the page', () => {
  assert.match(html, /<html lang="en" class="app-doc">/);
  const vp = head.indexOf('<script src="/viewport.js"></script>');
  assert.ok(vp > 0 && vp < head.indexOf('<link rel="stylesheet"'), 'a plain script, before every stylesheet');
  assert.ok(head.indexOf('<script src="/theme-boot.js"></script>') < vp);
  // "black-translucent" gave home-screen icons a view that is short by the status bar but starts at the top.
  assert.match(head, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/);
  assert.doesNotMatch(head, /black-translucent/);
  assert.match(head, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">/, 'Android keeps resizing for the keyboard');
  assert.doesNotMatch(head, /maximum-scale|user-scalable/, 'no zoom lock in the HTML (Android would lose pinch zoom)');
});

test('html and body can never scroll; card screens scroll inside', () => {
  const style = css('style.css');
  assert.match(style, /html, body \{ height: 100%; margin: 0; \}/);
  assert.match(style, /html\.app-doc, html\.app-doc body \{ overflow: hidden; overscroll-behavior: none; \}/);
  assert.match(style, /html\.app-doc \.card-screen \{ height: 100%; overflow-y: auto; overscroll-behavior: contain; \}/);
  assert.match(style, /html\.app-doc \.card-screen > \* \{ margin: auto; \}/, 'a tall card starts at its top, never cut off above');
  // No rule anywhere lets the app document scroll again or sizes the page from the old viewport units.
  for (const f of ['style.css', 'ui-tidy.css', 'look.css', 'her-panel.css', 'today.css', 'screens.css', 'theme.css']) {
    const c = css(f);
    assert.doesNotMatch(c, /(^|[\s,}])(html|body)(\.[\w-]+)*\s*\{[^}]*overflow(-y)?:\s*(auto|scroll|visible)/m, `${f}: html/body stay unscrollable`);
    assert.doesNotMatch(c, /(^|[\s,}])(html|body)(\.[\w-]+)*\s*\{[^}]*height:\s*100(vh|dvh|lvh|svh)/m, `${f}: html/body are 100% of the window`);
    assert.doesNotMatch(c, /-webkit-fill-available/, f);
  }
});

test('safe areas from one place: the top inset pads the page, dialogs and slide-overs; the bottom one the bars', () => {
  const theme = css('theme.css');
  assert.match(theme, /:root \{\s*--safe-t: env\(safe-area-inset-top, 0px\);\s*--safe-b: env\(safe-area-inset-bottom, 0px\);\s*\}/);
  assert.match(theme, /html\.shell \{ --safe-t: 0px; \}/, 'the Windows/Mac apps use their title bar strip');
  assert.match(theme, /html\.ios-short-view \{ --safe-b: 0px; \}/);
  // Every app stylesheet uses the variables (only the probe measures env() directly).
  for (const f of ['style.css', 'ui-tidy.css', 'look.css', 'her-panel.css', 'today.css', 'screens.css']) {
    const c = css(f).replace(/\.vp-probe \{[^}]*\}/, '');
    assert.doesNotMatch(c, /env\(safe-area-inset-(top|bottom)/, `${f}: through --safe-t / --safe-b`);
  }
  assert.match(css('style.css'), /\.vp-probe \{[^}]*padding: env\(safe-area-inset-top, 0px\) 0 0;[^}]*visibility: hidden;/);
  const look = css('look.css');
  assert.match(look, /#main \{ padding-top: var\(--safe-t\); \}/);
  assert.match(look, /@media \(max-width: 760px\) \{\s*#sidebar, \.preview-pane \{ padding-top: var\(--safe-t\); \}/);
  assert.match(look, /\.her-panel\.mode-overlay \{ padding-top: var\(--safe-t\); \}/);
  assert.match(look, /dialog:modal:not\(\.ring, \.lightbox, \.cmdbar\) \{ margin-top: var\(--safe-t\); \}/);
  assert.match(look, /dialog\.settings-dialog:modal \{ height: calc\(100dvh - var\(--safe-t\)\); max-height: calc\(100dvh - var\(--safe-t\)\); \}/);
  assert.match(css('today.css'), /max-height: calc\(100dvh - var\(--bbar-h\) - 16px - var\(--safe-t\)\);/);
  assert.match(css('today.css'), /--bbar-h: calc\(60px \+ var\(--safe-b\)\);/);
  assert.match(css('her-panel.css'), /dialog#cmdbar \{[^}]*margin-top: max\(8px, var\(--safe-t\)\);/);
  // The message box is never below 16 px on touch screens (iOS zooms into smaller fields).
  assert.match(look, /@media \(pointer: coarse\) \{\s*#input \{ font-size: max\(16px, var\(--chat-size, 15px\)\); \}/);
});

test('every keyboard / visual-viewport handler resets the page scroll', () => {
  for (const f of readdirSync(join(ROOT, 'web')).filter((x) => x.endsWith('.js') && x !== 'sw.js')) {
    const src = web(f);
    if (!/visualViewport|['"]focusout['"]|orientationchange/.test(src)) continue;
    if (f === 'viewport.js') continue;
    assert.match(src, /saraViewport\?\.settle\(\)/, `${f} handles the keyboard: it must put the page back (window.saraViewport.settle)`);
  }
  const vp = web('viewport.js');
  for (const ev of ["addEventListener('focusout'", "addEventListener('scroll'", "addEventListener('orientationchange'", "addEventListener('resize'", "addEventListener('pageshow', settle)", "visualViewport.addEventListener('resize', settle)", "visualViewport.addEventListener('scroll'"]) assert.ok(vp.includes(ev), ev);
  assert.match(web('bottom-bar.js'), /root\.classList\.toggle\('kb-up'[^\n]*\n[^\n]*\n {4}window\.saraViewport\?\.settle\(\);/);
});

/** Runs web/viewport.js against a small fake page. */
function runViewport(o: { ua: string; standalone?: boolean; innerHeight?: number; screenH?: number; insetTop?: number; platform?: string; touch?: number }) {
  const listeners: Record<string, (() => void)[]> = {};
  const vvListeners: Record<string, (() => void)[]> = {};
  const timers: (() => void)[] = [];
  const classes = new Set<string>();
  const meta = { content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content', getAttribute: () => meta.content, setAttribute: (_: string, v: string) => (meta.content = v) };
  const scrolled: number[][] = [];
  const doc = {
    activeElement: null as null | { tagName: string; type?: string; isContentEditable?: boolean },
    body: { scrollTop: 0, appendChild: () => {} },
    scrollingElement: { scrollTop: 0 },
    hidden: false,
    documentElement: { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), add: (c: string) => classes.add(c) } },
    querySelector: (s: string) => (s === 'meta[name="viewport"]' ? meta : null),
    createElement: () => ({ setAttribute: () => {}, className: '', offsetHeight: o.insetTop ?? 0 }),
    addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
  };
  const win = {
    navigator: { userAgent: o.ua, platform: o.platform ?? '', maxTouchPoints: o.touch ?? 5, standalone: o.standalone ?? false },
    innerWidth: 402,
    innerHeight: o.innerHeight ?? 874,
    screen: { width: 402, height: o.screenH ?? 874 },
    scrollX: 0,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    visualViewport: { scale: 1, addEventListener: (t: string, f: () => void) => (vvListeners[t] ??= []).push(f) },
    scrollTo: (x: number, y: number) => {
      scrolled.push([x, y]);
      win.scrollX = x;
      win.scrollY = y;
    },
    addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
    setTimeout: (f: () => void) => timers.push(f),
  } as Record<string, unknown> & { scrollX: number; scrollY: number; visualViewport: { scale: number } };
  const ctx = { window: win, document: doc, navigator: win.navigator, screen: win.screen, matchMedia: win.matchMedia, setTimeout: win.setTimeout };
  win.window = win;
  runInNewContext(web('viewport.js'), ctx);
  const fire = (t: string) => {
    for (const f of listeners[t] ?? []) f();
    while (timers.length) timers.shift()!();
  };
  const fireVv = (t: string) => {
    for (const f of vvListeners[t] ?? []) f();
    while (timers.length) timers.shift()!();
  };
  return { win, doc, meta, classes, scrolled, fire, fireVv };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

test('viewport.js: iPhone/iPad stop the focus zoom; Android and desktops keep the viewport as it is', () => {
  assert.match(runViewport({ ua: IPHONE }).meta.content, /, maximum-scale=1$/);
  assert.match(runViewport({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', touch: 5 }).meta.content, /maximum-scale=1/, 'iPadOS says Mac');
  assert.doesNotMatch(runViewport({ ua: ANDROID }).meta.content, /maximum-scale/);
  assert.doesNotMatch(runViewport({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', touch: 0 }).meta.content, /maximum-scale/, 'a real Mac');
});

test('viewport.js: after the keyboard (focus out, viewport resize, scroll) the page goes back to the top, not while typing', () => {
  const p = runViewport({ ua: IPHONE });
  p.win.scrollY = 330;
  p.doc.activeElement = { tagName: 'TEXTAREA' };
  p.fire('focusout');
  p.fireVv('resize');
  assert.deepEqual(p.scrolled, [], 'typing: the keyboard may need the scroll');
  p.doc.activeElement = { tagName: 'BUTTON' };
  p.fire('focusout');
  assert.deepEqual(p.scrolled, [[0, 0]]);
  p.win.scrollY = 120;
  p.fireVv('resize');
  assert.deepEqual(p.scrolled.at(-1), [0, 0]);
  p.win.scrollY = 50;
  p.fire('scroll');
  assert.equal(p.win.scrollY, 0);
  p.win.scrollY = 40;
  p.fire('orientationchange');
  assert.equal(p.win.scrollY, 0);
  // A checkbox or a range has the focus: not typing.
  p.doc.activeElement = { tagName: 'INPUT', type: 'checkbox' };
  p.win.scrollY = 10;
  p.fireVv('resize');
  assert.equal(p.win.scrollY, 0);
  // Pinch zoom (iOS keeps it): never fought.
  p.win.visualViewport.scale = 2;
  p.win.scrollY = 77;
  p.fireVv('scroll');
  assert.equal(p.win.scrollY, 77);
  // The same on Android (the page never scrolls there anyway).
  const a = runViewport({ ua: ANDROID });
  a.win.scrollY = 30;
  a.fire('focusout');
  assert.equal(a.win.scrollY, 0);
});

test('viewport.js: the short iPhone home-screen view (status bar inset at the top AND that much shorter) drops the bottom inset', () => {
  // The owner's case: an icon added with black-translucent on iOS 26/27: 812 of 874 pt, inset 62.
  const short = runViewport({ ua: IPHONE, standalone: true, innerHeight: 812, screenH: 874, insetTop: 62 });
  short.fire('DOMContentLoaded');
  assert.ok(short.classes.has('ios-short-view'));
  // A full-height view under the status bar (older iOS): keeps the bottom inset.
  const full = runViewport({ ua: IPHONE, standalone: true, innerHeight: 874, screenH: 874, insetTop: 62 });
  full.fire('DOMContentLoaded');
  assert.equal(full.classes.has('ios-short-view'), false);
  // A new icon ("default" status bar): below the status bar, no inset.
  const fresh = runViewport({ ua: IPHONE, standalone: true, innerHeight: 812, screenH: 874, insetTop: 0 });
  fresh.fire('DOMContentLoaded');
  assert.equal(fresh.classes.has('ios-short-view'), false);
  // Safari tabs and other systems are never touched.
  const tab = runViewport({ ua: IPHONE, standalone: false, innerHeight: 714, screenH: 874, insetTop: 0 });
  tab.fire('DOMContentLoaded');
  assert.equal(tab.classes.has('ios-short-view'), false);
  const android = runViewport({ ua: ANDROID, standalone: true, innerHeight: 812, screenH: 874, insetTop: 62 });
  android.fire('DOMContentLoaded');
  assert.equal(android.classes.has('ios-short-view'), false);
});

test('the service worker cache was bumped for 2.7.1', () => {
  assert.ok(Number(/sara-shell-v(\d+)/.exec(web('sw.js'))?.[1]) >= 7);
});
