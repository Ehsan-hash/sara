import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';

test('on and emit', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (v) => seen.push(v));
  assert.equal(e.emit('x', 1), 1);
  assert.deepEqual(seen, [1]);
});
