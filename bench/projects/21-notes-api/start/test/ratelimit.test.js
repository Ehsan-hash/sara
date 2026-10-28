import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers.js';

test('over the limit: 429, and a new minute resets it', async () => {
  const s = await startTestServer({ rateLimitPerMinute: 3 });
  try {
    const t = await s.login('bea');
    for (let i = 0; i < 3; i++) assert.equal((await s.call('GET', '/notes', { token: t })).status, 200);
    assert.equal((await s.call('GET', '/notes', { token: t })).body.error, 'rate_limited');
    s.clock.advance(60_000);
    assert.equal((await s.call('GET', '/notes', { token: t })).status, 200);
  } finally {
    await s.close();
  }
});
