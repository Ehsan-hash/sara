import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';
import { createBus } from '../src/bus.js';

test('on returns an unsubscribe function', () => {
  const e = new Emitter();
  let n = 0;
  const off = e.on('x', () => n++);
  e.emit('x');
  off();
  off();
  assert.equal(e.emit('x'), 0);
  assert.equal(n, 1);
});
test('once runs one time', () => {
  const e = new Emitter();
  const seen = [];
  e.once('x', (v) => seen.push(v));
  assert.equal(e.emit('x', 'a'), 1);
  assert.equal(e.emit('x', 'b'), 0);
  assert.deepEqual(seen, ['a']);
  assert.equal(e.listenerCount('x'), 0);
});
test('off removes once listeners by the original function', () => {
  const e = new Emitter();
  let n = 0;
  const fn = () => n++;
  e.once('x', fn);
  assert.equal(e.off('x', fn), true);
  assert.equal(e.off('x', fn), false);
  e.emit('x');
  assert.equal(n, 0);
});
test('off returns false for unknown listeners and events', () => {
  const e = new Emitter();
  assert.equal(e.off('nope', () => {}), false);
});
test('listenerCount', () => {
  const e = new Emitter();
  e.on('x', () => {});
  e.on('x', () => {});
  e.once('x', () => {});
  assert.equal(e.listenerCount('x'), 3);
  assert.equal(e.listenerCount('y'), 0);
});
test('emit works on a snapshot', () => {
  const e = new Emitter();
  const calls = [];
  const second = () => calls.push('second');
  e.on('x', () => {
    calls.push('first');
    e.on('x', () => calls.push('added'));
    e.off('x', second);
  });
  e.on('x', second);
  assert.equal(e.emit('x'), 2);
  assert.deepEqual(calls, ['first', 'second']);
  calls.length = 0;
  e.emit('x');
  assert.deepEqual(calls, ['first', 'added']);
});
test('listeners run in order with arguments', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (a, b) => seen.push(['1', a, b]));
  e.once('x', (a, b) => seen.push(['2', a, b]));
  e.emit('x', 3, 4);
  assert.deepEqual(seen, [['1', 3, 4], ['2', 3, 4]]);
});
test('bus channels have the full API and stay apart', () => {
  const bus = createBus();
  const chat = bus.channel('chat');
  const news = bus.channel('news');
  const seen = [];
  const off = chat.on('msg', (m) => seen.push(`chat ${m}`));
  news.once('msg', (m) => seen.push(`news ${m}`));
  assert.equal(chat.listenerCount('msg'), 1);
  assert.equal(news.listenerCount('msg'), 1);
  chat.emit('msg', 'hi');
  news.emit('msg', 'a');
  news.emit('msg', 'b');
  off();
  assert.equal(chat.emit('msg', 'gone'), 0);
  assert.deepEqual(seen, ['chat hi', 'news a']);
  const fn = () => seen.push('x');
  chat.once('ping', fn);
  assert.equal(chat.off('ping', fn), true);
  assert.equal(bus.emitter.listenerCount('chat:ping'), 0);
});
