import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';

test('a plain route', () => {
  const home = () => 'home';
  const r = createRouter().add('GET', '/about', home);
  assert.deepEqual(r.match('GET', '/about'), { handler: home, params: {} });
  assert.equal(r.match('GET', '/nope'), null);
});

test('a parameter', () => {
  const show = () => 'show';
  const r = createRouter().add('GET', '/users/:id', show);
  assert.deepEqual(r.match('GET', '/users/42'), { handler: show, params: { id: '42' } });
});
