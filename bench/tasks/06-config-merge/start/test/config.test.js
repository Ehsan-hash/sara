import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('file overrides defaults', () => {
  assert.deepEqual(loadConfig({ port: 80, name: 'app' }, { port: 8080 }), { port: 8080, name: 'app' });
});

test('nested settings are merged', () => {
  assert.deepEqual(loadConfig({ db: { host: 'localhost', port: 5432 } }, { db: { port: 6543 } }), { db: { host: 'localhost', port: 6543 } });
});
