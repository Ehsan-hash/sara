// Phase 85 (harness M10): does recall on her own help? A synthetic, labelled set of repeated-error
// projects measured with the M9 eval loop, headless: triggers ON (the control: the default setting,
// coding conversations) against triggers OFF (a variant), same tasks, same model, same budget.
//
// For each of six small Node projects (original code, written for this eval):
//   1. an EARLIER RUN: a real coding turn where `npm test` really fails with a specific error, the
//      known fix is applied with edit_file and `npm test` really passes (a scripted model drives the
//      tools, so the evidence is real and the code writes the lesson from it);
//   2. the bug comes back (a new commit), and the owner's task "the tests are failing again" is
//      recorded as a turn (recall off while recording, so nothing is baked into the record).
// Four NEAR-MISS tasks put a DIFFERENT bug in four of the projects (a different error): any recall
// note there that points to the old lesson counts as a false trigger.
// Then Evals.create({ variants: [{ recall: 'off' }] }) replays every task from step 0 with the real
// model in both variants (approvals answered No; shell/edit set to run without asking in this scratch
// data folder), runs the project's tests after each run, and we read steps, tokens, tests and the
// recall notes each run got (run_steps.extra).
//
//   node scripts/eval-recall.ts [--model gemma4:12b] [--ollama http://127.0.0.1:11434/v1] [--out file.json] [--keep]
//   node scripts/eval-recall.ts --fake     pipeline check with a scripted "model" (not a measurement)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext, type ChatEvent } from '../src/chat.ts';
import { Evals } from '../src/evals.ts';
import { MemoryStore } from '../src/memory.ts';
import { loadPersona } from '../src/persona.ts';
import { createProvider } from '../src/providers/registry.ts';
import type { ChatRequest, Provider, ProviderConfig, StreamEvent } from '../src/providers/types.ts';
import { Redactor } from '../src/redact.ts';
import { RunStore, runSettings } from '../src/runs.ts';
import { SandboxGate, sandboxGateSettings } from '../src/sandbox-run.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { BUILTIN_TOOLS } from '../src/tools/builtin.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { detectSandbox } from '../src/tools/sandbox.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { RECALL_MARK, RecallIndex } from '../src/triggers.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: {
    model: { type: 'string', default: 'gemma4:12b' },
    ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
    fake: { type: 'boolean', default: false },
  },
});

interface Project {
  ws: string;
  file: string;
  good: string;
  bad: string;
  /** A different bug (a different error) for the near-miss task. */
  other?: string;
  test: string;
}

