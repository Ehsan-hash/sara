import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { start } from './helpers.js';

let s;
let tok;
before(async () => {
  s = await start();
  tok = {};
  for (const u of ['alex', 'bea', 'cam', 'dee']) tok[u] = `Bearer ${await s.login(u)}`;
});
after(() => s.close());

test('hidden: a viewer with a read share cannot delete (403)', async () => {
  const r = await s.call('DELETE', `/notes/${s.seed.notes.groceries}`, { auth: tok.cam });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden');
  assert.equal((await s.call('GET', `/notes/${s.seed.notes.groceries}`, { auth: tok.bea })).status, 200, 'still there');
});

test('hidden: an editor with an edit share cannot delete (403); a viewer with an edit share neither', async () => {
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.roadmap}`, { auth: tok.dee })).status, 403);
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.roadmap}`, { auth: tok.cam })).status, 403);
  assert.equal((await s.call('PATCH', `/notes/${s.seed.notes.roadmap}`, { auth: tok.dee, body: { body: 'ok' } })).status, 200, 'but she can still edit it');
});

test('hidden: someone who cannot read it gets 404 on delete', async () => {
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.recipe}`, { auth: tok.bea })).status, 404);
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.secret}`, { auth: tok.cam })).status, 404);
});

test('hidden: the owner and an admin can delete', async () => {
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.recipe}`, { auth: tok.dee })).status, 204);
  assert.equal((await s.call('DELETE', `/notes/${s.seed.notes.roadmap}`, { auth: tok.alex })).status, 204);
  assert.equal((await s.call('GET', `/notes/${s.seed.notes.roadmap}`, { auth: tok.dee })).status, 404, 'gone, shares too');
  assert.equal(s.store.shares.find((x) => x.noteId === s.seed.notes.roadmap).length, 0);
});

test('hidden: the rest still works (list, create, share, users)', async () => {
  const c = await s.call('POST', '/notes', { auth: tok.bea, body: { title: 'New', body: 'b' } });
  assert.equal(c.status, 201);
  assert.equal((await s.call('POST', `/notes/${c.body.id}/shares`, { auth: tok.bea, body: { userId: s.seed.users.dee, access: 'edit' } })).status, 201);
  assert.equal((await s.call('DELETE', `/notes/${c.body.id}`, { auth: tok.dee })).status, 403);
  assert.equal((await s.call('DELETE', `/notes/${c.body.id}`, { auth: tok.bea })).status, 204);
  assert.equal((await s.call('GET', '/users', { auth: tok.alex })).status, 200);
  assert.equal((await s.call('GET', '/users', { auth: tok.dee })).status, 403);
  assert.equal((await s.call('GET', '/health')).body.ok, true);
});
