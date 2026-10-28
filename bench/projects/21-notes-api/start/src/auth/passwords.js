import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Small cost: this is a demo service and the tests hash a few passwords.
const COST = { N: 1024, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, COST);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), want.length, COST);
  return timingSafeEqual(want, got);
}
