// Phase 27: long file writes say which file is being written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partialPath } from '../src/providers/types.ts';

test('partialPath reads the file name from arguments still arriving', () => {
  assert.equal(partialPath('{"path":"notes/plan.md","content":"# Plan\\n- one'), 'plan.md');
  assert.equal(partialPath('{"content":"abc", "path" : "C:\\\\work\\\\a \\"b\\".txt"'), 'a "b".txt');
  assert.equal(partialPath('{"path":"notes/pl'), undefined, 'not complete yet');
  assert.equal(partialPath('{"content":"x"}'), undefined);
});
