import { splitPath } from './path.js';

/** 2 for plain text, 1 for :param, 0 for *wildcard. */
const rank = (part) => (part.startsWith('*') ? 0 : part.startsWith(':') ? 1 : 2);

function matchParts(pattern, parts) {
  const params = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith('*')) {
      params[p.slice(1)] = parts.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return pattern.length === parts.length ? params : null;
}

/** Negative when route a is more specific than route b. */
function compare(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ra = i < a.length ? rank(a[i]) : -1;
    const rb = i < b.length ? rank(b[i]) : -1;
    if (ra !== rb) return rb - ra;
  }
  return 0;
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, parts: splitPath(pattern), handler });
      return this;
    },
    match(method, path) {
      const parts = splitPath(path);
      let best = null;
      for (const r of routes) {
        if (!(r.method === method || r.method === 'ANY' || (method === 'HEAD' && r.method === 'GET'))) continue;
        const params = matchParts(r.parts, parts);
        if (!params) continue;
        if (!best || compare(r.parts, best.route.parts) < 0) best = { route: r, params };
      }
      return best && { handler: best.route.handler, params: best.params };
    },
  };
}
