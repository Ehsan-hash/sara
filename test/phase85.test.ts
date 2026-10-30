// Phase 85 (harness track M10, docs/design/HARNESS_TRACK.md §3 M10): active recall triggers.
// Signature normalisation, the index (live and the bounded backfill), lessons only from recorded
// evidence, each trigger kind on a match and not on a near miss, the caps, the bracket, "Not
// useful" lowering the weight, the private / other-app / adult-channel / partner rules (M1's rule,
// checked for equivalence), voice notes without the bracket, the off switch, speed, the M9 variant
// and the page (chips, settings, tips, translations, the app cache).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { cleanVariant, variantWords } from '../src/evals.ts';
import { selectMemories } from '../src/memory.ts';
import type { ChatRequest, StreamEvent } from '../src/providers/types.ts';
import { sharedWithApps } from '../src/recall.ts';
import { RunStore, runSettings } from '../src/runs.ts';
import { createSaraServer } from '../src/server.ts';
import type { Tool } from '../src/tools/types.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import {
  backfill,
  errorLine,
  FIRE_AT,
  normalizeCommand,
  normalizeMessage,
  RECALL_MARK,
  recallBracket,
  recallMode,
  recallNote,
  RecallIndex,
  RecallQueue,
  type RecallItem,
  RunWatcher,
  signaturesOf,
  STEP_CAP,
  stepFailed,
  TriggerMatcher,
  TURN_CAP,
} from '../src/triggers.ts';
import { call, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

const NOW = new Date('2026-10-30T15:00:00Z');
const usage = (input: number, output: number): StreamEvent => ({ type: 'usage', input, output });

const FAIL_A = (path: string, line: number) => `[exit code 1, 0.4s (no sandbox)]\n▶ cart\n  ✖ total adds tax (1.2ms)\n    TypeError: Cannot read properties of undefined (reading 'price')\n        at total (${path}:${line}:5)\n        at TestContext.<anonymous> (file:///C:/ws/test/cart.test.js:7:3)\nℹ tests 3\nℹ fail 1`;
const FAIL_B = `[exit code 1, 0.3s (no sandbox)]\n  ✖ total adds tax\n    ReferenceError: taxRate is not defined\n        at total (src/cart.js:4:9)`;
const PASS = `[exit code 0, 0.3s (no sandbox)]\nℹ tests 3\nℹ pass 3\nℹ fail 0`;

interface Setup {
  app: TestApp;
  runs: RunStore;
  recall: RecallIndex;
  dir: string;
  shell: string[];
  ran: string[];
}

function setup(t: { after: (fn: () => void) => void }, opts: { recall?: boolean } = {}): Setup {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: NOW });
  const runs = new RunStore(app.store.db, () => NOW);
  runs.settings = () => runSettings(app.settings.get());
  app.runs = runs;
  const recall = new RecallIndex(app.store.db, () => NOW);
  if (opts.recall !== false) app.recall = recall;
  const shell: string[] = [];
  const ran: string[] = [];
  const shellTool: Tool = {
    spec: { name: 'shell', description: 'shell', parameters: { type: 'object', properties: {} } },
    defaultPermission: 'auto',
    summarize: (a) => `$ ${String(a.command)}`,
    async run(a) {
      ran.push(String(a.command));
      return shell.shift() ?? PASS;
    },
  };
  const editTool: Tool = {
    spec: { name: 'edit_file', description: 'edit', parameters: { type: 'object', properties: {} } },
    defaultPermission: 'auto',
    summarize: (a) => `edit ${String(a.path)}`,
    run: async (a) => `Edited ${String(a.path)} (1 replacement).`,
  };
  app.tools.add(shellTool);
  app.tools.add(editTool);
  app.settings.update({
    providers: [{ id: 'loc', label: 'Local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true }],
    defaultProviderId: 'loc',
    defaultModel: 'fake-small',
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: NOW.toISOString(),
    toolPermissions: { shell: 'auto', edit_file: 'auto' },
  });
  workspaceDir(dir, 'main');
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return { app, runs, recall, dir, shell, ran };
}

async function drain(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const fixScript = (n = 1) => [
  [call(`t${n}a`, 'shell', { command: 'npm test' }), usage(900, 40)],
  [call(`t${n}b`, 'edit_file', { path: 'src/cart.js', old_string: 'item.price', new_string: '(item?.price ?? 0)' }), usage(1100, 60)],
  [call(`t${n}c`, 'shell', { command: 'npm test' }), usage(1200, 30)],
  [...text('Fixed: total() read price from a missing item.'), usage(1300, 20)],
];

/** A coding conversation where `npm test` fails, she edits src/cart.js, and it passes. */
async function fixTurn(s: Setup, opts: { workspace?: string; private?: boolean; channel?: string; path?: string; line?: number } = {}) {
  const conv = s.app.store.createConversation({ mode: 'coding', title: 'Cart', workspace: opts.workspace ?? 'main', ...(opts.private ? { private: true } : {}), ...(opts.channel ? { channel: opts.channel } : {}) });
  s.shell.push(FAIL_A(opts.path ?? 'C:\\Users\\alex\\ws\\src\\cart.js', opts.line ?? 12), PASS);
  s.app.script.push(...fixScript());
  const evs = await drain(runTurn(s.app, conv.id, 'the cart tests fail, please fix them'));
  assert.ok(evs.some((e) => e.type === 'done'), JSON.stringify(evs.filter((e) => e.type === 'error')));
  return conv;
}

const recallEvents = (evs: ChatEvent[]) => evs.filter((e): e is Extract<ChatEvent, { type: 'recall' }> => e.type === 'recall').map((e) => e.item);
const notesIn = (req: ChatRequest) => req.messages.filter((m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(RECALL_MARK)).map((m) => m.content as string);

// ------------------------------------------------------------------------------------------------

test('signatures: the same error with other paths, lines, times and ids is one signature; different errors differ', () => {
  const a = signaturesOf({ tool: 'shell', args: { command: 'npm test' }, status: 'ok', output: FAIL_A('C:\\Users\\alex\\ws\\src\\cart.js', 12) });
  const b = signaturesOf({ tool: 'shell', args: { command: 'cd app && npm test 2>&1 | tail -40' }, status: 'ok', output: FAIL_A('/home/alex/projects/shop/src/cart.js', 240) });
  const c = signaturesOf({ tool: 'shell', args: { command: 'npm test' }, status: 'ok', output: FAIL_B });
  const fa = a.find((x) => x.kind === 'failure')!;
  const fb = b.find((x) => x.kind === 'failure')!;
  const fc = c.find((x) => x.kind === 'failure')!;
  assert.equal(fa.sig, fb.sig);
  assert.notEqual(fa.sig, fc.sig);
  assert.equal(fa.cls, 'TypeError');
  assert.equal(fc.cls, 'ReferenceError');
  // The quote is the real line, verbatim.
  assert.equal(fa.quote, "TypeError: Cannot read properties of undefined (reading 'price')");
  // Commands: `cd x &&`, output filters and redirections go; the same command is one signature.
  assert.equal(normalizeCommand('cd app && npm test 2>&1 | tail -40'), 'npm test');
  assert.equal(a.find((x) => x.kind === 'command')!.sig, b.find((x) => x.kind === 'command')!.sig);
  assert.equal(normalizeCommand('node --test test/cart.test.js'), 'node --test <path>');
  // Hex, timestamps, ids, numbers.
  assert.equal(normalizeMessage('Error at 0x7ffe12ab on 2026-10-30T15:00:01Z id 3f2a9c1e-1b2c-4d5e-8f90-123456789abc after 1534ms'), normalizeMessage('Error at 0x1 on 2025-01-02T03:04:05Z id 00000000-1111-2222-3333-444444444444 after 9ms'));
  assert.equal(normalizeMessage('error TS2345 at src/a.ts:10:4'), normalizeMessage('error TS2345 at lib/other/b.ts:99:1'));
  assert.notEqual(normalizeMessage('error TS2345: wrong type'), normalizeMessage('error TS2304: cannot find name'));
  assert.equal(errorLine('[exit code 2]\nsrc/a.ts(3,1): error TS2304: Cannot find name \'x\'.')?.cls, 'TS2304');
  assert.equal(errorLine('npm ERR! missing script: build')?.cls, 'npm');
  // What counts as failed.
  assert.equal(stepFailed('shell', 'ok', PASS), false);
  assert.equal(stepFailed('shell', 'ok', FAIL_B), true);
  assert.equal(stepFailed('shell', 'ok', '[timed out after 120s, 120.0s]\n'), true);
  // The sandbox gate's outputs (M5): a try's own head line, and "run for real" after a try.
  assert.equal(stepFailed('shell', 'ok', '[exit code 1, 0.5s, ran in a sandbox copy (not isolated)]\nTypeError: x\n\nSandbox try: no files changed.'), true);
  assert.equal(stepFailed('shell', 'ok', '[tried in a sandbox copy first: no files changed; the owner chose to run it for real]\n[exit code 2, 0.1s]\nboom'), true);
  assert.equal(stepFailed('shell', 'ok', '[tried in a sandbox copy first: no files changed; the owner chose to run it for real]\n[exit code 0, 0.1s]\nok'), false);
  assert.equal(stepFailed('read_file', 'error', 'Error: File not found'), true);
  assert.equal(stepFailed('read_file', 'ok', 'Error: this text is just file content'), false);
  // Files and packages.
  assert.equal(signaturesOf({ tool: 'edit_file', args: { path: './src\\Cart.js' }, status: 'ok', output: '' }).find((x) => x.kind === 'file')?.key, 'src/cart.js');
  assert.deepEqual(signaturesOf({ tool: 'shell', args: { command: 'npm install lodash@4.17.21' }, status: 'ok', output: PASS }).filter((x) => x.kind === 'package').map((x) => x.key), ['npm/lodash']);
  assert.deepEqual(signaturesOf({ tool: 'shell', args: { command: 'node a.js' }, status: 'ok', output: "[exit code 1]\nError: Cannot find module 'left-pad'\nRequire stack:" }).filter((x) => x.kind === 'package').map((x) => x.key), ['npm/left-pad']);
});

test('the index is built on every tool step; a lesson only from evidence (fail → recorded change → the same command passes), with quotes', async (t) => {
  const s = setup(t);
  const conv = await fixTurn(s);
  const [run] = s.runs.list({ conversationId: conv.id });
  const rows = s.recall.list({ workspace: 'main' });
  const kinds = new Set(rows.map((r) => r.kind));
  for (const k of ['failure', 'command', 'file']) assert.ok(kinds.has(k as never), k);
  const cmd = rows.find((r) => r.kind === 'command')!;
  assert.equal(cmd.count, 2);
  assert.equal(cmd.outcome, 'ok');
  assert.equal(cmd.runId, run.id);
  const fail = rows.find((r) => r.kind === 'failure')!;
  assert.equal(fail.outcome, 'fail');
  assert.ok(fail.resolvedBy?.lessonId);
  // The lesson: kind lesson, linked to the run, quoting the error line and the change verbatim.
  const lessons = s.recall.lessons();
  assert.equal(lessons.length, 1);
  const l = lessons[0];
  assert.equal(l.failRun, run.id);
  assert.equal(l.fixRun, run.id);
  assert.equal(l.errorQuote, "TypeError: Cannot read properties of undefined (reading 'price')");
  assert.match(l.fixQuote, /edited src\/cart\.js: “item\.price” → “\(item\?\.price \?\? 0\)”/);
  const note = s.app.memory!.get(l.memoryId)!;
  assert.equal(note.kind, 'lesson');
  assert.equal(note.conversationId, conv.id);
  assert.ok(note.content.includes(l.errorQuote) && note.content.includes('item.price'));
  assert.ok(note.evidence!.includes(`“${l.errorQuote}”`));
  // The quotes are really in the run record.
  const tools = s.runs.steps(run.id).flatMap((x) => x.tools);
  assert.ok(tools.some((x) => x.output.includes(l.errorQuote)));
  assert.ok(tools.some((x) => x.args.old_string === 'item.price'));
  // Lessons stay out of the everyday notes (M1 selection).
  const inj = selectMemories(s.app.memory!, { userText: 'cart total price TypeError npm test', conversationId: 'x', oldestHistoryId: 0, budgetChars: 5000 });
  assert.ok(!inj.ids.includes(l.memoryId));
});

test('no lesson without evidence: passing again with no change, another command passing, a failure never fixed', async (t) => {
  const s = setup(t);
  const conv = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  // Flaky: fail, then the same command passes with nothing changed.
  s.shell.push(FAIL_A('src/cart.js', 3), PASS);
  s.app.script.push([call('a', 'shell', { command: 'npm test' })], [call('b', 'shell', { command: 'npm test' })], text('Passes now.'));
  await drain(runTurn(s.app, conv.id, 'run the tests'));
  assert.equal(s.recall.lessons().length, 0);
  // A change, but a DIFFERENT command passes afterwards.
  s.shell.push(FAIL_A('src/cart.js', 3), PASS);
  s.app.script.push([call('c', 'shell', { command: 'npm test' })], [call('d', 'edit_file', { path: 'src/cart.js', old_string: 'a', new_string: 'b' })], [call('e', 'shell', { command: 'npm run lint' })], text('Lint passes.'));
  await drain(runTurn(s.app, conv.id, 'try again'));
  assert.equal(s.recall.lessons().length, 0);
  assert.equal(s.app.memory!.list({ kind: 'lesson' }).length, 0);
});

test('a lesson across turns: the failure at the end of one turn, the change and the pass in the next', async (t) => {
  const s = setup(t);
  const conv = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_B);
  s.app.script.push([call('a', 'shell', { command: 'npm test' })], text('It fails: taxRate is not defined. Want me to fix it?'));
  await drain(runTurn(s.app, conv.id, 'run the tests'));
  assert.equal(s.recall.lessons().length, 0);
  s.shell.push(PASS);
  s.app.script.push([call('b', 'edit_file', { path: 'src/cart.js', old_string: 'taxRate', new_string: 'TAX_RATE' })], [call('c', 'shell', { command: 'npm test' })], text('Fixed.'));
  await drain(runTurn(s.app, conv.id, 'yes please'));
  const [l] = s.recall.lessons();
  assert.ok(l);
  assert.equal(l.errorQuote, 'ReferenceError: taxRate is not defined');
  assert.notEqual(l.failRun, l.fixRun);
  assert.match(l.fixQuote, /“taxRate” → “TAX_RATE”/);
});

test('backfill: bounded chunks over runs recorded before, once (no double counting), lessons from the recorded steps', async (t) => {
  const s = setup(t, { recall: false });
  await fixTurn(s);
  await fixTurn(s);
  await fixTurn(s);
  assert.equal(s.recall.count(), 0, 'nothing watched live without the index');
  const conv = (id: string) => {
    const c = s.app.store.getConversation(id);
    return c ? { workspace: c.workspace, private: c.private, apps: sharedWithApps(c), partner: Boolean(c.partner) } : undefined;
  };
  const deps = { memory: s.app.memory!, today: () => '2026-10-30', lessons: true };
  const r1 = backfill(s.recall, s.runs, conv, deps, 2);
  assert.deepEqual(r1, { processed: 2, done: false });
  const r2 = backfill(s.recall, s.runs, conv, deps, 2);
  assert.equal(r2.processed, 1);
  assert.equal(r2.done, true);
  assert.deepEqual(backfill(s.recall, s.runs, conv, deps, 2), { processed: 0, done: true });
  const cmds = s.recall.list({ kind: 'command' });
  assert.equal(cmds.length, 3, 'one row per conversation');
  assert.ok(cmds.every((r) => r.count === 2));
  assert.equal(s.recall.lessons().length, 1, 'one lesson per error in a project');
  // Runs after the first backfill are the live hook's (not read again).
  s.app.recall = s.recall;
  await fixTurn(s);
  assert.deepEqual(backfill(s.recall, s.runs, conv, deps, 50), { processed: 0, done: true });
});

test('error trigger: the same error later in the project brings back the fix (sourced, bracketed, on the step, saved); a different error or another project does not', async (t) => {
  const s = setup(t);
  await fixTurn(s);
  const [lesson] = s.recall.lessons();
  // A new conversation in the same project; the same error from another path and line.
  const conv = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_A('/srv/app/src/cart.js', 88), PASS);
  s.app.script.push(...fixScript(2));
  const before = s.app.requests.length;
  const evs = await drain(runTurn(s.app, conv.id, 'tests are red again'));
  const items = recallEvents(evs);
  const err = items.find((i) => i.kind === 'error');
  assert.ok(err, JSON.stringify(items));
  assert.equal(err.ref, `lesson:${lesson.memoryId}`);
  assert.equal(err.sure, 'high');
  assert.equal(err.source.runId, lesson.fixRun);
  assert.equal(err.source.date, '2026-10-30');
  assert.match(err.text, /item\.price/);
  // It went into the NEXT model call (the one after the failing tool), with the bracket.
  const reqs = s.app.requests.slice(before);
  assert.equal(notesIn(reqs[0]).length, 0);
  const note = notesIn(reqs[1]).find((n) => n.includes('item.price'));
  assert.ok(note);
  assert.match(note, /\[why: same error signature \(TypeError\) in this project; sure: high\]$/);
  assert.match(note, new RegExp(`run ${lesson.fixRun}`));
  // Saved on that step's reply (the page draws the chip from it after a reload).
  const saved = s.app.store.messages(conv.id).filter((m) => Array.isArray(m.meta?.recall)).flatMap((m) => m.meta!.recall as RecallItem[]);
  assert.ok(saved.some((x) => x.ref === err.ref));
  // Near misses: a different error in this project, the same error in another project.
  const c2 = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_B);
  s.app.script.push([call('n1', 'shell', { command: 'npm run build' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, c2.id, 'build it'))).filter((i) => i.kind === 'error').length, 0);
  const c3 = s.app.store.createConversation({ mode: 'coding', workspace: 'other' });
  workspaceDir(s.dir, 'other');
  s.shell.push(FAIL_A('src/cart.js', 3));
  s.app.script.push([call('n2', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, c3.id, 'run the tests'))).length, 0);
});

