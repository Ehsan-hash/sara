// Phase 24: two-step sign-in with an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 s),
// the kind every authenticator app (Google Authenticator, 1Password, Authy, Apple Passwords…)
// understands. Written with Node's crypto only.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(b: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not a valid secret.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

export const totpCounter = (now: number) => Math.floor(now / 30_000);

/**
 * Checks a code (allowing one step of clock drift either way). Returns the counter it matched, or
 * undefined. Codes at or before `lastCounter` were already used and are refused.
 */
export function verifyTotp(secret: string, code: string, now: number, lastCounter = -1): number | undefined {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return undefined;
  const at = totpCounter(now);
  for (const k of [at, at - 1, at + 1]) {
    if (k <= lastCounter) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, k)), Buffer.from(c))) return k;
  }
  return undefined;
}

export function otpauthUrl(secret: string, account: string, issuer = 'Sara'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
