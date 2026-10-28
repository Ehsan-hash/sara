// Phase 39 exit check: a multi-part coding task (plan → code → test → review) finishes with three
// helpers; the tester's failing run goes back to the coder and is fixed; her report matches the
// receipts. Plus: helper claims are checked, approvals gate risky tools, stop / redirect / limits,
// and the owner's own helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { cleanHelpers, cleanLimits, createTeamTools, lastRunFailed, receiptLines, TeamManager, teamHelpers, verdict } from '../src/team.ts';
import { editFileTool, listDir, readFileTool, searchTool, shellTool, writeFileTool } from '../src/tools/builtin.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { call, makeApp, ROOT, tempDir, text } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-28T15:00:00Z') };
const app = makeApp(dir, clock);
for (const t of [listDir, readFileTool, writeFileTool, editFileTool, searchTool, shellTool]) app.tools.add(t);
app.team = new TeamManager(app, app.store.db);
for (const t of createTeamTools(() => app)) app.tools.add(t);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';
const AUTO = { write_file: 'auto', edit_file: 'auto', shell: 'auto', read_file: 'auto', list_dir: 'auto', search: 'auto', team_task: 'auto' } as const;
before(async () => {
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'America/Chicago', disclosureAcceptedAt: clock.now.toISOString(), toolPermissions: { ...AUTO } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const api = (path: string, method = 'GET', body?: unknown) =>
  fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });

const BUGGY = "export function add(a, b) {\n  return a - b;\n}\n";
const FIXED = "export function add(a, b) {\n  return a + b;\n}\n";
const TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n";
const NODE = JSON.stringify(process.execPath);

