// Links that open Sara's phone app from a browser (QR pairing, the access QR). Shared by /pair
// (pair.js) and the sign-in page (app.js); pure functions so the tests can check them.
//
// Every owner has their own server address, so Android App Links / iOS universal links (verified
// https links) can't be used. Instead:
// - Android: an intent:// link naming the app's package. Chrome opens the app when it's installed
//   and otherwise goes to browser_fallback_url (a page here that says how to get the app).
// - iPhone: the sara:// scheme (Safari has no fallback; the page says where to get the app),
//   offered only once the app is in the App Store (IOS_APP_URL).

export const ANDROID_PACKAGE = 'com.backstagecoding.sara';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
/**
 * The iPhone app's App Store page. Empty while the app isn't in the App Store yet: iPhones then
 * get no "Open in the Sara app" button (Safari would only show "address is invalid") and sign in
 * in the browser. Put the App Store link here once Apple approves the app.
 */
export const IOS_APP_URL = '';

/**
 * 'android', 'ios' or null (desktop / unknown) for a browser's user agent. iPads ask for the
 * desktop site and say "Macintosh": a touch screen tells them apart (pass maxTouchPoints).
 * Inside Sara's own apps (phone or desktop) there's nothing to open: null.
 */
export function phoneKind(ua, maxTouchPoints = 0) {
  const s = String(ua ?? '');
  if (/\bSara(Phone|Desktop)\/\d/.test(s)) return null;
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/.test(s) || (/Macintosh/.test(s) && maxTouchPoints > 1)) return 'ios';
  return null;
}

/** True inside Sara's phone app (its web view adds SaraPhone/<n> to the user agent). */
export const inPhoneApp = (ua) => /\bSaraPhone\/\d/.test(String(ua ?? ''));

/** sara://pair?s=<server>[&c=<code>]: the iPhone app's link (and what Android's intent carries). */
export function saraLink(origin, code) {
  return `sara://pair?s=${encodeURIComponent(origin)}${code ? `&c=${encodeURIComponent(code)}` : ''}`;
}

/** The page Chrome opens when the app isn't installed: /pair?noapp=1, with the code after the #. */
export function fallbackUrl(origin, code) {
  return `${origin}/pair?noapp=1${code ? `#${encodeURIComponent(code)}` : ''}`;
}

/** Android: opens the app if it's installed, else the fallback page (not a Play Store detour). */
export function intentLink(origin, code) {
  const q = saraLink(origin, code).slice('sara://'.length);
  return `intent://${q}#Intent;scheme=sara;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallbackUrl(origin, code))};end`;
}

/** True when this kind of phone has a Sara app to open (iPhone: only once IOS_APP_URL is set). */
export const hasApp = (kind, iosUrl = IOS_APP_URL) => kind === 'android' || (kind === 'ios' && Boolean(iosUrl));

/** The "Open in the Sara app" link for this kind of phone, or null on other devices. */
export function appLink(kind, origin, code, iosUrl = IOS_APP_URL) {
  if (!hasApp(kind, iosUrl)) return null;
  return kind === 'android' ? intentLink(origin, code) : saraLink(origin, code);
}
