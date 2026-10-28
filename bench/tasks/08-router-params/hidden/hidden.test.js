import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';

const h = (name) => Object.assign(() => name, { label: name });

test('plain, params, trailing slash, query and decoding', () => {
  const list = h('list');
  const show = h('show');
  const r = createRouter().add('GET', '/users', list).add('GET', '/users/:id', show);
  assert.deepEqual(r.match('GET', '/users'), { handler: list, params: {} });
  assert.deepEqual(r.match('GET', '/users/'), { handler: list, params: {} });
  assert.deepEqual(r.match('GET', '/users/42/'), { handler: show, params: { id: '42' } });
  assert.deepEqual(r.match('GET', '/users/5?tab=posts'), { handler: show, params: { id: '5' } });
  assert.deepEqual(r.match('GET', '/users/a%20b'), { handler: show, params: { id: 'a b' } });
  assert.equal(r.match('GET', '/users/1/2'), null);
});
test('several params', () => {
  const c = h('comment');
  const r = createRouter().add('GET', '/posts/:post/comments/:n', c);
  assert.deepEqual(r.match('GET', '/posts/hello/comments/3'), { handler: c, params: { post: 'hello', n: '3' } });
});
test('wildcards match the rest, even nothing', () => {
  const files = h('files');
  const r = createRouter().add('GET', '/files/*path', files);
  assert.deepEqual(r.match('GET', '/files/a/b/c.txt'), { handler: files, params: { path: 'a/b/c.txt' } });
  assert.deepEqual(r.match('GET', '/files/'), { handler: files, params: { path: '' } });
  assert.deepEqual(r.match('GET', '/files'), { handler: files, params: { path: '' } });
  assert.deepEqual(r.match('GET', '/files/my%20docs/x'), { handler: files, params: { path: 'my docs/x' } });
  assert.equal(r.match('GET', '/other/a'), null);
});
test('the most specific route wins, whatever the order', () => {
  const byId = h('byId');
  const me = h('me');
  const r = createRouter().add('GET', '/users/:id', byId).add('GET', '/users/me', me);
  assert.equal(r.match('GET', '/users/me').handler, me);
  assert.equal(r.match('GET', '/users/7').handler, byId);
  const wild = h('wild');
  const one = h('one');
  const r2 = createRouter().add('GET', '/f/*rest', wild).add('GET', '/f/:name', one);
  assert.equal(r2.match('GET', '/f/x').handler, one);
  assert.equal(r2.match('GET', '/f/x/y').handler, wild);
  const left = h('left');
  const right = h('right');
  const r3 = createRouter().add('GET', '/:a/b', left).add('GET', '/a/:b', right);
  assert.equal(r3.match('GET', '/a/b').handler, right);
});
test('ties go to the route added first', () => {
  const first = h('first');
  const second = h('second');
  const r = createRouter().add('GET', '/x/:a', first).add('GET', '/x/:b', second);
  assert.deepEqual(r.match('GET', '/x/1'), { handler: first, params: { a: '1' } });
});
test('methods, ANY and HEAD', () => {
  const get = h('get');
  const any = h('any');
  const r = createRouter().add('GET', '/page', get).add('ANY', '/ping', any);
  assert.equal(r.match('POST', '/page'), null);
  assert.equal(r.match('HEAD', '/page').handler, get);
  assert.equal(r.match('DELETE', '/ping').handler, any);
  assert.equal(r.match('GET', '/ping').handler, any);
});
test('add chains', () => {
  const r = createRouter();
  assert.equal(r.add('GET', '/', h('root')), r);
  assert.equal(r.match('GET', '/').handler.label, 'root');
});
