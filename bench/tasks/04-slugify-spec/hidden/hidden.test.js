import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, uniqueSlug } from '../src/slug.js';

test('punctuation and spaces', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  --Already--Slugged--  '), 'already-slugged');
});
test('accents, ß and &', () => {
  assert.equal(slugify('Crème Brûlée & Café'), 'creme-brulee-and-cafe');
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('Rock&Roll'), 'rock-and-roll');
  assert.equal(slugify('Ünïcödé 2026'), 'unicode-2026');
});
test('length limit keeps whole words', () => {
  assert.equal(slugify('one two three four', { maxLength: 9 }), 'one-two');
  assert.equal(slugify('one two three four', { maxLength: 8 }), 'one-two');
  assert.equal(slugify('one two three four', { maxLength: 7 }), 'one-two');
  assert.equal(slugify('one two three four', { maxLength: 13 }), 'one-two-three');
  assert.equal(slugify('abcdefghij', { maxLength: 4 }), 'abcd');
});
test('default limit is 60 and 0 means none', () => {
  const long = Array.from({ length: 30 }, () => 'word').join(' ');
  const s = slugify(long);
  assert.ok(s.length <= 60, s);
  assert.ok(s.endsWith('word'), s);
  assert.equal(slugify(long, { maxLength: 0 }).length, 149);
});
test('custom separator', () => {
  assert.equal(slugify('A b  C!', { separator: '_' }), 'a_b_c');
  assert.equal(slugify('one two three', { separator: '_', maxLength: 9 }), 'one_two');
});
test('uniqueSlug', () => {
  assert.equal(uniqueSlug('Hello World', new Set()), 'hello-world');
  assert.equal(uniqueSlug('Hello World', new Set(['hello-world', 'hello-world-2'])), 'hello-world-3');
  assert.equal(uniqueSlug('Hello World', new Set(['hello_world']), { separator: '_' }), 'hello_world-2');
});
