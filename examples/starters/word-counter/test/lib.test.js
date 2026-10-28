import assert from 'node:assert/strict';
import test from 'node:test';
import { count } from '../lib.js';

test('counts words, lines and characters', () => {
  assert.deepEqual(count('hello world\nbye\n'), { words: 3, lines: 2, characters: 16 });
  assert.deepEqual(count(''), { words: 0, lines: 0, characters: 0 });
  assert.equal(count('héllo').characters, 5);
});
