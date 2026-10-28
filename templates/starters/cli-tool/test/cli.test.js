import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { count, topWords } from '../lib.js';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' });

test('count and top words', () => {
  assert.deepEqual(count('one two\nthree\n'), { lines: 2, words: 3, chars: 14 });
  assert.deepEqual(count(''), { lines: 0, words: 0, chars: 0 });
  assert.deepEqual(topWords('the cat and the hat and the bat', 2), [{ word: 'the', times: 3 }, { word: 'and', times: 2 }]);
});

test('files, standard input, --json, --top', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = join(dir, 'a.txt');
  writeFileSync(f, 'hello world\nhello again\n');
  const r = run([f]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^2\t4\t24\t/);
  const j = JSON.parse(run(['--json', '--top', '1'], 'a b a').stdout);
  assert.equal(j.words, 3);
  assert.deepEqual(j.top, [{ word: 'a', times: 2 }]);
});

test('help, bad options and missing files have the right exit codes', () => {
  assert.equal(run(['--help']).status, 0);
  assert.match(run(['--help']).stdout, /Usage:/);
  assert.equal(run(['--nope']).status, 2);
  assert.equal(run(['--top', 'x'], '').status, 2);
  const missing = run(['no-such-file.txt']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no such file/);
});
