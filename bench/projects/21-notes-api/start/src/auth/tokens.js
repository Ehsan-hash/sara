// Access tokens: base64url(JSON payload) + "." + HMAC-SHA256 signature. The payload holds the
// user id (sub), role, issue time (iat) and expiry (exp), both in seconds.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { nowSeconds } from '../util/clock.js';

const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

export function issueToken(user, { secret, clock, ttlSeconds }) {
  const iat = nowSeconds(clock);
  const payload = { sub: user.id, role: user.role, iat, exp: iat + ttlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${data}.${sign(data, secret)}`, expiresAt: new Date(payload.exp * 1000).toISOString(), payload };
}

/**
 * Checks a token. graceSeconds lets an expired token through for that long after its expiry.
 * Returns { ok: true, payload } or { ok: false, reason: 'invalid' | 'expired' }.
 */
export function verifyToken(token, { secret, clock, graceSeconds = 0 }) {
  const parts = String(token).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };
  const [data, sig] = parts;
  const want = Buffer.from(sign(data, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'invalid' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof payload.exp !== 'number' || typeof payload.sub !== 'string') return { ok: false, reason: 'invalid' };
  if (nowSeconds(clock) >= payload.exp + graceSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
