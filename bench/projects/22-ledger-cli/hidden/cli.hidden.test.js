import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { box, json } from './helpers.js';

let b;
before(async () => {
  b = box();
  await b.cli('add', '3,000.00', 'Salary', '--category=income', '--date=2026-03-01', '-q');
  await b.cli('add', '-12.50', 'Coffee beans', '--date', '2026-03-03', '-q');
  await b.cli('add', '-60.00', 'Dinner', '--category', 'food', '--date', '2026-03-31', '-q');
  await b.cli('add', '-5', 'Snack', '--category', 'food', '--date', '2026-04-01', '-q');
  await b.cli('add', '--date', '2026-02-28', '-q', '-2.00', '--', '-weird- name');
});
after(() => b.cleanup());

test('hidden: negative amounts on the command line', async () => {
  const r = await b.cli('add', '-4.20', 'Tea', '-q', '--date', '2026-01-15');
  assert.equal(r.code, 0, r.err);
  const all = json(await b.cli('list', '--format=json'));
  assert.deepEqual(all.map((e) => [e.description, e.amount]).sort(), [['-weird- name', -200], ['Coffee beans', -1250], ['Dinner', -6000], ['Salary', 300000], ['Snack', -500], ['Tea', -420]].sort());
  assert.deepEqual(json(await b.cli('list', '--max', '-50', '-f', 'json')).map((e) => e.description), ['Dinner']);
});

test('hidden: --until and --month include the last day', async () => {
  assert.deepEqual(json(await b.cli('list', '--since', '2026-03-01', '--until', '2026-03-31', '--format', 'json')).map((e) => e.description), ['Salary', 'Coffee beans', 'Dinner']);
  assert.deepEqual(json(await b.cli('list', '--month=2026-03', '--format=json')).map((e) => e.description), ['Salary', 'Coffee beans', 'Dinner']);
  assert.deepEqual(json(await b.cli('list', '--until=today', '--since', '-1d', '-f', 'json')).map((e) => e.description), ['Dinner']);
  assert.equal((await b.cli('balance', '--until', '2026-03-03', '--since', '2026-03-03')).out, '-12.50\n');
});

test('hidden: report with = options', async () => {
  const r = await b.cli('report', '--by=month', '--since=2026-03-01', '--until=2026-04-01', '--format=json');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json(r).map((x) => [x.key, x.net]), [['2026-03', 292750], ['2026-04', -500]]);
});

test('hidden: import big amounts', async () => {
  writeFileSync(join(b.dir, 'bank.csv'), 'date,description,amount,category\n2026-03-20,House,"-1,234,567.89",home\n2026-03-21,Bonus,"2,000,000.00",\n');
  const r = await b.cli('import', 'bank.csv');
  assert.equal(r.code, 0, r.err);
  assert.equal((await b.cli('balance', '--since', '2026-03-20', '--until', '2026-03-21')).out, '765,432.11\n');
});
