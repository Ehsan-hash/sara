# Notes for customising (for the assistant)

- Rename `items` to what the owner needs (table in `db.js`, routes in `server.js`, tests).
- New fields: add the column in `db.js` (and an `ALTER TABLE` for existing databases), check the
  input in `server.js` the way `cleanName` does, and test good and bad input.
- Keep answers JSON with plain error messages; keep the body size limit.
- Before putting it online: add authentication (a token header) and run it behind HTTPS.
- Run `npm test` after every change.
