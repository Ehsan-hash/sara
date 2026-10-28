import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { createStore } from '../src/store/memory.js';
import { seedDemo } from '../src/store/seed.js';
import { fixedClock } from '../src/util/clock.js';

/** A seeded app on a free port with a clock the test controls. */
export async function startTestServer(config = {}) {
  const clock = fixedClock();
  const store = createStore();
  const seed = seedDemo(store);
  const app = createApp({ clock, store, secret: 'test-secret-0123456789', config });
  const srv = await startServer(app);
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(srv.url + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  const login = async (username) => (await call('POST', '/auth/login', { body: { username, password: `pw-${username}` } })).body.token;
  return { ...srv, clock, store, seed, app, call, login };
}
