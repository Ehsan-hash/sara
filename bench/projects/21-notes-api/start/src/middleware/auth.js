// Authentication: the bearer token in the Authorization header becomes ctx.user.
import { HttpError, unauthorized } from '../http/errors.js';
import { verifyToken } from '../auth/tokens.js';

const SCHEME = 'Bearer ';

function bearer(header) {
  if (typeof header !== 'string' || !header.startsWith(SCHEME)) return undefined;
  const token = header.slice(SCHEME.length).trim();
  return token || undefined;
}

/**
 * Middleware factory. options.graceSeconds: how long after expiry a token is still accepted
 * (the refresh endpoint passes its own value).
 */
export function authenticate({ secret, clock, store, config }, options = {}) {
  const graceSeconds = options.graceSeconds ?? config.refreshGraceSeconds;
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
