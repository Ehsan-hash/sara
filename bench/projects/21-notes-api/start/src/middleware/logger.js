/** Request log: method, path, status, time taken. Keeps the last 200 lines in memory. */
export function requestLog({ clock, config }) {
  const lines = [];
  const mw = async (ctx, next) => {
    const t0 = clock.now();
    try {
      await next();
    } finally {
      const line = `${ctx.req.method} ${ctx.path} ${ctx.res.statusCode} ${clock.now() - t0}ms${ctx.user ? ` ${ctx.user.username}` : ''}`;
      lines.push(line);
      if (lines.length > 200) lines.shift();
      if (config.logRequests) console.log(line);
    }
  };
  mw.lines = lines;
  return mw;
}
