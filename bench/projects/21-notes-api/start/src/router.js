// Method + path routing. Patterns use :name for one path segment. Each route has a chain of
// handlers (ctx, next) => …; a handler that doesn't call next() ends the chain.

function compile(pattern) {
  const names = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${src}$`), names };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    if (!handlers.length) throw new Error(`No handler for ${method} ${pattern}`);
    this.routes.push({ method, pattern, ...compile(pattern), handlers });
    return this;
  }

  get(p, ...h) {
    return this.add('GET', p, ...h);
  }
  post(p, ...h) {
    return this.add('POST', p, ...h);
  }
  patch(p, ...h) {
    return this.add('PATCH', p, ...h);
  }
  delete(p, ...h) {
    return this.add('DELETE', p, ...h);
  }

  /** { route, params } for a request, or { allowed: [...] } when only the method is wrong, or null. */
  match(method, path) {
    const allowed = [];
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method) {
        allowed.push(r.method);
        continue;
      }
      const params = {};
      r.names.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1]);
      });
      return { route: r, params };
    }
    return allowed.length ? { allowed } : null;
  }
}

/** Runs handlers in order; each gets next() to continue. */
export async function runChain(handlers, ctx) {
  let i = -1;
  const step = async (k) => {
    if (k <= i) throw new Error('next() called twice');
    i = k;
    const h = handlers[k];
    if (h) await h(ctx, () => step(k + 1));
  };
  await step(0);
}
