// 2.7.1 (owner decision): Sara opens on Today. The last conversation is still opened underneath,
// so Chat (the phone's bottom bar, Today's back button, the conversation list) is one tap away.
// A link that says where to go always wins: a conversation (/#c=<id>: notifications, the phone
// and desktop apps' "open conversation"), a place (/#view=…), a tour (/#tour=…), a sign-in coming
// back (/#google=…) or any other hash; so do answering her call, the guided setup that was asked
// for, and the public demo (visitors come to talk to her, so it starts in the chat).
// A plain module with no imports, so the rule can be tested in Node (test/ui-start-today.test.ts).

/**
 * @param {{ hash?: string, answering?: boolean, wizard?: boolean, demo?: boolean }} start
 * @returns {boolean} true when the app should open on Today
 */
export function startsOnToday({ hash = '', answering = false, wizard = false, demo = false } = {}) {
  if (demo || answering || wizard) return false;
  const h = String(hash ?? '').replace(/^#/, '').trim();
  return h === '';
}
