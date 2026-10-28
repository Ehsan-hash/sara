import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store/memory.js';
import { seedDemo } from './store/seed.js';

/** Serves an app; resolves to { url, close }. Port 0 picks a free port. */
export function startServer(app, port = 0, host = '127.0.0.1') {
  const server = createServer((req, res) => {
    app.handle(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolve({ url: `http://${host}:${p}`, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const store = createStore();
  seedDemo(store);
  const app = createApp({ store, secret: process.env.NOTES_SECRET ?? 'dev-secret-change-me-please', config: { logRequests: true } });
  const { url } = await startServer(app, Number(process.env.PORT ?? 8080));
  console.log(`notes-api on ${url}`);
}
