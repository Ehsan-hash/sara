// The application: middleware around a router. createApp() is the public entry point.
import { loadConfig } from './config.js';
import { HttpError } from './http/errors.js';
import { parseUrl, readJson } from './http/request.js';
import { sendEmpty, sendError, sendJson } from './http/response.js';
import { requestLog } from './middleware/logger.js';
import { rateLimit } from './middleware/ratelimit.js';
import { Router, runChain } from './router.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { noteRoutes } from './routes/notes.js';
import { userRoutes } from './routes/users.js';
import { createStore } from './store/memory.js';
import { systemClock } from './util/clock.js';

export function createApp({ clock = systemClock(), store = createStore(), secret, config: overrides = {} } = {}) {
  if (!secret || secret.length < 16) throw new Error('createApp needs a secret of at least 16 characters.');
  const config = loadConfig(overrides);
  const deps = { clock, store, secret, config };
  const router = new Router();
  healthRoutes(router, deps);
  authRoutes(router, deps);
  noteRoutes(router, deps);
  userRoutes(router, deps);
  const log = requestLog(deps);
  const limit = rateLimit(deps);

  async function handle(req, res) {
    const { path, query } = parseUrl(req);
    const ctx = {
      req,
      res,
      path,
      query,
      params: {},
      body: undefined,
      user: undefined,
      json: (status, body) => sendJson(res, status, body),
      empty: (status) => sendEmpty(res, status),
    };
    try {
      await runChain(
        [
          log,
          async (c, next) => {
            const found = router.match(req.method, path);
            if (!found) throw new HttpError(404, 'not_found', 'No such endpoint.');
            if (found.allowed) {
              res.setHeader('allow', found.allowed.join(', '));
              throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
            }
            c.params = found.params;
            if (req.method === 'POST' || req.method === 'PATCH') c.body = await readJson(req, config.bodyLimitBytes);
            // The rate limit runs after authentication inside each route chain (it needs ctx.user),
            // so it is added to the end of every chain here.
            await runChain([...found.route.handlers.slice(0, -1), limit, found.route.handlers.at(-1)], c);
            await next();
          },
        ],
        ctx,
      );
    } catch (err) {
      if (!res.headersSent) sendError(res, err);
      else res.destroy();
    }
  }
  return { handle, config, store, clock, log: log.lines };
}
