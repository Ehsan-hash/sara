# Notes for customising (for the assistant)

- Add commands in `COMMANDS` in `handlers.js`; keep handlers pure (text in, text out) and add a
  test for each in `test/handlers.test.js`.
- Keep the token in `TELEGRAM_BOT_TOKEN` only. Never write it into the project.
- For buttons, send `reply_markup` with `inline_keyboard` from `bot.js` and handle `callback_query`
  updates (add it to `allowed_updates`).
- To store things, use `node:sqlite` (built in) rather than adding a package.
- Run `npm test` after every change.
