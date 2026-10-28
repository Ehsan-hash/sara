import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { start } from './helpers.js';

let s;
before(async () => {
  s = await start();
});
after(() => s.close());
const B = (t) => `Bearer ${t}`;

test('hidden: the scheme is case-insensitive, with one or more spaces', async () => {
  const t = await s.login('bea');
  for (const auth of [`bearer ${t}`, `BEARER ${t}`, `Bearer ${t}`, `Bearer   ${t}`, `bEaReR ${t}`]) assert.equal((await s.call('GET', '/auth/me', { auth })).status, 200, auth);
});

test('hidden: other schemes and broken headers are unauthorized', async () => {
  const t = await s.login('bea');
  for (const auth of [`Basic ${t}`, 'Bearer', 'Bearer ', `Token ${t}`, t, `Bearer${t}`]) {
    const r = await s.call('GET', '/auth/me', { auth });
    assert.equal(r.status, 401, auth);
    assert.equal(r.body.error, 'unauthorized', auth);
  }
});

test('hidden: an expired token is rejected everywhere but refresh', async () => {
  const t = await s.login('bea');
  s.clock.advance(15 * 60_000 - 1000);
  assert.equal((await s.call('GET', '/notes', { auth: B(t) })).status, 200, 'one second before expiry');
  s.clock.advance(1000);
  for (const [m, p, body] of [['GET', '/notes'], ['GET', '/auth/me'], ['POST', '/notes', { title: 'x' }], ['GET', `/notes/${s.seed.notes.groceries}`]]) {
    const r = await s.call(m, p, { auth: B(t), body });
    assert.equal(r.status, 401, `${m} ${p} at expiry`);
    assert.equal(r.body.error, 'token_expired', `${m} ${p}`);
  }
  s.clock.advance(3 * 60_000);
  assert.equal((await s.call('PATCH', `/notes/${s.seed.notes.groceries}`, { auth: B(t), body: { title: 'y' } })).body.error, 'token_expired', '3 minutes after expiry');
});

test('hidden: refresh accepts a token up to 5 minutes after expiry, not later', async () => {
  const t = await s.login('dee');
  s.clock.advance(15 * 60_000 + 4 * 60_000 + 59_000);
  const r = await s.call('POST', '/auth/refresh', { auth: B(t) });
  assert.equal(r.status, 200);
  assert.equal((await s.call('GET', '/auth/me', { auth: `bearer ${r.body.token}` })).body.username, 'dee');
  const t2 = await s.login('dee');
  s.clock.advance(20 * 60_000);
  const late = await s.call('POST', '/auth/refresh', { auth: B(t2) });
  assert.equal(late.status, 401);
  assert.equal(late.body.error, 'token_expired');
});

test('hidden: a changed grace setting is honoured by refresh only', async () => {
  const s2 = await start({ refreshGraceSeconds: 60 });
  try {
    const t = await s2.login('bea');
    s2.clock.advance(15 * 60_000 + 30_000);
    assert.equal((await s2.call('GET', '/notes', { auth: B(t) })).status, 401);
    assert.equal((await s2.call('POST', '/auth/refresh', { auth: B(t) })).status, 200);
    s2.clock.advance(60_000);
    assert.equal((await s2.call('POST', '/auth/refresh', { auth: B(t) })).status, 401);
  } finally {
    await s2.close();
  }
});
