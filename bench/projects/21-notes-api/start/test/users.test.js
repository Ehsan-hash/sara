import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

let s;
before(async () => {
  s = await startTestServer();
});
after(() => s.close());

test('admins list and create users; others cannot', async () => {
  const alex = await s.login('alex');
  const list = await s.call('GET', '/users', { token: alex });
  assert.deepEqual(list.body.users.map((u) => u.username), ['alex', 'bea', 'cam', 'dee']);
  assert.ok(list.body.users.every((u) => !('password' in u)));
  const c = await s.call('POST', '/users', { token: alex, body: { username: 'Eve', password: 'long-enough', role: 'viewer' } });
  assert.equal(c.status, 201);
  assert.equal(c.body.username, 'eve');
  assert.equal((await s.call('POST', '/users', { token: alex, body: { username: 'eve', password: 'long-enough', role: 'viewer' } })).status, 409);
  assert.equal((await s.call('GET', '/users', { token: await s.login('bea') })).status, 403);
});

test('a role change applies to existing tokens', async () => {
  const alex = await s.login('alex');
  const cam = await s.login('cam');
  assert.equal((await s.call('POST', '/notes', { token: cam, body: { title: 'x' } })).status, 403);
  await s.call('PATCH', `/users/${s.seed.users.cam}/role`, { token: alex, body: { role: 'editor' } });
  assert.equal((await s.call('POST', '/notes', { token: cam, body: { title: 'x' } })).status, 201);
});