test('command, file, task and package triggers: each on a match, none on a near miss', async (t) => {
  const s = setup(t);
  const mem = s.app.memory!;
  const idx = s.recall;
  await fixTurn(s);
  const [lesson] = idx.lessons();
  // A command that failed the last time it ran here (another conversation).
  const cA = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push('[exit code 1, 2.0s]\nError: Missing script: "build"');
  s.app.script.push([call('b1', 'shell', { command: 'npm run build' })], text('no build script'));
  await drain(runTurn(s.app, cA.id, 'build'));
  const scope = { conversationId: 'now', workspace: 'main', runId: null, private: false };
  const m = new TriggerMatcher(idx, mem, scope, (id) => {
    const c = s.app.store.getConversation(id);
    return c ? { private: c.private } : undefined;
  });
  const sig = (command: string) => signaturesOf({ tool: 'shell', args: { command }, status: 'ok', output: '' }).find((x) => x.kind === 'command')!;
  assert.equal(m.onCommand(sig('npm run build')).length, 1);
  assert.equal(m.onCommand(sig('npm test')).length, 0, 'npm test passed the last time');
  assert.equal(m.onCommand(sig('npm run start')).length, 0, 'never ran');
  // A file with a decision about it; a near-miss file name.
  const d = mem.add({ kind: 'decision', content: 'Never change the rounding in pricing.js without asking first.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-12', evidence: 'never change the rounding in pricing.js' });
  const hit = m.onFile('src/pricing.js');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].ref, `note:${d.id}`);
  assert.match(hit[0].why, /names pricing\.js \(decided together\)/);
  assert.equal(m.onFile('src/pricing.json').length, 0);
  assert.equal(m.onFile('src/repricing.js').length, 0);
  assert.equal(m.onFile('src/other.js').length, 0);
  // Lessons don't come back through the file trigger (only on their own error, task or package).
  assert.ok(!m.onFile('src/cart.js').some((x) => x.ref === `note:${lesson.memoryId}`));
  // A task like the one that left the lesson; a different task.
  const task = m.onTask('npm test fails again with a TypeError reading price in the cart');
  assert.equal(task.length, 1);
  assert.equal(task[0].ref, `lesson:${lesson.memoryId}`);
  assert.match(task[0].why, /^words /);
  assert.equal(m.onTask('write me a short poem about autumn').length, 0);
  assert.equal(m.onTask('cart').length, 0, 'one shared word is not enough');
  assert.equal(m.onTask('the tests fail again, please fix the failing npm test').length, 0, 'words every lesson has prove nothing');
  // Meaning alone (≥ 0.7) is enough; a weak meaning match is not.
  assert.equal(m.onTask('zzz qqq', [{ memory: mem.get(lesson.memoryId)!, score: 0.82 }]).length, 1);
  assert.equal(m.onTask('zzz qqq', [{ memory: mem.get(lesson.memoryId)!, score: 0.6 }]).length, 0);
  // Another project: no task trigger.
  assert.equal(new TriggerMatcher(idx, mem, { ...scope, workspace: 'other' }, () => undefined).onTask('npm test fails again with a TypeError reading price in the cart').length, 0);
  // A package a lesson is about (any project), not another package.
  idx.addLesson({ ...lesson, memoryId: mem.add({ kind: 'lesson', content: 'lodash merge gotcha', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-20' }).id, sig: 'x', packages: ['npm/lodash'], workspace: 'other', fixRun: 999 });
  const pk = (command: string) => signaturesOf({ tool: 'shell', args: { command }, status: 'ok', output: '' }).find((x) => x.kind === 'package')!;
  const p = m.onPackage(pk('npm install lodash@4.17.21'));
  assert.equal(p.length, 1);
  assert.equal(p[0].sure, 'medium');
  assert.match(p[0].why, /another project/);
  assert.equal(m.onPackage(pk('npm install left-pad@1.3.0')).length, 0);
});

test('caps: at most 2 notes per model call and 4 per turn, one per source, errors first', () => {
  const q = new RecallQueue();
  const item = (kind: RecallItem['kind'], n: number): RecallItem => ({ id: `${kind}:${n}`, kind, ref: `sig:${kind}${n}`, text: 't', why: 'w', sure: 'high', source: { runId: 1, date: '2026-10-30', workspace: 'main' } });
  q.add([item('file', 1), item('task', 2), item('error', 3), item('command', 4), item('error', 3)]);
  const a = q.take(0);
  assert.equal(a.length, STEP_CAP);
  assert.deepEqual(a.map((x) => x.kind), ['error', 'command']);
  q.add([item('error', 3), item('package', 5), item('file', 6)]);
  const b = q.take(1);
  assert.equal(b.length, 2);
  assert.ok(!b.some((x) => x.ref === 'sig:error3'), 'never twice in a turn');
  q.add([item('error', 7), item('error', 8)]);
  assert.equal(q.take(2).length, 0, 'the turn cap');
  assert.equal(q.given.length, TURN_CAP);
});

test('caps hold in a real turn with many matches; the bracket format; voice gets no bracket', async (t) => {
  const s = setup(t);
  const mem = s.app.memory!;
  await fixTurn(s);
  for (const f of ['a.js', 'b.js', 'c.js', 'd.js']) mem.add({ kind: 'decision', content: `Keep ${f} small.`, conversationId: null, sourceMessageId: null, happenedOn: '2026-10-01', evidence: `keep ${f} small` });
  const conv = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.app.script.push([call('e1', 'edit_file', { path: 'src/a.js', old_string: 'x', new_string: 'y' }), call('e2', 'edit_file', { path: 'src/b.js', old_string: 'x', new_string: 'y' }), call('e3', 'edit_file', { path: 'src/c.js', old_string: 'x', new_string: 'y' })], [call('e4', 'edit_file', { path: 'src/d.js', old_string: 'x', new_string: 'y' })], [call('e5', 'shell', { command: 'npm test' })], text('done'));
  s.shell.push(FAIL_A('src/cart.js', 1));
  const before = s.app.requests.length;
  const evs = await drain(runTurn(s.app, conv.id, 'the cart total TypeError again, tidy a b c d'));
  const reqs = s.app.requests.slice(before);
  for (const r of reqs) assert.ok(notesIn(r).length <= STEP_CAP, `${notesIn(r).length} notes in one call`);
  assert.ok(recallEvents(evs).length <= TURN_CAP);
  assert.equal(reqs.reduce((n, r) => n + notesIn(r).length, 0), recallEvents(evs).length);
  for (const n of reqs.flatMap(notesIn)) assert.match(n, /^Remembered on your own \(from your own run history, \d{4}-\d{2}-\d{2}(, run \d+)?; check it still fits before relying on it\): .+ \[why: [^\]]+; sure: (high|medium|low)\]$/);
  const it: RecallItem = { id: 'x', kind: 'error', ref: 'sig:x', text: 'Last time…', why: 'same error signature (TypeError) in this project', sure: 'high', source: { runId: 4, date: '2026-10-28', workspace: 'main' } };
  assert.equal(recallBracket(it), '[why: same error signature (TypeError) in this project; sure: high]');
  assert.ok(!recallNote(it, false).includes('[why'));
  // A classic video call (spoken aloud): the same note without the bracket.
  const c2 = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_A('src/cart.js', 2));
  s.app.script.push([call('v1', 'shell', { command: 'npm test' })], text('ok'));
  const b2 = s.app.requests.length;
  await drain(runTurn(s.app, c2.id, 'tests?', undefined, { videoCall: true }));
  const spoken = s.app.requests.slice(b2).flatMap(notesIn);
  assert.ok(spoken.length >= 1);
  assert.ok(spoken.every((n) => !n.includes('[why:')));
});

