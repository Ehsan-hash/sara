import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/inv.js', import.meta.url));
const stock = fileURLToPath(new URL('./stock.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('table is still the default', () => {
  const r = run('list', stock);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trimEnd(), 'NAME         QTY\nBolt, small  120\nNut "hex"      3\nWasher         0\nHinge         14');
});
test('csv with quoting', () => {
  const r = run('list', stock, '--format', 'csv');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trimEnd(), 'sku,name,qty\nA1,"Bolt, small",120\nB2,"Nut ""hex""",3\nC3,Washer,0\nD4,Hinge,14');
});
test('--format=csv and --low together, any order', () => {
  const r = run('list', stock, '--low', '5', '--format=csv');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trimEnd(), 'sku,name,qty\nB2,"Nut ""hex""",3\nC3,Washer,0');
});
test('json', () => {
  const r = run('list', stock, '--format', 'json', '--low', '15');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [{ sku: 'B2', name: 'Nut "hex"', qty: 3 }, { sku: 'C3', name: 'Washer', qty: 0 }, { sku: 'D4', name: 'Hinge', qty: 14 }]);
  assert.ok(r.stdout.includes('\n  {'), 'indented with 2 spaces');
});
test('--low with the table', () => {
  const r = run('list', stock, '--low=1');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trimEnd(), 'NAME    QTY\nWasher    0');
});
test('unknown format', () => {
  const r = run('list', stock, '--format', 'xml');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown format: xml/);
  assert.equal(r.stdout, '');
});
test('usage errors', () => {
  assert.equal(run('show', stock).status, 1);
  assert.equal(run('list').status, 1);
});