test('exit check: plan → code → test (fails) → fix → test (passes) → review; receipts match', async () => {
  const conv = app.store.createConversation({ mode: 'coding' });
  const ws = workspaceDir(dir, conv.workspace);
  app.requests.length = 0;
  app.script.push(
    // The lead's plan (planning job).
    text(JSON.stringify({ steps: [
      { helper: 'coder', title: 'Write add() with a test', instructions: 'Create math.js exporting add(a, b) and math.test.js testing add(2, 3) === 5. Use ES modules.' },
      { helper: 'tester', title: 'Run the tests', instructions: 'Run the tests with node --test and report.' },
      { helper: 'reviewer', title: 'Review math.js', instructions: 'Review math.js and math.test.js.' },
    ] })),
    // Coder: writes a bug, then reports.
    [call('c1', 'write_file', { path: 'math.js', content: BUGGY }), call('c2', 'write_file', { path: 'math.test.js', content: TEST }), call('c3', 'write_file', { path: 'package.json', content: '{"type":"module"}' })],
    text('Created math.js with add() and math.test.js with a test.'),
    // Tester: the run fails.
    [call('t1', 'shell', { command: `${NODE} --test` })],
    text('Ran node --test: 1 failing test (add(2, 3) returned -1). VERDICT: FAIL: add subtracts instead of adding'),
    // Coder fix (sent back by the lead).
    [call('f1', 'edit_file', { path: 'math.js', old_string: 'a - b', new_string: 'a + b' })],
    text('Fixed add() in math.js to add instead of subtract.'),
    // Tester again: passes.
    [call('t2', 'shell', { command: `${NODE} --test` })],
    text('Ran node --test again: all tests pass. VERDICT: PASS'),
    // Reviewer approves.
    [call('r1', 'read_file', { path: 'math.js' })],
    text('add() is correct and small; the test covers it. VERDICT: APPROVE'),
    // Her report (quick job).
    text('Done! The coder wrote add() with a test, the tester caught a bug (it subtracted), the coder fixed it, and the tests pass now. The reviewer approved it.'),
  );
  const t = app.team!.start(conv.id, 'Write an add(a, b) function in math.js with a test, make sure the tests pass, and get it reviewed.');
  const done = await app.team!.finished(t.id);
  assert.equal(done.status, 'done', JSON.stringify(app.team!.log(t.id).map((l) => l.text)));
  assert.deepEqual(
    done.steps.map((s) => `${s.helper}:${s.status}${s.because ? ` (${s.because})` : ''}`),
    ['coder:done', 'tester:done', 'coder:done (Tester found a failure)', 'tester:done (after the fix)', 'reviewer:done'],
  );
  // Real files, really fixed; the real test run failed and then passed.
  assert.equal(readFileSync(join(ws, 'math.js'), 'utf8'), FIXED);
  const runs = done.steps.flatMap((s) => s.receipts).filter((r) => r.name === 'shell');
  assert.match(runs[0].output, /^\[exit code 1/);
  assert.match(runs[1].output, /^\[exit code 0/);
  assert.equal(lastRunFailed(done.steps[1].receipts)?.name, 'shell');
  assert.equal(lastRunFailed(done.steps[3].receipts), undefined);
  // Three different helpers, each with its own instructions and no persona.
  const systems = app.requests.map((r) => String(r.messages[0].content));
  assert.ok(systems.some((s) => /^You are Coder, the coder on a small team led by Sara/.test(s)));
  assert.ok(systems.some((s) => /^You are Tester, the tester/.test(s)));
  assert.ok(systems.some((s) => /^You are Reviewer, the reviewer/.test(s)));
  assert.ok(systems.filter((s) => /^You are (Coder|Tester|Reviewer)/.test(s)).every((s) => /not a companion/.test(s) && /minors/.test(s)));
  // The fix step was told exactly what failed.
  const fixReq = app.requests.find((r) => /Your part: Fix what the tester found/.test(String(r.messages[1]?.content)));
  assert.match(String(fixReq!.messages[1].content), /exit code 1/);
  // Her report in the chat matches the receipts.
  const msg = app.store.messages(conv.id).filter((m) => m.role === 'assistant').at(-1)!;
  assert.deepEqual(msg.meta?.team, { id: t.id, status: 'done' });
  assert.match(msg.content, /^Done! The coder wrote add\(\)/);
  assert.match(msg.content, /What actually happened:\n• Files written or changed: math\.js, math\.test\.js, package\.json\n• Coder ran|• Tester ran `.*--test`: exit code 1\n• Tester ran `.*--test`: exit code 0/);
  assert.ok(done.undo, 'an undo point was made');
});

test("a helper's claims are checked: no receipt → asked to correct; still unbacked → left out of her report", async () => {
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.push(
    text('I wrote the docs file README.md and all tests pass.'),
    text('I created README.md and committed it.'),
    text('Your team made no changes.'),
  );
  const t = app.team!.start(conv.id, 'Write a README for the project.', { plan: [{ helper: 'writer', title: 'Write README.md', instructions: 'Write a README.md.' }] });
  const done = await app.team!.finished(t.id);
  const step = done.steps[0];
  assert.ok(step.unverified.length >= 1);
  assert.ok(app.team!.log(t.id).some((l) => /Claims without receipts/.test(l.text)));
  const msg = app.store.messages(conv.id).at(-1)!;
  assert.match(msg.content, /No files changed and no commands ran/);
});

test('approvals gate risky tools; declining is a receipt, not a crash', async () => {
  app.settings.update({ toolPermissions: { ...AUTO, shell: 'ask' } });
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('s1', 'shell', { command: 'echo hi' })], text('The command was not allowed. VERDICT: FAIL: could not run'), text('ok'));
  const t = app.team!.start(conv.id, 'Run echo hi and report.', { plan: [{ helper: 'tester', title: 'Run it', instructions: 'Run echo hi.' }] });
  for (let i = 0; i < 50 && !app.team!.approvals(t.id).length; i++) await new Promise((r) => setTimeout(r, 20));
  const [pending] = app.team!.approvals(t.id);
  assert.equal(pending.tool, 'shell');
  assert.equal(pending.summary, '$ echo hi');
  const view = await (await api(`/api/team/${t.id}`)).json();
  assert.equal(view.approvals[0].id, pending.id);
  assert.equal((await api(`/api/approvals/${pending.id}`, 'POST', { approved: false })).status, 200);
  const done = await app.team!.finished(t.id);
  assert.equal(done.steps[0].receipts[0].status, 'denied');
  app.settings.update({ toolPermissions: { ...AUTO } });
});