test('"Not useful" halves the weight (recorded); two silence an exact error match; route + chip state', async (t) => {
  const s = setup(t);
  await fixTurn(s);
  const [lesson] = s.recall.lessons();
  const ref = `lesson:${lesson.memoryId}`;
  const conv = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_A('src/cart.js', 9));
  s.app.script.push([call('w1', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, conv.id, 'go'))).filter((i) => i.kind === 'error').length, 1);
  const carrier = s.app.store.messages(conv.id).find((m) => Array.isArray(m.meta?.recall))!;
  // The route (member family 'memory'): POST /api/memory/recall/feedback.
  const auth = new OwnerAuth(s.dir, () => NOW);
  const server = createSaraServer({ app: s.app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const post = async (body: unknown) => {
    const r = await fetch(`${base}/api/memory/recall/feedback`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, number> };
  };
  assert.equal((await post({ kind: 'nope', ref })).status, 400);
  assert.equal((await post({ kind: 'error', ref: 'lesson:1; DROP' })).status, 400);
  const r1 = await post({ kind: 'error', ref, messageId: carrier.id });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.weight, 0.5);
  assert.equal(s.recall.weight('error', ref), 0.5);
  assert.equal((s.app.store.messageById(carrier.id)!.meta!.recall as RecallItem[]).find((x) => x.ref === ref)?.feedback, 'not-useful');
  const fb = s.recall.feedbackRows();
  assert.equal(fb[0].verdict, 'not-useful');
  assert.equal(fb[0].weightBefore, 1);
  // At 0.5 an exact error match (base 1) still fires; at 0.25 it doesn't (FIRE_AT 0.45).
  assert.ok(0.5 >= FIRE_AT && 0.25 < FIRE_AT);
  s.shell.push(FAIL_A('src/cart.js', 9));
  s.app.script.push([call('w2', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, conv.id, 'again'))).filter((i) => i.kind === 'error').length, 1);
  await post({ kind: 'error', ref, messageId: carrier.id });
  s.shell.push(FAIL_A('src/cart.js', 9));
  s.app.script.push([call('w3', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, conv.id, 'and again'))).filter((i) => i.kind === 'error').length, 0);
  // Other trigger kinds of the same lesson keep their own weight.
  assert.equal(s.recall.weight('task', ref), 1);
  const g = await fetch(`${base}/api/memory/recall`, { headers: H });
  const st = (await g.json()) as { mode: string; signatures: number; lessons: number };
  assert.equal(st.mode, 'coding');
  assert.ok(st.signatures > 0 && st.lessons === 1);
});

