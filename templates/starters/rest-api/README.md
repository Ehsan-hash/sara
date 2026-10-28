# __PROJECT_NAME__

A JSON REST API in plain Node.js: `node:http` and `node:sqlite` are built in, so there is
nothing to install (Node 22.13 or newer).

## Run it

```sh
node server.js          # http://localhost:3000/items
PORT=8080 DB_FILE=my.db node server.js
```

## Endpoints

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| GET | /items | | all items |
| POST | /items | `{"name": "Buy milk"}` | the new item (201) |
| GET | /items/:id | | one item |
| PATCH | /items/:id | `{"name": "...", "done": true}` | the changed item |
| DELETE | /items/:id | | 204 |
| GET | /health | | `{"ok": true}` |

Errors come back as `{"error": "plain message"}` with a 4xx status.

## Test it

```sh
npm test
```

The tests start the API on a free port with an in-memory database.
