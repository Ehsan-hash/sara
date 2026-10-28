import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from '../src/merge.js';
import { fromEnv } from '../src/env.js';
import { loadConfig } from '../src/config.js';

test('deep merge', () => {
  assert.deepEqual(merge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 5 } }), { a: 1, b: { c: 5, d: 3 } });
  assert.deepEqual(merge({ x: { y: { z: 1, w: 2 } } }, { x: { y: { z: 9 } } }), { x: { y: { z: 9, w: 2 } } });
});
test('arrays are replaced', () => {
  assert.deepEqual(merge({ list: [1, 2] }, { list: [3] }), { list: [3] });
});
test('null removes, undefined is ignored', () => {
  assert.deepEqual(merge({ a: 1, b: 2 }, { b: null }), { a: 1 });
  assert.deepEqual(merge({ db: { host: 'x', port: 1 } }, { db: { port: null } }), { db: { host: 'x' } });
  assert.deepEqual(merge({ a: 1 }, { a: undefined }), { a: 1 });
});
test('inputs are not changed', () => {
  const base = { db: { host: 'a', opts: { ssl: false } }, list: [1] };
  const over = { db: { host: 'b', opts: { ssl: true } }, list: [2] };
  const copyBase = structuredClone(base);
  const copyOver = structuredClone(over);
  merge(base, over);
  assert.deepEqual(base, copyBase);
  assert.deepEqual(over, copyOver);
});
test('environment variables', () => {
  assert.deepEqual(
    fromEnv({ APP_DB__HOST: 'db.local', APP_DB__PORT: '5432', APP_LOG_LEVEL: 'debug', APP_DEBUG: 'true', APP_RATIO: '1.5', APP_OFFSET: '-3', APP_SAFE: 'false', APP_NAME: 'abc1', OTHER: 'x', APPX_Y: 'z' }, 'APP'),
    { db: { host: 'db.local', port: 5432 }, log_level: 'debug', debug: true, ratio: 1.5, offset: -3, safe: false, name: 'abc1' },
  );
});
test('all three layers', () => {
  const defaults = { db: { host: 'localhost', port: 5432, ssl: false }, log_level: 'info', tags: ['a'] };
  assert.deepEqual(loadConfig(defaults, { db: { ssl: true }, tags: ['b', 'c'] }, { APP_DB__HOST: 'prod' }), { db: { host: 'prod', port: 5432, ssl: true }, log_level: 'info', tags: ['b', 'c'] });
  assert.deepEqual(defaults.db, { host: 'localhost', port: 5432, ssl: false });
  assert.deepEqual(loadConfig({ a: 1 }, {}, { MY_A: '2' }, 'MY'), { a: 2 });
});