test('rules: private sources only in private chats; other apps see exactly what M1 lets them; never in partner chats or groups', async (t) => {
  const s = setup(t);
  const mem = s.app.memory!;
  const store = s.app.store;
  const kinds = [
    { name: 'normal', opts: {} },
    { name: 'private', opts: { private: true } },
    { name: 'adult', opts: { channel: 'discord-nsfw' } },
    { name: 'imported', opts: { channel: 'import-chatgpt' } },
  ];
  const convs = kinds.map((k) => ({ ...k, conv: store.createConversation({ mode: 'coding', workspace: 'main', ...k.opts }) }));
  // M1's rule for another app's turn (src/chat.ts appSafe), used as is.
  const appSafe = (m: { conversationId: string | null }) => !m.conversationId || sharedWithApps(store.getConversation(m.conversationId));
  const look = (id: string) => {
    const c = store.getConversation(id);
    return c ? { private: c.private } : undefined;
  };
  for (const c of convs) {
    const note = mem.add({ kind: 'fact', content: `Alex keeps the ${c.name} notes in ledger.js`, conversationId: c.conv.id, sourceMessageId: 1, happenedOn: '2026-10-01', evidence: 'x' });
    const m1 = selectMemories(mem, { userText: `${c.name} ledger.js`, conversationId: 'elsewhere', oldestHistoryId: 0, budgetChars: 5000, allow: appSafe }).ids.includes(note.id);
    const asApp = new TriggerMatcher(s.recall, mem, { conversationId: 'api-conv', workspace: 'main', runId: null, private: false, allow: appSafe }, look);
    assert.equal(asApp.allowed({ conversationId: c.conv.id }), m1, `other app, ${c.name}: same as M1 (${m1})`);
    const owner = new TriggerMatcher(s.recall, mem, { conversationId: 'own', workspace: 'main', runId: null, private: false }, look);
    assert.equal(owner.allowed({ conversationId: c.conv.id }), c.name !== 'private', `owner chat, ${c.name}`);
    const priv = new TriggerMatcher(s.recall, mem, { conversationId: 'own', workspace: 'main', runId: null, private: true }, look);
    assert.equal(priv.allowed({ conversationId: c.conv.id }), true, `private chat, ${c.name}`);
  }
  // A private fix comes back only in a private conversation.
  await fixTurn(s, { private: true });
  const pub = store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('p1', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, pub.id, 'tests'))).length, 0);
  const priv = store.createConversation({ mode: 'coding', workspace: 'main', private: true });
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('p2', 'shell', { command: 'npm test' })], text('ok'));
  assert.ok(recallEvents(await drain(runTurn(s.app, priv.id, 'tests'))).some((i) => i.kind === 'error'));
  // Partner chats: no tools offered anyway, and never a recall note.
  const partner = store.createConversation({ mode: 'coding', workspace: 'main', partner: 'Sam', channel: 'telegram' });
  s.app.script.push(text('hi Sam'));
  const b = s.app.requests.length;
  assert.equal(recallEvents(await drain(runTurn(s.app, partner.id, 'npm test fails again with a TypeError reading price in the cart'))).length, 0);
  assert.equal(s.app.requests.slice(b).flatMap(notesIn).length, 0);
  // The chat code never builds the hook for partner chats or groups.
  const chat = readFileSync(join(ROOT, 'src', 'chat.ts'), 'utf8');
  assert.match(chat, /const recallHook = app\.recall && !conv\.partner && !opts\.group/);
});

