// A Telegram bot with long polling (no webhook, no packages). Start it with:
//   TELEGRAM_BOT_TOKEN=123:abc node bot.js
// Get a token from @BotFather in Telegram. Never put the token in a file in this folder.
import { replyTo } from './handlers.js';

const API = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

export class Bot {
  /** @param {{ token: string, apiBase?: string, onError?: (e: Error) => void }} opts */
  constructor(opts) {
    if (!opts.token) throw new Error('Set TELEGRAM_BOT_TOKEN (from @BotFather).');
    this.token = opts.token;
    this.apiBase = (opts.apiBase || API).replace(/\/+$/, '');
    this.offset = 0;
    this.stopped = false;
    this.onError = opts.onError || ((e) => console.error(`bot: ${e.message}`));
  }

  async call(method, body, signal) {
    const res = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!json.ok) throw new Error(`${method}: ${json.description || 'failed'}`);
    return json.result;
  }

  /** One long poll: waits up to `timeout` seconds for messages, answers each. Returns how many. */
  async pollOnce(timeout = 30, signal) {
    const updates = await this.call('getUpdates', { offset: this.offset, timeout, allowed_updates: ['message'] }, signal);
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      const m = u.message;
      if (!m || typeof m.text !== 'string') continue;
      const reply = replyTo(m.text, m.from?.first_name);
      if (reply) await this.call('sendMessage', { chat_id: m.chat.id, text: reply }, signal);
    }
    return updates.length;
  }

  /** Polls until stop(); waits a little after an error so a network problem doesn't spin. */
  async run() {
    this.controller = new AbortController();
    while (!this.stopped) {
      try {
        await this.pollOnce(30, this.controller.signal);
      } catch (err) {
        if (this.stopped) break;
        this.onError(err);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bot.js')) {
  const bot = new Bot({ token: process.env.TELEGRAM_BOT_TOKEN });
  process.on('SIGINT', () => bot.stop());
  process.on('SIGTERM', () => bot.stop());
  console.log('Bot is running. Press Ctrl+C to stop.');
  await bot.run();
}
