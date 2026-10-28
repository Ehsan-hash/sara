# Authentication and permissions

## Tokens

- `POST /auth/login` with `{ "username", "password" }` returns `{ "token", "expiresAt" }`.
- An access token is valid for **15 minutes** (`tokenTtlSeconds` in `src/config.js`): it is valid
  while the current time is before its expiry, and expired from the expiry second on.
- Send it as `Authorization: Bearer <token>`. The scheme name is **case-insensitive** (`Bearer`,
  `bearer`, `BEARER` all work) and may be followed by one or more spaces.
- No header, another scheme (`Basic …`), or a token that is malformed or has a wrong signature:
  `401 { "error": "unauthorized" }`.
- An expired token: `401 { "error": "token_expired" }` on **every** endpoint, with one exception:
  `POST /auth/refresh` still accepts a token that expired **at most 5 minutes** ago
  (`refreshGraceSeconds`) and answers with a fresh token. Later than that, refresh also answers
  `401 { "error": "token_expired" }`.

## Roles

`viewer` < `editor` < `admin`. A higher role can do everything a lower one can.

| | viewer | editor | admin |
|---|:-:|:-:|:-:|
| Read own notes and notes shared with them | ✓ | ✓ | ✓ |
| Read every note | | | ✓ |
| Create notes | | ✓ | ✓ |
| Edit own notes, and notes shared with them **for editing** | | ✓ | ✓ |
| Edit every note | | | ✓ |
| Share own notes | | ✓ | ✓ |
| Delete a note | owner only | owner only | any note |
| Manage users (`/users`) | | | ✓ |

- **Only a note's owner or an admin can delete it.** Sharing (even for editing) never gives the
  right to delete. Anyone else who can read the note gets `403 { "error": "forbidden" }`.
- A note you cannot read does not exist for you: `404 { "error": "not_found" }` (also on edit and
  delete), so ids of other people's notes don't leak.
- A viewer never edits, even a note shared with them for editing: `403 { "error": "forbidden" }`.

## Rate limit

`rateLimitPerMinute` requests per minute per signed-in user (per address before signing in);
over it: `429 { "error": "rate_limited" }`.
