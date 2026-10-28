// Authentication: the bearer token in the Authorization header becomes ctx.user.
import { HttpError, unauthorized } from '../http/errors.js';
import { verifyToken } from '../auth/tokens.js';

function bearer(header) {
  const m = typeof header === 'string' ? /^bearer +(\S+)\s*$/i.exec(header) : null;
  return m ? m[1] : undefined;
}

/**
 * Middleware factory. options.graceSeconds: how long after expiry a token is still accepted
 * (the refresh endpoint passes its own value).
 */
export function authenticate({ secret, clock, store, config }, options = {}) {
  // Only the refresh endpoint passes a grace period; everywhere else an expired token is expired.
  const graceSeconds = options.graceSeconds ?? 0;
  return async (ctx, next) => {
    const token = bearer(ctx.req.headers.authorization);
    if (!token) throw unauthorized('Send a bearer token.');
    const result = verifyToken(token, { secret, clock, graceSeconds });
    if (!result.ok) {
      if (result.reason === 'expired') throw new HttpError(401, 'token_expired', 'Your session expired. Sign in again.');
      throw unauthorized('That token is not valid.');
    }
    const user = store.users.get(result.payload.sub);
    if (!user || user.disabled) throw unauthorized('That account no longer exists.');
    // The role comes from the store, not the token: a changed role applies right away.
    ctx.user = { id: user.id, username: user.username, role: user.role };
    ctx.token = result.payload;
    await next();
  };
}
