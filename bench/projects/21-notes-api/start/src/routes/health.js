export function healthRoutes(router) {
  router.get('/health', async (ctx) => ctx.json(200, { ok: true }));
}
