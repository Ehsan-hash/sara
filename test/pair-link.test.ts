// QR pairing straight into the phone app: the links /pair and the sign-in page offer, the Android
// fallback page, and which phones get which link.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
// @ts-expect-error plain JS module shared with the browser
import { ANDROID_PACKAGE, IOS_APP_URL, PLAY_URL, appLink, fallbackUrl, hasApp, inPhoneApp, intentLink, phoneKind, saraLink } from '../web/pair-link.js';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

test('pair link: which phone gets which link (and none inside Sara\'s own apps or on computers)', () => {
  assert.equal(phoneKind(ANDROID_CHROME), 'android');
  assert.equal(phoneKind(IPHONE), 'ios');
  assert.equal(phoneKind(IPAD_DESKTOP, 5), 'ios', 'an iPad asking for the desktop site');
  assert.equal(phoneKind(IPAD_DESKTOP, 0), null, 'a real Mac');
  assert.equal(phoneKind(WINDOWS), null);
  assert.equal(phoneKind(`${ANDROID_CHROME} SaraPhone/1`), null, 'already in the Android app');
  assert.equal(phoneKind(`${IPHONE} SaraPhone/1`), null, 'already in the iPhone app');
  assert.equal(phoneKind(`${WINDOWS} SaraDesktop/1 (Windows)`), null);
  assert.equal(phoneKind(undefined), null);
  assert.equal(inPhoneApp(`${ANDROID_CHROME} SaraPhone/1`), true);
  assert.equal(inPhoneApp(ANDROID_CHROME), false);
});

test('pair link: sara:// and intent:// links escape the address and code; the fallback is our page', () => {
  const origin = 'https://sara.example.com:8443';
  const code = 'K7QM-2XPA-9TRB';
  assert.equal(saraLink(origin, code), 'sara://pair?s=https%3A%2F%2Fsara.example.com%3A8443&c=K7QM-2XPA-9TRB');
  assert.equal(saraLink(origin), 'sara://pair?s=https%3A%2F%2Fsara.example.com%3A8443', 'no code: just the server');
  assert.equal(fallbackUrl(origin, code), 'https://sara.example.com:8443/pair?noapp=1#K7QM-2XPA-9TRB');
  assert.equal(fallbackUrl(origin), 'https://sara.example.com:8443/pair?noapp=1');
  const intent: string = intentLink(origin, code);
  assert.equal(
    intent,
    'intent://pair?s=https%3A%2F%2Fsara.example.com%3A8443&c=K7QM-2XPA-9TRB#Intent;scheme=sara;package=com.backstagecoding.sara;' +
      'S.browser_fallback_url=https%3A%2F%2Fsara.example.com%3A8443%2Fpair%3Fnoapp%3D1%23K7QM-2XPA-9TRB;end',
  );
  // The fallback decodes back to the page, and nothing in it can end the intent early.
  const fb = /S\.browser_fallback_url=([^;]*);end$/.exec(intent)![1];
  assert.doesNotMatch(fb, /[;#&=]/);
  assert.equal(decodeURIComponent(fb), fallbackUrl(origin, code));
  // A hostile "code" can't add intent extras or a second query value.
  const evil: string = intentLink('http://10.0.2.2:7883', 'A;S.x=1;end#&s=evil');
  assert.equal(evil.match(/;end/g)!.length, 1);
  assert.equal(new URL(evil.replace(/^intent:/, 'http:').replace(/#Intent;.*$/, '')).searchParams.get('c'), 'A;S.x=1;end#&s=evil');
  assert.equal(new URL(evil.replace(/^intent:/, 'http:').replace(/#Intent;.*$/, '')).searchParams.get('s'), 'http://10.0.2.2:7883');
  assert.match(intent, new RegExp(`;package=${ANDROID_PACKAGE.replace(/\./g, '\\.')};`));
  assert.equal(appLink('android', origin, code), intent);
  // iPhone: no app button until the app is in the App Store (one constant switches it on).
  assert.equal(appLink('ios', origin, code), IOS_APP_URL ? saraLink(origin, code) : null);
  assert.equal(appLink('ios', origin, code, 'https://apps.apple.com/app/id1'), saraLink(origin, code));
  assert.equal(hasApp('ios', ''), false);
  assert.equal(hasApp('android', ''), true);
  assert.equal(appLink(null, origin, code), null);
  assert.equal(PLAY_URL, 'https://play.google.com/store/apps/details?id=com.backstagecoding.sara');
});

const { dir, cleanup } = tempDir();
const app = makeApp(dir, { now: new Date('2026-10-27T12:00:00Z') });
const auth = new OwnerAuth(dir);
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});

test('pair link: the fallback page (/pair?noapp=1) and the helper module are served without signing in', async () => {
  const page = await fetch(`${base}/pair?noapp=1`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="pair-store"/);
  assert.match(html, /id="pair-app"/);
  assert.match(html, /src="\/pair\.js"/);
  const js = await fetch(`${base}/pair-link.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  // /pair uses the module, puts the app first on phones and keeps the browser sign-in as plan B.
  const pairJs = readFileSync(join(ROOT, 'web', 'pair.js'), 'utf8');
  assert.match(pairJs, /from '\.\/pair-link\.js'/);
  assert.match(pairJs, /noapp/);
  assert.match(pairJs, /Sign in this browser instead/);
  // The sign-in page offers the app for the access QR (server address only, no code).
  const index = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert.match(index, /id="login-app"/);
  assert.match(index, /Scan with your phone's camera, then tap Open in the Sara app\./);
  assert.match(readFileSync(join(ROOT, 'web', 'app.js'), 'utf8'), /appLink\(kind, location\.origin\)/);
});

test('pair link: both phone apps accept a link without a code', () => {
  const java = readFileSync(join(ROOT, 'android/app/src/main/java/com/backstagecoding/sara/MainActivity.java'), 'utf8');
  assert.doesNotMatch(java, /code == null \|\|/, 'Android must not refuse a link without c');
  const swift = readFileSync(join(ROOT, 'ios/Sara/AppModel.swift'), 'utf8');
  assert.match(swift, /let code: String\?/);
});

test('pair link: both phone apps clean the address and refuse look-alikes before asking', () => {
  const net = readFileSync(join(ROOT, 'android/app/src/main/java/com/backstagecoding/sara/Net.java'), 'utf8');
  const java = readFileSync(join(ROOT, 'android/app/src/main/java/com/backstagecoding/sara/MainActivity.java'), 'utf8');
  const swift = readFileSync(join(ROOT, 'ios/Sara/AppModel.swift'), 'utf8');
  const ui = readFileSync(join(ROOT, 'ios/Sara/SaraApp.swift'), 'utf8');
  for (const src of [net, swift]) {
    assert.match(src, /pairOrigin/);
    assert.match(src, /UserInfo|user == nil/, 'a user name before the host is refused');
    assert.match(src, /[Qq]uery/, 'queries are refused');
    assert.match(src, /isPrivateHost/, 'plain http outside a private network gets a warning');
  }
  assert.match(java, /Net\.pairOrigin\(server\)/);
  assert.match(java, /"Switch server"/);
  assert.match(ui, /Button\("Switch server", role: \.destructive\)/);
  assert.match(ui, /Button\("Cancel", role: \.cancel\)/);
  // iPhone: the old sign-in stays until the new server answered as Sara.
  assert.match(swift, /await Self\.reachable\(link\.server\)/);
});
