import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { createStore } from '../src/store/memory.js';
import { seedDemo } from '../src/store/seed.js';
import { fixedClock } from '../src/util/clock.js';

export async function start(config = {}) {
  const clock = fixedClock(Date.parse('2026-05-04T10:00:00Z'));
  const store = createStore();
  const seed = seedDemo(store);
  const app = createApp({ clock, store, secret: 'hidden-secret-abcdefghijk', config });
  const srv = await startServer(app);
  const call = async (method, path, { auth, body } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth !== undefined) headers.authorization = auth;
    const res = await fetch(srv.url + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  const login = async (u) => (await call('POST', '/auth/login', { body: { username: u, password: `pw-${u}` } })).body.token;
  return { ...srv, clock, store, seed, call, login };
}
