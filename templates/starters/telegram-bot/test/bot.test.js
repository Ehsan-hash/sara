// The bot against a fake Telegram server on this computer (no network, no real token).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Bot } from '../bot.js';

test('a poll fetches updates, answers each message and moves the offset', async (t) => {
  const sent = [];
  const offsets = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/botTEST:TOKEN/getUpdates') {
      offsets.push(json.offset);
      const result = json.offset > 0 ? [] : [
        { update_id: 7, message: { chat: { id: 42 }, from: { first_name: 'Ana' }, text: '/start' } },
        { update_id: 8, message: { chat: { id: 42 }, text: 'hello' } },
        { update_id: 9, edited_message: { chat: { id: 42 }, text: 'ignored' } },
      ];
      return res.end(JSON.stringify({ ok: true, result }));
    }
    if (req.url === '/botTEST:TOKEN/sendMessage') {
      sent.push(json);
      return res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, description: 'Not Found' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const bot = new Bot({ token: 'TEST:TOKEN', apiBase: `http://127.0.0.1:${server.address().port}` });
  assert.equal(await bot.pollOnce(0), 3);
  assert.equal(bot.offset, 10);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Hi Ana/);
  assert.equal(sent[1].text, 'You said: hello');
  assert.equal(sent[1].chat_id, 42);
  assert.equal(await bot.pollOnce(0), 0);
  assert.deepEqual(offsets, [0, 10]);
});

test('no token: a plain error', () => {
  assert.throws(() => new Bot({ token: '' }), /TELEGRAM_BOT_TOKEN/);
});
