// Phase 43: shared rules for the chat bridges (Discord, Telegram): who counts as an owner, when she
// answers in a server or group, and which IDs the owner typed in.

/** True when her name is said as a word ("Sara, are you there?", "hey sara"), not inside another word. */
export function nameCalled(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])${esc}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

/** "@all" or "@everyone" in a Telegram group (it has no real @everyone; people type these). */
export function everyoneCalled(text: string): boolean {
  return /(^|\s)@(all|everyone|here)\b/i.test(text);
}

/** Discord IDs (snowflakes) from what the owner typed: numbers separated by commas, spaces or lines. */
export function cleanDiscordIds(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(parts.map((s) => s.trim()).filter((s) => /^\d{15,21}$/.test(s)))].slice(0, 50);
}

/** Telegram IDs (users are positive, groups negative, e.g. -1001234567890). */
export function cleanTelegramIds(v: unknown): number[] {
  const parts = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(parts.map((s) => s.trim()).filter((s) => /^-?\d{3,16}$/.test(s)).map(Number))].slice(0, 50);
}
