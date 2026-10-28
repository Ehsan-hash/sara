# notes-api

A small notes service: people sign in, write notes, and share them with each other. JSON over
HTTP, built on Node's own `http` module (no packages).

```sh
npm start          # http://localhost:8080, with the demo users from src/store/seed.js
npm test           # node --test
```

## Layout

| Path | What it is |
|---|---|
| `src/app.js` | `createApp({ clock, store, secret, config })`: wires middleware and routes; `app.handle(req, res)` |
| `src/server.js` | `startServer(app, port)`: an HTTP server around an app |
| `src/router.js` | Method + path routing with `:params`; each route is a chain of handlers |
| `src/http/` | Reading bodies and query strings, writing JSON, the `HttpError` type |
| `src/auth/` | Access tokens (`tokens.js`) and password hashing (`passwords.js`) |
| `src/middleware/` | Authentication, roles, note access rules, rate limiting, request log |
| `src/services/` | Business rules for notes and users (no HTTP in here) |
| `src/routes/` | The HTTP endpoints |
| `src/store/` | An in-memory store (`memory.js`) and the demo data (`seed.js`) |
| `docs/AUTH.md` | **The rules** for tokens, roles and who may do what with a note |
| `docs/API.md` | Every endpoint, with request and response bodies |

## Public API (used by other services and by our tests; keep it stable)

- `createApp(options)` from `src/app.js`; options: `clock` (`{ now() }` in milliseconds), `store`
  (from `createStore()` in `src/store/memory.js`), `secret` (string), `config` (overrides for
  `src/config.js`).
- `startServer(app, port)` from `src/server.js`, resolves to `{ url, close() }`.
- `createStore()` from `src/store/memory.js`, `seedDemo(store)` from `src/store/seed.js`.
- `fixedClock(start)` from `src/util/clock.js` (tests move time with `clock.advance(ms)`).
