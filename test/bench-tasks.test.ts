// Phase 58: the repository-task benchmark's helpers and the shape of its task folders. (The full
// check that every task fails on its starting code and passes on the reference solution needs
// Python and takes a while: node scripts/bench-tasks.ts --mode verify.)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { filesFromReply, listFiles, loadTasks, projectSize, rawPrompt, safePath, taskText, TIERS } from '../scripts/bench-tasks.ts';
import { claimsSummary, tasksSummary } from '../scripts/publish-results.ts';

const BENCH = join(import.meta.dirname, '..', 'bench');

test('bench tasks: every task has a start, hidden tests and a reference solution outside the task', () => {
  const tasks = loadTasks();
  assert.ok(tasks.length >= 12 && tasks.length <= 20, `${tasks.length} tasks`);
  for (const t of tasks) {
    assert.ok(['bug', 'feature', 'refactor'].includes(t.kind), t.id);
    assert.ok(['js', 'python'].includes(t.lang), t.id);
    assert.ok(t.prompt.length > 40 && t.hidden.length > 1, t.id);
    assert.ok(existsSync(join(BENCH, 'tasks', t.id, 'start')), `${t.id} start`);
    assert.ok(listFiles(join(BENCH, 'tasks', t.id, 'hidden')).length, `${t.id} hidden`);
    assert.ok(listFiles(join(BENCH, 'solutions', t.id)).length, `${t.id} solution`);
    // The workspace she gets never holds the hidden tests or the solution.
    assert.ok(!listFiles(join(BENCH, 'tasks', t.id, 'start')).some((f) => /hidden|solution/i.test(f)), t.id);
  }
  assert.ok(tasks.some((t) => t.lang === 'python') && tasks.some((t) => t.kind === 'refactor'));
});

test('bench tasks: the agent and raw prompts', () => {
  const t = loadTasks()[0];
  assert.match(taskText(t), /node --test|unittest/);
  const p = rawPrompt(t, [{ path: 'src/a.js', text: 'export const a = 1;\n' }, { path: 'README.md', text: '```sh\nnpm test\n```\n' }]);
  assert.match(p, /### src\/a\.js\n```\nexport const a = 1;\n```/);
  assert.match(p, /### README\.md\n````\n```sh/, 'a file with a fence inside gets a longer fence');
});

test('bench tasks: files are read back from a raw reply', () => {
  const reply = [
    'Here are the fixes.',
    '',
    '### src/money.js',
    '```js',
    'export const x = 1;',
    '```',
    '',
    '**src/cart.js**',
    '',
    '```javascript',
    'line 1',
    '',
    'line 3',
    '```',
    'File: `lib/util.py`',
    '```python',
    'def f():',
    '    return 1',
    '```',
    'Not a file: some prose',
    '```',
    'ignored',
    '```',
  ].join('\n');
  assert.deepEqual(filesFromReply(reply), [
    { path: 'src/money.js', text: 'export const x = 1;\n' },
    { path: 'src/cart.js', text: 'line 1\n\nline 3\n' },
    { path: 'lib/util.py', text: 'def f():\n    return 1\n' },
  ]);
});

test('bench tasks: written paths stay inside the project', () => {
  assert.equal(safePath('src/a.js'), 'src/a.js');
  assert.equal(safePath('./src\\b.js'), 'src/b.js');
  for (const bad of ['../x.js', '/etc/passwd', 'C:/x.js', 'src/../../x', '']) assert.equal(safePath(bad), undefined, bad);
});

test('bench tasks: the published summary counts by kind and keeps no failure details', () => {
  const run = { task: 'a', title: 'A', kind: 'bug', lang: 'js', pass: true, seconds: 3, toolCalls: 4, filesChanged: 2 };
  const s = tasksSummary(
    { benchmark: 'b', mode: 'agent', model: 'm', at: '2026-10-28T00:00:00.000Z', finished: '2026-10-28T00:10:00.000Z', python: 'Python 3', platform: 'win32', tasks: 2, pass: 1, pass1: 50, seconds: 60, runs: [run, { ...run, task: 'b', kind: 'feature', pass: false, detail: 'secret stack trace' } as typeof run] },
    'x.json',
  );
  assert.deepEqual(s.byKind, { bug: { passed: 1, of: 1 }, feature: { passed: 0, of: 1 } });
  assert.deepEqual(s.failed, ['b']);
  assert.ok(!JSON.stringify(s).includes('secret'));
});

test('bench projects (Phase 62): real-size projects with hidden tests and a reference solution outside the task', () => {
  const projects = loadTasks(TIERS.projects.tasks);
  assert.ok(projects.length >= 3, `${projects.length} projects`);
  for (const t of projects) {
    assert.equal(t.root, TIERS.projects.tasks);
    const start = join(TIERS.projects.tasks, t.id, 'start');
    const size = projectSize(start);
    assert.ok(size.files >= 15 && size.files <= 40, `${t.id}: ${size.files} files`);
    assert.ok(size.lines >= 500, `${t.id}: ${size.lines} lines`);
    assert.ok(listFiles(join(TIERS.projects.tasks, t.id, 'hidden')).some((f) => f.endsWith('.test.js')), `${t.id} hidden`);
    assert.ok(listFiles(join(TIERS.projects.solutions, t.id)).length, `${t.id} solution`);
    assert.ok(!listFiles(start).some((f) => /hidden|solution/i.test(f)), t.id);
    assert.ok(listFiles(start).some((f) => /^test\//.test(f)), `${t.id} has its own tests`);
  }
  // Same ids never appear in both tiers (results are told apart by tier and id).
  const small = new Set(loadTasks().map((t) => t.id));
  assert.ok(projects.every((t) => !small.has(t.id)));
});

test('claims summary (Phase 62): scores per language and set, no reply texts', () => {
  const s = claimsSummary(
    {
      at: '2026-10-28T06:00:00.000Z',
      judge: 'qwen3.5:9b at http://127.0.0.1:11434/v1 (warm-up 1 s)',
      judgeTimeoutMs: 8000,
      judgeStats: { calls: 3, timeouts: 0, errors: 0, medianMs: 120, maxMs: 200 },
      table: { heldout: { en: { n: 40, patterns: { tp: 12, fp: 1, fn: 8, tn: 19, precision: 0.923, recall: 0.6 }, withJudge: { tp: 19, fp: 1, fn: 1, tn: 19, precision: 0.95, recall: 0.95 }, askedJudge: 14 } } },
      rows: [{ text: 'secret reply text' }],
    },
    'x.json',
  );
  assert.equal(s.judge, 'qwen3.5:9b');
  assert.equal(s.sets.heldout.en.withJudge?.recall, 0.95);
  assert.ok(!JSON.stringify(s).includes('secret'));
});