test('the switch: Off = no notes and no new lessons (signatures still kept); coding only by default; everywhere', async (t) => {
  const s = setup(t);
  assert.equal(recallMode(undefined), 'coding');
  assert.equal(recallMode({ recall: 'bogus' }), 'coding');
  s.app.settings.update({ memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'off' } });
  await fixTurn(s);
  assert.equal(s.recall.lessons().length, 0);
  assert.ok(s.recall.count() > 0);
  s.app.settings.update({ memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'coding' } });
  await fixTurn(s);
  assert.equal(s.recall.lessons().length, 1);
  s.app.settings.update({ memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'off' } });
  const c = s.app.store.createConversation({ mode: 'coding', workspace: 'main' });
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('o1', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, c.id, 'tests'))).length, 0);
  // An eval variant can force it on (and off) for one turn.
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('o2', 'shell', { command: 'npm test' })], text('ok'));
  assert.ok(recallEvents(await drain(runTurn(s.app, c.id, 'tests', undefined, { recall: true }))).length > 0);
  // Coding only: an everyday chat gets nothing; everywhere: it does.
  s.app.settings.update({ memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'coding' } });
  const chat = s.app.store.createConversation({ mode: 'chat', workspace: 'main' });
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('o3', 'shell', { command: 'npm test' })], text('ok'));
  assert.equal(recallEvents(await drain(runTurn(s.app, chat.id, 'tests'))).length, 0);
  s.app.settings.update({ memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'everywhere' } });
  s.shell.push(FAIL_A('src/cart.js', 5));
  s.app.script.push([call('o4', 'shell', { command: 'npm test' })], text('ok'));
  assert.ok(recallEvents(await drain(runTurn(s.app, chat.id, 'tests'))).length > 0);
});

