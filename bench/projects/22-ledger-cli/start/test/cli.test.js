import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { sandbox } from './helpers.js';

let s;
before(async () => {
  s = sandbox();
  await s.cli('add', '2,500.00', 'Salary', '--category', 'Salary', '--date', '2026-03-01', '-q');
  await s.cli('add', '42.10', 'Groceries', '-c', 'Food & Drink', '--date', '2026-03-02', '-t', 'home', '-q');
  await s.cli('add', '(18.00)', 'Taxi', '--category', 'transport', '--date', '2026-03-10', '--tag', 'work', '--tag', 'late', '-q');
});
after(() => s.cleanup());

test('list as json', async () => {
  const r = await s.cli('list', '--format', 'json');
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).map((e) => [e.description, e.amount, e.category]), [['Salary', 250000, 'income'], ['Groceries', 4210, 'food-drink'], ['Taxi', -1800, 'transport']]);
});

test('filters with a space before the value', async () => {
  const r = await s.cli('list', '--since', '2026-03-02', '--format', 'json');
  assert.deepEqual(JSON.parse(r.out).map((e) => e.description), ['Groceries', 'Taxi']);
  assert.deepEqual(JSON.parse((await s.cli('list', '--tag', 'work', '-f', 'json')).out).map((e) => e.description), ['Taxi']);
});

test('report and balance', async () => {
  const r = await s.cli('report', '--format', 'csv');
  assert.match(r.out, /^category,in,out,net,count\n/);
  assert.match(r.out, /transport,0\.00,-18\.00,-18\.00,1/);
  assert.equal((await s.cli('balance')).out, '2,524.10\n');
});

test('import a CSV', async () => {
  writeFileSync(join(s.dir, 'bank.csv'), 'date,description,amount\n2026-03-05,"Books, used",-12.00\n2026-03-06,Refund,"1,000.00"\n');
  const r = await s.cli('import', 'bank.csv', '--category', 'misc');
  assert.equal(r.out, 'imported 2 entries\n');
});

test('errors', async () => {
  assert.equal((await s.cli('add', 'abc', 'x')).code, 1);
  assert.equal((await s.cli('list', '--nope')).code, 2);
  assert.equal((await s.cli('frobnicate')).code, 2);
});
