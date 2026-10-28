import { splitPath } from './path.js';

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, parts: splitPath(pattern), handler });
      return this;
    },
    match(method, path) {
      const parts = splitPath(path);
      for (const r of routes) {
        if (r.method !== method) continue;
        if (r.parts.length === parts.length && r.parts.every((p, i) => p === parts[i])) return { handler: r.handler, params: {} };
      }
      return null;
    },
  };
}
