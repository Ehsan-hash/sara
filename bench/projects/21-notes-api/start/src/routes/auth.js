import { HttpError } from '../http/errors.js';
import { issueToken } from '../auth/tokens.js';
import { authenticate } from '../middleware/auth.js';
import { requireObject, requireString } from '../util/validate.js';
import { userService } from '../services/users.js';

export function authRoutes(router, deps) {
  const users = userService(deps);
  const issue = (u) => {
    const { token, expiresAt } = issueToken(u, { secret: deps.secret, clock: deps.clock, ttlSeconds: deps.config.tokenTtlSeconds });
    return { token, expiresAt };
  };

  router.post('/auth/login', async (ctx) => {
    const body = requireObject(ctx.body);
    const u = users.byCredentials(requireString(body, 'username', { max: 64 }), requireString(body, 'password', { max: 200 }));
    if (!u) throw new HttpError(401, 'bad_credentials', 'Wrong username or password.');
    ctx.json(200, issue(u));
  });

  // Refresh accepts a token up to refreshGraceSeconds after it expired.
  router.post('/auth/refresh', authenticate(deps, { graceSeconds: deps.config.refreshGraceSeconds }), async (ctx) => {
    ctx.json(200, issue(ctx.user));
  });

  router.get('/auth/me', authenticate(deps), async (ctx) => {
    ctx.json(200, ctx.user);
  });
}
