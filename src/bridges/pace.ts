// Phase 11: on Telegram/Discord she can reply at a person's typing pace instead of instantly.
import type { AppContext } from '../chat.ts';

/** About how long a quick typist takes for this message (capped). */
export function typingMs(text: string): number {
  return Math.min(9000, 900 + text.length * 45);
}

/**
 * Waits before sending `text` so it arrives like typed, counting time already spent (thinking,
 * the previous message). `typing()` keeps the "typing…" indicator up meanwhile.
 */
export async function paceLikeTyping(app: AppContext, text: string, since: number, typing: () => void): Promise<void> {
  if (app.settings.get().persona?.typing !== 'human') return;
  let wait = typingMs(text) - (Date.now() - since);
  while (wait > 0) {
    typing();
    const step = Math.min(wait, 4000);
    await new Promise((r) => setTimeout(r, step));
    wait -= step;
  }
}
