import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

let s;
let bea;
let cam;
let dee;
before(async () => {
  s = await startTestServer();
  [bea, cam, dee] = [await s.login('bea'), await s.login('cam'), await s.login('dee')];
});
after(() => s.close());

test('each person sees their own notes and the ones shared with them', async () => {
  const titles = async (t) => (await s.call('GET', '/notes', { token: t })).body.notes.map((n) => n.title).sort();
  assert.deepEqual(await titles(bea), ['Groceries', 'Q2 roadmap']);
  assert.deepEqual(await titles(cam), ['Groceries', 'Q2 roadmap']);
  assert.deepEqual(await titles(dee), ['Dal recipe', 'Q2 roadmap']);
});

test('create, read, edit', async () => {
  const c = await s.call('POST', '/notes', { token: bea, body: { title: '  Trip  ', tags: ['Travel', 'travel'] } });
  assert.equal(c.status, 201);
  assert.equal(c.body.title, 'Trip');
  assert.deepEqual(c.body.tags, ['travel']);
  s.clock.advance(1000);
  const e = await s.call('PATCH', `/notes/${c.body.id}`, { token: bea, body: { body: 'Lisbon in May' } });
  assert.equal(e.body.body, 'Lisbon in May');
  assert.notEqual(e.body.updatedAt, c.body.updatedAt);
});

test('viewers cannot create; validation', async () => {
  assert.equal((await s.call('POST', '/notes', { token: cam, body: { title: 'x' } })).status, 403);
  assert.equal((await s.call('POST', '/notes', { token: bea, body: { title: '' } })).status, 400);
  assert.equal((await s.call('POST', '/notes', { token: bea, body: { title: 'x', tags: 'a' } })).status, 400);
});

test('an editor with an edit share can edit; a viewer with one cannot', async () => {
  const id = s.seed.notes.roadmap;
  assert.equal((await s.call('PATCH', `/notes/${id}`, { token: dee, body: { body: 'search first' } })).status, 200);
  assert.equal((await s.call('PATCH', `/notes/${id}`, { token: cam, body: { body: 'hi' } })).status, 403);
});

test("other people's notes are not found", async () => {
  assert.equal((await s.call('GET', `/notes/${s.seed.notes.secret}`, { token: bea })).status, 404);
  assert.equal((await s.call('PATCH', `/notes/${s.seed.notes.recipe}`, { token: bea, body: { title: 'x' } })).status, 404);
});

test('the owner deletes a note', async () => {
  const c = await s.call('POST', '/notes', { token: dee, body: { title: 'Temp' } });
  assert.equal((await s.call('DELETE', `/notes/${c.body.id}`, { token: dee })).status, 204);
  assert.equal((await s.call('GET', `/notes/${c.body.id}`, { token: dee })).status, 404);
});

test('sharing', async () => {
  const c = await s.call('POST', '/notes', { token: bea, body: { title: 'Plan' } });
  const r = await s.call('POST', `/notes/${c.body.id}/shares`, { token: bea, body: { userId: s.seed.users.cam, access: 'read' } });
  assert.equal(r.status, 201);
  assert.equal((await s.call('GET', `/notes/${c.body.id}`, { token: cam })).status, 200);
  assert.equal((await s.call('POST', `/notes/${c.body.id}/shares`, { token: dee, body: { userId: s.seed.users.cam, access: 'read' } })).status, 404);
});
