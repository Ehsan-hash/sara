import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { userService } from '../services/users.js';

export function userRoutes(router, deps) {
  const users = userService(deps);
  const admin = [authenticate(deps), requireRole('admin')];
  router.get('/users', ...admin, async (ctx) => ctx.json(200, { users: users.list() }));
  router.post('/users', ...admin, async (ctx) => ctx.json(201, users.create(ctx.body)));
  router.patch('/users/:id/role', ...admin, async (ctx) => ctx.json(200, users.setRole(ctx.params.id, ctx.body)));
}
