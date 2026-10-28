import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Router, runChain } from '../src/router.js';

test('params and methods', () => {
  const r = new Router();
  const h = () => {};
  r.get('/notes/:id', h).delete('/notes/:id', h).get('/notes', h);
  assert.deepEqual(r.match('GET', '/notes/n_3').params, { id: 'n_3' });
  assert.deepEqual(r.match('PUT', '/notes/n_3').allowed, ['GET', 'DELETE']);
  assert.equal(r.match('GET', '/nope'), null);
  assert.deepEqual(r.match('GET', '/notes/a%20b').params, { id: 'a b' });
});

test('handler chains', async () => {
  const seen = [];
  await runChain([async (c, next) => { seen.push(1); await next(); seen.push(3); }, async () => seen.push(2)], {});
  assert.deepEqual(seen, [1, 2, 3]);
});