test('stop a helper (the lead goes on), redirect one, stop the task; limits stop it', async () => {
  const conv = app.store.createConversation({ mode: 'coding' });
  // A model that waits until stopped (for the first helper), then answers.
  let hold: (() => void) | undefined;
  const orig = app.providerFactory!;
  app.providerFactory = (config) => {
    const p = orig(config);
    return {
      config,
      listModels: () => p.listModels(),
      async *stream(req) {
        if (/Your part: Slow part/.test(String(req.messages[1]?.content)) && !hold) {
          await new Promise<void>((resolve, reject) => {
            hold = resolve;
            req.signal?.addEventListener('abort', () => reject(req.signal!.reason), { once: true });
          });
        }
        yield* p.stream(req);
      },
    };
  };
  app.script.push(text('Wrote the second part. VERDICT: PASS'), text('Report.'));
  const t = app.team!.start(conv.id, 'Two parts, the first one slow.', { plan: [{ helper: 'coder', title: 'Slow part', instructions: 'x' }, { helper: 'writer', title: 'Second part', instructions: 'y' }] });
  for (let i = 0; i < 100 && !hold; i++) await new Promise((r) => setTimeout(r, 20));
  const steps = app.team!.get(t.id)!.steps;
  assert.equal((await api(`/api/team/${t.id}/steps/${steps[1].id}/message`, 'POST', { text: 'Keep it short.' })).status, 200, 'a waiting helper can get a message');
  assert.equal((await api(`/api/team/${t.id}/steps/${steps[0].id}/stop`, 'POST')).status, 200);
  const done = await app.team!.finished(t.id);
  assert.deepEqual(done.steps.map((s) => s.status), ['stopped', 'done']);
  assert.match(String(app.requests.at(-2)!.messages.at(-1)!.content), /Message from Alex.*Keep it short\./);
  app.providerFactory = orig;
  // The whole task stopped.
  hold = undefined;
  app.providerFactory = (config) => ({ config, listModels: async () => [], stream: (req) => (async function* () { await new Promise((_, rej) => req.signal?.addEventListener('abort', () => rej(req.signal!.reason), { once: true })); yield* []; })() });
  const t2 = app.team!.start(conv.id, 'Something long running.', { plan: [{ helper: 'coder', title: 'Long', instructions: 'x' }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await api(`/api/team/${t2.id}/stop`, 'POST')).status, 200);
  assert.equal((await app.team!.finished(t2.id)).status, 'stopped');
  app.providerFactory = orig;
  // A spending limit stops it with a plain reason.
  app.script.push([call('w', 'write_file', { path: 'big.txt', content: 'x'.repeat(60_000) })], text('more'), text('Report.'));
  const t3 = app.team!.start(conv.id, 'Write something big.', { limits: { tokens: 10_000 }, plan: [{ helper: 'writer', title: 'Big', instructions: 'Write big.txt' }] });
  const d3 = await app.team!.finished(t3.id);
  assert.equal(d3.status, 'limit');
  assert.match(app.store.messages(conv.id).at(-1)!.content, /spending limit|What actually happened/);
});

test('your own helpers: name, job, instructions, model and tools from a pick-list', async () => {
  const r = await api('/api/team/settings', 'PUT', { helpers: [{ name: 'Docs Dana', role: 'writer', instructions: 'Use British spelling.', tools: ['read_file', 'write_file', 'nope'] }], limits: { minutes: 45, tokens: 200000 } });
  assert.equal(r.status, 200);
  const v = await (await api('/api/team')).json();
  const dana = v.helpers.find((h: { name: string }) => h.name === 'Docs Dana');
  assert.equal(dana.role, 'writer');
  assert.deepEqual(dana.tools, ['read_file', 'write_file']);
  assert.match(dana.instructions, /British spelling/);
  assert.equal(v.limits.minutes, 45);
  assert.ok(v.helpers.some((h: { id: string }) => h.id === 'tester'));
  assert.equal((await api('/api/team/settings', 'PUT', { helpers: [{ name: '', role: 'writer' }] })).status, 400);
  assert.equal((await api('/api/team/settings', 'PUT', { helpers: [{ name: 'X', role: 'boss' }] })).status, 400);
  assert.equal(teamHelpers(app).filter((h) => h.custom).length, 1);
  assert.deepEqual(cleanLimits({ minutes: 1, tokens: 'x' }), { minutes: 2, tokens: 400000, steps: 14 });
  assert.throws(() => cleanHelpers('nope', []), /list/);
  // Verdicts and receipt lines.
  assert.deepEqual(verdict('ok\nVERDICT: CHANGES NEEDED: rename x'), { ok: false, detail: 'rename x' });
  assert.deepEqual(verdict('**VERDICT:** PASS'), { ok: true, detail: 'PASS' });
  assert.equal(verdict('no verdict'), undefined);
  assert.deepEqual(receiptLines([{ id: 1, taskId: 1, idx: 0, helper: 'coder', title: '', instructions: '', status: 'done', because: null, report: '', receipts: [{ name: 'git_commit', status: 'ok', args: { message: 'Add add()' }, output: '' }], unverified: [], tokens: 0, startedAt: null, endedAt: null }], new Map([['coder', 'Coder']])), ['Coder committed: Add add()']);
});

test('Sara starts a team task with her tool, and can check on it', async () => {
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.length = 0;
  app.script.push(text('{"steps":[{"helper":"writer","title":"Note","instructions":"Write note.txt"}]}'), [call('n', 'write_file', { path: 'note.txt', content: 'hi' })], text('Wrote note.txt.'), text('All done.'));
  const out = await app.tools.get('team_task')!.run({ goal: 'Write a short note into note.txt' }, { workspaceDir: dir, signal: new AbortController().signal, sandbox: app.sandbox, conversationId: conv.id });
  assert.match(String(out), /^Team task #\d+ started/);
  const id = Number(/#(\d+)/.exec(String(out))![1]);
  await app.team!.finished(id);
  assert.match(String(await app.tools.get('team_status')!.run({ task_id: id }, { workspaceDir: dir, signal: new AbortController().signal, sandbox: app.sandbox })), /Team task #\d+ \(done\).*\n1\. Writer: Note \[done\]/);
});
