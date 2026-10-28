import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replyTo } from '../handlers.js';

test('commands answer', () => {
  assert.match(replyTo('/start', 'Ana'), /Hi Ana/);
  assert.match(replyTo('/help'), /\/echo/);
  assert.equal(replyTo('/echo hello there'), 'hello there');
  assert.equal(replyTo('/echo@SomeBot hi'), 'hi');
  assert.match(replyTo('/nope'), /don't know \/nope/);
});

test('plain text is echoed, empty text is ignored', () => {
  assert.equal(replyTo('hey'), 'You said: hey');
  assert.equal(replyTo('   '), null);
});
