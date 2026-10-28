import { authenticate } from '../middleware/auth.js';
import { noteService } from '../services/notes.js';

export function noteRoutes(router, deps) {
  const notes = noteService(deps);
  const auth = authenticate(deps);
  router.get('/notes', auth, async (ctx) => ctx.json(200, { notes: notes.list(ctx.user) }));
  router.post('/notes', auth, async (ctx) => ctx.json(201, notes.create(ctx.user, ctx.body)));
  router.get('/notes/:id', auth, async (ctx) => ctx.json(200, notes.get(ctx.user, ctx.params.id)));
  router.patch('/notes/:id', auth, async (ctx) => ctx.json(200, notes.update(ctx.user, ctx.params.id, ctx.body)));
  router.delete('/notes/:id', auth, async (ctx) => {
    notes.remove(ctx.user, ctx.params.id);
    ctx.empty(204);
  });
  router.post('/notes/:id/shares', auth, async (ctx) => ctx.json(201, notes.share(ctx.user, ctx.params.id, ctx.body)));
}