test('speed: a trigger check stays under 10 ms per tool step with 10,000 signatures', (t) => {
  const s = setup(t);
  const store = s.app.store;
  const conv = store.createConversation({ mode: 'coding', workspace: 'main' });
  const db = store.db;
  db.exec('BEGIN');
  const ins = db.prepare("INSERT INTO recall_signatures (sig, kind, key, workspace, conversation_id, run_id, step, quote, outcome, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, 0, 'q', ?, '2026-10-01', '2026-10-01')");
  for (let i = 0; i < 10_000; i++) ins.run(`s${i.toString(16).padStart(15, '0')}`, ['failure', 'command', 'file', 'package'][i % 4], `k${i}`, i % 3 ? 'main' : 'other', conv.id, i, i % 2 ? 'fail' : 'ok');
  db.exec('COMMIT');
  for (let i = 0; i < 300; i++) s.app.memory!.add({ kind: i % 2 ? 'lesson' : 'decision', content: `note ${i} about file${i}.js and npm test`, conversationId: conv.id, sourceMessageId: null, happenedOn: '2026-10-01' });
  assert.ok(s.recall.count() >= 10_000);
  const m = new TriggerMatcher(s.recall, s.app.memory!, { conversationId: conv.id, workspace: 'main', runId: 1, private: false }, () => ({ private: false }));
  const w = new RunWatcher(s.recall, { conversationId: conv.id, workspace: 'main', runId: 1, isPrivate: false, apps: true }, { memory: s.app.memory!, today: () => '2026-10-30', lessons: true });
  const times: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    const ev = { tool: i % 2 ? 'shell' : 'edit_file', args: i % 2 ? { command: 'npm test' } : { path: `src/file${i}.js`, old_string: 'a', new_string: 'b' }, status: 'ok', output: i % 2 ? FAIL_A('src/x.js', i) : 'Edited' };
    for (const sg of signaturesOf(ev)) {
      if (sg.kind === 'command') m.onCommand(sg);
      if (sg.kind === 'file') m.onFile(sg.quote);
    }
    const r = w.observe(i, ev);
    const f = r.sigs.find((x) => x.kind === 'failure');
    if (f) m.onError(f);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`recall trigger check: median ${median.toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms per tool step (10,000 signatures)`);
  // The target is 10 ms; the median carries the claim (a loaded shared machine can stall one call).
  assert.ok(median < 10, `median ${median} ms`);
});

