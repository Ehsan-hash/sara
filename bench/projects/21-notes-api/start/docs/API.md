# Endpoints

All bodies are JSON. Errors are `{ "error": "<code>", "message": "<text>" }`.

| Method and path | Who | Body | Answer |
|---|---|---|---|
| `GET /health` | anyone | | `200 { "ok": true }` |
| `POST /auth/login` | anyone | `{ username, password }` | `200 { token, expiresAt }`, `401 bad_credentials` |
| `POST /auth/refresh` | signed in (5 min grace) | | `200 { token, expiresAt }` |
| `GET /auth/me` | signed in | | `200 { id, username, role }` |
| `GET /notes` | signed in | | `200 { notes: [...] }` the notes you can read, newest first |
| `POST /notes` | editor+ | `{ title, body?, tags? }` | `201 note` |
| `GET /notes/:id` | can read | | `200 note` |
| `PATCH /notes/:id` | can edit | `{ title?, body?, tags? }` | `200 note` |
| `DELETE /notes/:id` | owner or admin | | `204` |
| `POST /notes/:id/shares` | owner (editor+) or admin | `{ userId, access: "read" \| "edit" }` | `201 { noteId, userId, access }` |
| `GET /users` | admin | | `200 { users: [...] }` |
| `POST /users` | admin | `{ username, password, role }` | `201 user` |
| `PATCH /users/:id/role` | admin | `{ role }` | `200 user` |

A note: `{ id, ownerId, title, body, tags, createdAt, updatedAt }` (times as ISO strings).
Titles are 1 to 120 characters; bodies up to 20 000; at most 10 tags of up to 30 characters.
