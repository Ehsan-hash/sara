import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';
import { openDb } from '../db.js';

const db = openDb(':memory:');
const server = createApp(db);
let base = '';
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
});
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

test('create, read, update, delete', async () => {
  assert.deepEqual((await call('GET', '/items')).body, []);
  const made = await call('POST', '/items', { name: '  Buy milk ' });
  assert.equal(made.status, 201);
  assert.equal(made.body.name, 'Buy milk');
  assert.equal(made.body.done, false);
  const id = made.body.id;
  assert.equal((await call('GET', `/items/${id}`)).body.name, 'Buy milk');
  const upd = await call('PATCH', `/items/${id}`, { done: true });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.done, true);
  assert.equal((await call('GET', '/items')).body.length, 1);
  assert.equal((await call('DELETE', `/items/${id}`)).status, 204);
  assert.equal((await call('GET', `/items/${id}`)).status, 404);
});

test('bad input gets a 4xx with a plain message', async () => {
  assert.equal((await call('POST', '/items', { name: '' })).status, 400);
  assert.equal((await call('POST', '/items', 'not json')).status, 400);
  assert.equal((await call('PATCH', '/items/abc', { done: true })).status, 400);
  const made = await call('POST', '/items', { name: 'x' });
  assert.match((await call('PATCH', `/items/${made.body.id}`, { done: 'yes' })).body.error, /true or false/);
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('PUT', '/items')).status, 405);
});
