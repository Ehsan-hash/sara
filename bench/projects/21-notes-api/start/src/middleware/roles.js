import { forbidden } from '../http/errors.js';

export const ROLES = ['viewer', 'editor', 'admin'];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));

/** True when the user's role is at least `min`. */
export function hasRole(user, min) {
  if (!(min in RANK)) throw new Error(`Unknown role: ${min}`);
  return Boolean(user) && user.role in RANK && RANK[user.role] >= RANK[min];
}

export function requireRole(min) {
  return async (ctx, next) => {
    if (!hasRole(ctx.user, min)) throw forbidden(`This needs the ${min} role.`);
    await next();
  };
}
