import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

let s;
before(async () => {
  s = await startTestServer();
});
after(() => s.close());

test('login gives a token that works', async () => {
  const r = await s.call('POST', '/auth/login', { body: { username: 'bea', password: 'pw-bea' } });
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^[\w-]+\.[\w-]+$/);
  const me = await s.call('GET', '/auth/me', { token: r.body.token });
  assert.deepEqual({ ...me.body, id: undefined }, { id: undefined, username: 'bea', role: 'editor' });
});

test('wrong password and unknown user', async () => {
  assert.equal((await s.call('POST', '/auth/login', { body: { username: 'bea', password: 'nope' } })).status, 401);
  assert.equal((await s.call('POST', '/auth/login', { body: { username: 'zed', password: 'pw-zed' } })).status, 401);
});

test('no token, a broken token, another scheme', async () => {
  assert.equal((await s.call('GET', '/notes')).body.error, 'unauthorized');
  assert.equal((await s.call('GET', '/notes', { token: 'abc.def' })).body.error, 'unauthorized');
  const t = await s.login('bea');
  assert.equal((await s.call('GET', '/notes', { headers: { authorization: `Basic ${t}` } })).status, 401);
});

test('a token works until it expires', async () => {
  const t = await s.login('bea');
  s.clock.advance(14 * 60_000);
  assert.equal((await s.call('GET', '/notes', { token: t })).status, 200);
});

test('refresh gives a new token', async () => {
  const t = await s.login('dee');
  const r = await s.call('POST', '/auth/refresh', { token: t });
  assert.equal(r.status, 200);
  assert.equal((await s.call('GET', '/auth/me', { token: r.body.token })).body.username, 'dee');
});

test('#47: the scheme name is case-insensitive', async () => {
  const t = await s.login('bea');
  const r = await s.call('GET', '/auth/me', { headers: { authorization: `bearer ${t}` } });
  assert.equal(r.status, 200);
});
