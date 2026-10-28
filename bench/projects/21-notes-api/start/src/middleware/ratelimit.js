import { HttpError } from '../http/errors.js';
import { clientAddress } from '../http/request.js';

/** Fixed one-minute windows per user (or per address before sign-in). */
export function rateLimit({ clock, config }) {
  const windows = new Map();
  return async (ctx, next) => {
    const key = ctx.user ? `u:${ctx.user.id}` : `a:${clientAddress(ctx.req)}`;
    const minute = Math.floor(clock.now() / 60_000);
    const w = windows.get(key);
    if (!w || w.minute !== minute) windows.set(key, { minute, count: 1 });
    else if (++w.count > config.rateLimitPerMinute) throw new HttpError(429, 'rate_limited', 'Too many requests; wait a minute.');
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);
    await next();
  };
}