test('M9: a "recall on her own" variant (on/off) is accepted and named; a replay never repeats recorded recall notes', () => {
  const app = { settings: { get: () => ({ providers: [] }) } } as never;
  assert.deepEqual(cleanVariant(app, { recall: 'off' }, 'v1'), { id: 'v1', recall: 'off' });
  assert.deepEqual(cleanVariant(app, { recall: 'maybe' }, 'v1'), { id: 'v1' });
  assert.equal(variantWords({ id: 'v1', recall: 'on' }), 'recall on her own: on');
  const chat = readFileSync(join(ROOT, 'src', 'chat.ts'), 'utf8');
  assert.match(chat, /!x\.startsWith\(RECALL_MARK\)/);
  const replay = readFileSync(join(ROOT, 'src', 'replay.ts'), 'utf8');
  assert.match(replay, /opts\.recall !== undefined \? \{ recall: opts\.recall \}/);
});

test('the page: chips with "Not useful", the panel, Settings → Memory → Recall on her own, tips, translations, no inline styles, ES modules parse, a fresh app cache', () => {
  const web = (f: string) => readFileSync(join(ROOT, 'web', f), 'utf8');
  const view = web('recall-view.js');
  assert.match(view, /export function recallChip/);
  assert.match(view, /Remembered on her own/);
  assert.match(view, /Not useful/);
  assert.match(view, /\/memory\/recall\/feedback/);
  assert.doesNotMatch(view, /style=|\.style\.(?!setProperty)/);
  const html = web('index.html');
  assert.match(html, /<select id="mem-recall">[\s\S]*value="off"[\s\S]*value="coding"[\s\S]*value="everywhere"/);
  assert.match(html, /id="hp-recall-list"/);
  const app = web('app.js');
  assert.match(app, /ev\.type === 'recall'/);
  assert.match(app, /recall: \$\('#mem-recall'\)\.value/);
  const panel = web('her-panel.js');
  assert.match(panel, /recallOfLastTurn/);
  for (const lang of ['es', 'fr', 'de', 'pt-BR', 'it']) {
    const tr = JSON.parse(readFileSync(join(ROOT, 'web', 'i18n', `${lang}.json`), 'utf8')) as Record<string, string>;
    for (const k of ['Remembered on her own', 'Not useful', 'Recall on her own', 'Coding conversations only', 'Everywhere']) {
      assert.ok(tr[k], `${lang}: ${k}`);
      assert.notEqual(tr[k], k, `${lang}: ${k} is translated`);
    }
  }
  assert.match(web('sw.js'), /caches\.open\('sara-shell-v18'\)[\s\S]*sara-shell-v17 from Phase 84/);
  assert.match(web('sw.js'), /Phase 84 had caches\.open\('sara-shell-v17'\)/);
});