const pkg = JSON.stringify({ name: 'p', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2);
const T = (imp: string, body: string) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${imp}\n\n${body}\n`;
const PROJECTS: Project[] = [
  {
    ws: 'cart',
    file: 'src/cart.js',
    good: 'export function total(items) {\n  return items.filter(Boolean).reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n',
    bad: 'export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n',
    other: 'export function total(items) {\n  return items.filter(Boolean).reduce((sum, item) => sum + item.price + item.qty, 0);\n}\n',
    test: T("import { total } from '../src/cart.js';", "test('total skips empty slots', () => {\n  assert.equal(total([{ price: 2, qty: 3 }, null, { price: 1, qty: 1 }]), 7);\n});"),
  },
  {
    ws: 'slug',
    file: 'src/slug.js',
    good: "export function slugify(s) {\n  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\n",
    bad: "export function slugify(s) {\n  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\n",
    other: "export function slugify(s) {\n  return String(s).toLowerCase().trim().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');\n}\n",
    test: T("import { slugify } from '../src/slug.js';", "test('slugs', () => {\n  assert.equal(slugify('Hello World 2'), 'hello-world-2');\n  assert.equal(slugify(42), '42');\n});"),
  },
  {
    ws: 'config',
    file: 'src/config.js',
    good: 'export function parseConfig(text) {\n  return text.trim() ? JSON.parse(text) : {};\n}\n',
    bad: 'export function parseConfig(text) {\n  return JSON.parse(text);\n}\n',
    other: 'export function parseConfig(text) {\n  return text.trim() ? JSON.parse(text) : null;\n}\n',
    test: T("import { parseConfig } from '../src/config.js';", "test('empty config is {}', () => {\n  assert.deepEqual(parseConfig(''), {});\n  assert.deepEqual(parseConfig('{\"a\":1}'), { a: 1 });\n});"),
  },
  {
    ws: 'tax',
    file: 'src/tax.js',
    good: 'const TAX_RATE = 0.25;\n\nexport function withTax(n) {\n  return n * (1 + TAX_RATE);\n}\n',
    bad: 'const TAX_RATE = 0.25;\n\nexport function withTax(n) {\n  return n * (1 + taxRate);\n}\n',
    other: 'const TAX_RATE = 0.25;\n\nexport function withTax(n) {\n  return n * TAX_RATE;\n}\n',
    test: T("import { withTax } from '../src/tax.js';", "test('adds a quarter', () => {\n  assert.equal(withTax(100), 125);\n});"),
  },
  {
    ws: 'dates',
    file: 'src/dates.js',
    good: 'export function isoDay(v) {\n  const d = new Date(v);\n  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);\n}\n',
    bad: 'export function isoDay(v) {\n  return new Date(v).toISOString().slice(0, 10);\n}\n',
    test: T("import { isoDay } from '../src/dates.js';", "test('days', () => {\n  assert.equal(isoDay('2026-10-30T12:00:00Z'), '2026-10-30');\n  assert.equal(isoDay('not a date'), null);\n});"),
  },
  {
    ws: 'money',
    file: 'src/money.js',
    good: 'export function round2(n) {\n  return Math.round((n + Number.EPSILON) * 100) / 100;\n}\n',
    bad: 'export function round2(n) {\n  return Math.round(n * 100) / 100;\n}\n',
    test: T("import { round2 } from '../src/money.js';", "test('rounds half up', () => {\n  assert.equal(round2(1.005), 1.01);\n  assert.equal(round2(2.5), 2.5);\n});"),
  },
];
const ASK = 'The tests in this project are failing again. Please fix it so `npm test` passes.';

// ---- a scripted model for the earlier runs and for recording the tasks ----
let scripted: StreamEvent[][] = [];
let useScript = true;
class ScriptProvider implements Provider {
  readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }
  async listModels() {
    return [opt.model!];
  }
  async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
    for (const ev of scripted.shift() ?? [{ type: 'text', text: 'Looking into it.' } as StreamEvent]) yield ev;
    yield { type: 'usage', input: 400, output: 20 };
  }
}
/** --fake: a "model" that runs the tests, uses a recall note's edit when it has one, else reads and rewrites. */
class FakeFixer implements Provider {
  readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }
  async listModels() {
    return ['fake'];
  }
  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    const last = req.messages.findLastIndex((m) => m.role === 'user');
    const after = req.messages.slice(last + 1);
    const tools = after.filter((m) => m.role === 'tool').length;
    const note = after.find((m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(RECALL_MARK))?.content as string | undefined;
    // Which project: the failing test's name in the first test run's output.
    const out = after.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
    const p = PROJECTS.find((x) => out.includes(/test\('([^']+)'/.exec(x.test)![1])) ?? PROJECTS[0];
    const id = () => Math.random().toString(36).slice(2, 8);
    if (tools === 0) yield { type: 'tool_call', call: { id: id(), name: 'shell', arguments: { command: 'npm test' } } };
    else if (note && tools === 1) yield { type: 'tool_call', call: { id: id(), name: 'write_file', arguments: { path: p.file, content: p.good } } };
    else if (!note && tools === 1) yield { type: 'tool_call', call: { id: id(), name: 'list_dir', arguments: { path: 'src' } } };
    else if (!note && tools === 2) yield { type: 'tool_call', call: { id: id(), name: 'read_file', arguments: { path: p.file } } };
    else if (!note && tools === 3) yield { type: 'tool_call', call: { id: id(), name: 'write_file', arguments: { path: p.file, content: p.good } } };
    else if (tools <= 4 && !after.some((m) => m.role === 'tool' && /exit code 0/.test(String(m.content)))) yield { type: 'tool_call', call: { id: id(), name: 'shell', arguments: { command: 'npm test' } } };
    else yield { type: 'text', text: 'Fixed; npm test passes.' };
    yield { type: 'usage', input: 1500, output: 60 };
  }
}

function git(dir: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Eval', '-c', 'user.email=eval@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: 'pipe' });
}

function buildApp(dataDir: string): AppContext {
  const vault = new Vault(dataDir);
  const settings = new SettingsStore(dataDir);
  const store = new Store(join(dataDir, 'sara.db'));
  const app: AppContext = {
    store,
    memory: new MemoryStore(store.db),
    settings,
    vault,
    persona: loadPersona(join(ROOT, 'persona', 'sara.json')),
    now: () => new Date(),
    dataDir,
    tools: new ToolRegistry(),
    approvals: new ApprovalBroker(),
    sandbox: detectSandbox('auto'),
    redactor: new Redactor(() => vault.values()),
    snapshots: new SnapshotStore(dataDir),
  };
  for (const t of BUILTIN_TOOLS) if (t.spec.name !== 'web_fetch') app.tools.add(t);
  app.runs = new RunStore(store.db);
  app.runs.settings = () => runSettings(app.settings.get());
  app.recall = new RecallIndex(store.db);
  app.sandboxGate = new SandboxGate(join(dataDir, 'cache', 'sandbox-runs'), app.sandbox, () => sandboxGateSettings({ sandboxGate: { mode: 'off', timeLimitS: 120 } } as never));
  app.providerFactory = (config) => (useScript ? new ScriptProvider(config) : opt.fake ? new FakeFixer(config) : createProvider(config));
  settings.update({
    providers: [{ id: 'ollama', label: 'Ollama on this computer', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
    defaultProviderId: 'ollama',
    defaultModel: opt.model,
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: new Date().toISOString(),
    toolPermissions: { shell: 'auto', edit_file: 'auto', write_file: 'auto', read_file: 'auto', list_dir: 'auto', search: 'auto' },
    memory: { enabled: true, quietMinutes: 30, injectBudgetChars: 2500, recall: 'coding' },
  } as never);
  app.evals = new Evals(app);
  return app;
}

async function drain(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const call = (name: string, args: Record<string, unknown>): StreamEvent => ({ type: 'tool_call', call: { id: `${name}-${Math.random().toString(36).slice(2, 8)}`, name, arguments: args } });

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-eval-recall-'));
  const app = buildApp(dataDir);
  const labels = new Map<number, { project: string; kind: 'repeat' | 'near-miss' }>();
  const lessonsBefore: Record<string, number> = {};
  console.log(`data: ${dataDir}`);
  // 1. Earlier runs: the real failure, the known fix, the real pass.
  for (const p of PROJECTS) {
    const dir = workspaceDir(dataDir, p.ws);
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'test'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), pkg);
    writeFileSync(join(dir, p.file), p.bad);
    writeFileSync(join(dir, 'test', `${p.ws}.test.js`), p.test);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'start');
    const conv = app.store.createConversation({ mode: 'coding', workspace: p.ws, title: `${p.ws}: earlier` });
    useScript = true;
    scripted = [[call('shell', { command: 'npm test' })], [call('edit_file', { path: p.file, old_string: p.bad, new_string: p.good })], [call('shell', { command: 'npm test' })], [{ type: 'text', text: 'Fixed.' }]];
    const evs = await drain(runTurn(app, conv.id, 'The tests fail. Please fix them.'));
    const results = evs.filter((e) => e.type === 'tool_result').map((e) => (e as { output: string }).output.split('\n')[0]);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix');
    lessonsBefore[p.ws] = app.recall!.lessons().filter((l) => l.workspace === p.ws).length;
    console.log(`earlier run ${p.ws}: ${results.join(' | ')} → lessons ${lessonsBefore[p.ws]}`);
  }
  // 2. The tasks: the same bug back (repeat), or another bug (near miss), each recorded as a turn.
  const record = async (p: Project, kind: 'repeat' | 'near-miss') => {
    const dir = workspaceDir(dataDir, p.ws);
    writeFileSync(join(dir, p.file), kind === 'repeat' ? p.bad : p.other!);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', kind === 'repeat' ? 'the bug is back' : 'another bug');
    const conv = app.store.createConversation({ mode: 'coding', workspace: p.ws, title: `${p.ws}: ${kind}` });
    useScript = true;
    scripted = [[{ type: 'text', text: 'Looking into it.' }]];
    await drain(runTurn(app, conv.id, ASK, undefined, { recall: false }));
    const [run] = app.runs!.list({ conversationId: conv.id });
    labels.set(run.id, { project: p.ws, kind });
    // The step's workspace manifest (git HEAD) is written in the background: wait for it before the
    // workspace moves on, or the replay would start from the next commit.
    for (let i = 0; i < 100 && !app.runs!.step(run.id, 0)?.workspaceRef?.head; i++) await new Promise((r) => setTimeout(r, 100));
    // Back to the fixed state for the next task in this project.
    writeFileSync(join(dir, p.file), p.good);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fixed again');
  };
  for (const p of PROJECTS.filter((x) => x.other)) await record(p, 'near-miss');
  for (const p of PROJECTS) await record(p, 'repeat');
  // 3. The eval: control (recall on, the default for coding) vs recall off.
  useScript = false;
  const evals = app.evals!;
  const made = evals.create({ kind: 'coding', count: labels.size, variants: [{ recall: 'off' }], concurrency: 1, title: 'Recall on her own: on vs off' });
  console.log(`eval ${made.id}: ${made.tasks.length} tasks`);
  const t0 = Date.now();
  evals.start(made.id, { ceiling: { tokens: 8_000_000 } });
  await evals.work;
  const ev = evals.store.get(made.id)!;
  const rows = evals.store.runs(made.id);
  type One = { task: number; project: string; kind: string; variant: string; status: string; steps: number; tokens: number; passed: boolean; notes: string[]; ms: number };
  const all: One[] = [];
  for (const r of rows) {
    const task = ev.tasks.find((x) => x.idx === r.task)!;
    const lab = labels.get(task.runId) ?? { project: '?', kind: '?' };
    const notes = r.runId ? app.runs!.steps(r.runId).flatMap((s) => s.extra.filter((x) => x.startsWith(RECALL_MARK))) : [];
    all.push({ task: r.task, project: lab.project, kind: lab.kind, variant: r.variant, status: r.status, steps: r.steps, tokens: r.tokens, passed: Boolean(r.tests && r.tests.exitCode === 0), notes, ms: r.ms });
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const mean = (xs: number[]) => (xs.length ? Math.round((sum(xs) / xs.length) * 10) / 10 : 0);
  const report: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), model: opt.fake ? 'fake (pipeline check)' : opt.model, minutes: Math.round((Date.now() - t0) / 6000) / 10, evalStatus: ev.status, headline: ev.result?.headline };
  for (const kind of ['repeat', 'near-miss']) {
    for (const variant of ['control', 'v1']) {
      const xs = all.filter((x) => x.kind === kind && x.variant === variant);
      report[`${kind}/${variant === 'control' ? 'on' : 'off'}`] = { runs: xs.length, passed: xs.filter((x) => x.passed).length, meanSteps: mean(xs.map((x) => x.steps)), meanTokens: Math.round(mean(xs.map((x) => x.tokens))), notes: sum(xs.map((x) => x.notes.length)) };
    }
  }
  // Paired: repeat tasks where both variants passed.
  const pairs = all.filter((x) => x.kind === 'repeat' && x.variant === 'control').map((on) => ({ on, off: all.find((x) => x.kind === 'repeat' && x.variant === 'v1' && x.task === on.task)! })).filter((p) => p.off);
  const both = pairs.filter((p) => p.on.passed && p.off.passed);
  report.pairedBothPassed = { tasks: both.length, stepsOn: mean(both.map((p) => p.on.steps)), stepsOff: mean(both.map((p) => p.off.steps)), tokensOn: Math.round(mean(both.map((p) => p.on.tokens))), tokensOff: Math.round(mean(both.map((p) => p.off.tokens))) };
  // False triggers: a recall note in a near-miss run (its lesson is about another error), and any
  // note in a repeat run that isn't about this project's own lesson.
  const nearNotes = all.filter((x) => x.kind === 'near-miss' && x.variant === 'control').flatMap((x) => x.notes);
  const repeatNotes = all.filter((x) => x.kind === 'repeat' && x.variant === 'control').flatMap((x) => x.notes.map((n) => ({ n, p: x.project })));
  const offNotes = all.filter((x) => x.variant === 'v1').flatMap((x) => x.notes);
  const relevant = repeatNotes.filter(({ n, p }) => {
    const proj = PROJECTS.find((q) => q.ws === p)!;
    return n.includes(proj.file) || n.includes(proj.ws);
  }).length;
  report.triggers = { notesOnRepeat: repeatNotes.length, relevantOnRepeat: relevant, notesOnNearMiss: nearNotes.length, nearMissRunsWithANote: all.filter((x) => x.kind === 'near-miss' && x.variant === 'control' && x.notes.length).length, falseTriggerRate: repeatNotes.length + nearNotes.length ? Math.round(((repeatNotes.length - relevant + nearNotes.length) / (repeatNotes.length + nearNotes.length)) * 100) / 100 : 0, notesWithRecallOff: offNotes.length };
  report.runs = all.map(({ notes, ...x }) => ({ ...x, notes: notes.length, firstNote: notes[0]?.slice(0, 200) }));
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (opt.out) writeFileSync(opt.out, `${json}\n`);
  app.store.close();
  if (!opt.keep) rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
}

await main();
