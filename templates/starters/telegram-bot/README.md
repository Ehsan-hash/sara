# __PROJECT_NAME__

A Telegram bot in plain Node.js: no packages to install. It uses long polling, so it works from
any computer (no public address or webhook needed).

## Run it

1. In Telegram, message **@BotFather**, send `/newbot` and copy the token it gives you.
2. Start the bot with the token in the environment (never write it into a file here):

   ```sh
   TELEGRAM_BOT_TOKEN=123456:your-token node bot.js
   ```

   On Windows PowerShell: `$env:TELEGRAM_BOT_TOKEN="123456:your-token"; node bot.js`
3. Send your bot `/start`.

## Test it

```sh
npm test
```

The tests use a fake Telegram server on your computer, so they run offline.

## Files

- `bot.js`: talks to Telegram (getUpdates long polling, sendMessage).
- `handlers.js`: what the bot answers. Add commands here.
- `test/`: tests for both.
