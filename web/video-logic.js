// Phase 69: the parts of a video call that are plain logic (no page needed), so they can be tested
// in Node like mouth.js: the call timer, picture sizes, how often a camera picture may go, her
// expression from what she says, and the captions.

/** "0:05", "12:34", "1:02:03". */
export function formatCallTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The size a camera picture is sent at: the long side at most `max` pixels, never enlarged. */
export function fitWithin(width, height, max = 512) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Same floor as the server (src/video.ts MIN_GAP_MS): never more often than this, even when asked. */
export const MIN_GAP_MS = 3000;

/**
 * When the next camera picture may go. Mirrors the server's limits so the app doesn't send pictures
 * the server would refuse: every `everySec` seconds (0 = only when asked), at most `perCall`.
 */
export class FramePacer {
  constructor({ everySec = 10, perCall = 60 } = {}) {
    this.everySec = Number(everySec) || 0;
    this.perCall = Math.max(0, Number(perCall) || 0);
    this.sent = 0;
    this.last = -Infinity;
  }

  get left() {
    return Math.max(0, this.perCall - this.sent);
  }

  /** Time for the next automatic picture? */
  due(now) {
    if (!this.everySec || this.left <= 0) return false;
    return now - this.last >= Math.max(MIN_GAP_MS, this.everySec * 1000);
  }

  /** May the owner's "Look at this" go now? */
  canAsk(now) {
    return this.left > 0 && now - this.last >= MIN_GAP_MS;
  }

  /** A picture went. */
  mark(now) {
    this.last = now;
    this.sent++;
  }
}

// Her face follows what she is saying for a moment (English words and emoji; in other languages
// her mood from the server still sets it). Checked in this order: the first match wins.
const CUES = [
  ['hurt', /\b(that hurt|ouch|you hurt me|that stung)\b/i],
  ['caring', /\b(i'?m so sorry|sorry to hear|that sounds (hard|rough|awful)|i'?m here for you|sending (you )?a hug|take care of yourself|oh no)\b|🫂|❤️‍🩹/i],
  ['sleepy', /\b(sleepy|so tired|yawn|getting late|time for bed|go to sleep)\b|😴|🥱/i],
  ['playful', /\b(just teasing|kidding|gotcha|tease|cheeky|wink)\b|😜|😏|😉/i],
  ['happy', /\b(haha+|hehe+|lol|that'?s (great|amazing|wonderful)|i love (it|that)|yay|congrat\w*)\b|😂|😄|😊|🎉|\[(laugh|giggle|chuckle)\]/i],
];

/** The expression her words suggest (one of presence.js's), or null. */
export function expressionFromText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  for (const [x, re] of CUES) if (re.test(s)) return x;
  return null;
}

/**
 * Captions on a video call: what you said (interim words replaced by the final ones) and what she is
 * saying (pieces added as they arrive). Keeps the last few lines, each at most `maxChars` (the end
 * of a long line is what matters while it is being spoken).
 */
export class CaptionLog {
  constructor({ maxLines = 3, maxChars = 220 } = {}) {
    this.maxLines = maxLines;
    this.maxChars = maxChars;
    this.items = [];
  }

  #open(who) {
    const last = this.items.at(-1);
    if (last && last.who === who && !last.done) return last;
    const item = { who, text: '', done: false };
    this.items.push(item);
    if (this.items.length > this.maxLines) this.items.splice(0, this.items.length - this.maxLines);
    return item;
  }

  /** Your words: interim text replaces the line; final closes it. */
  you(text, final) {
    const item = this.#open('you');
    item.text = String(text ?? '');
    if (final) item.done = true;
  }

  /** A piece of what she is saying. */
  her(piece) {
    const item = this.#open('her');
    item.text += String(piece ?? '');
  }

  /** Her line is complete (the whole text replaces the pieces, so a cut-off ends with "…"). */
  herDone(text) {
    const item = this.#open('her');
    if (text !== undefined) item.text = String(text);
    item.done = true;
  }

  clear() {
    this.items = [];
  }

  /** What to show: [{ who, text }], each line trimmed from the front if too long. */
  lines() {
    return this.items
      .filter((i) => i.text.trim())
      .map((i) => ({ who: i.who, text: i.text.length > this.maxChars ? `…${i.text.slice(-this.maxChars).replace(/^\S*\s/, '')}` : i.text }));
  }
}
