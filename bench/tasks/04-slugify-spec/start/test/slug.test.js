import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('spaces become dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('punctuation goes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});
