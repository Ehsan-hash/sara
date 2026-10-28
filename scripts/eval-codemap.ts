// Phase 50 code map check on a real model. Sara's own code (src, web, test, package.json, README)
// is copied into a workspace in a scratch data folder; then she is asked questions about it in
// coding conversations, once with only the plain file tools (list_dir, read_file, search) and once
// with the code tools added (code_map, code_find, code_refs, code_deps; meaning search with the
// embeddings model when given). An answer passes when it names the right file(s). Reports both
// scores, tool calls and files read, and merges the result into evals/results/<date>-codemap.json.
//   node scripts/eval-codemap.ts [--model qwen3.8:27b-mtp-q4_K_M] [--embed nomic-embed-text] [--only with|without] [--timeout 420]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { CodeMaps } from '../src/codemap/index.ts';
import { createCodeTools } from '../src/codemap/tools.ts';
import { embedTarget } from '../src/embeddings.ts';
import { EventHub } from '../src/events.ts';
import { loadPersona } from '../src/persona.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import type { Permission } from '../src/tools/types.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'qwen3.8:27b-mtp-q4_K_M' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, embed: { type: 'string' }, only: { type: 'string' }, timeout: { type: 'string', default: '420' }, questions: { type: 'string' } } });

/** Each question and the file(s) a right answer names (all of `all`, or any of `any`). */
const QUESTIONS: { ask: string; any?: RegExp[]; all?: RegExp[]; atLeast?: { of: RegExp[]; n: number } }[] = [
  { ask: 'Where is the owner token checked on sign-in? Name the file.', any: [/\bauth\.ts\b/] },
  { ask: 'Which file reads PDF files?', any: [/\bpdf\.ts\b/] },
  { ask: 'What calls disclosureText? List the files.', atLeast: { of: [/\bchat\.ts\b/, /\bbriefing\.ts\b/, /\blife\.ts\b/, /\bleaveby\.ts\b/, /\breview\.ts\b/, /\bserver\.ts\b/, /\blive\.ts\b/, /\btelegram\.ts\b/, /\bdiscord\.ts\b/], n: 3 } },
  { ask: 'Which file decides when the AI disclosure is due again?', any: [/\bsafety\.ts\b/] },
  { ask: 'Where does the code restore a workspace snapshot? Name the file.', any: [/\bsnapshots\.ts\b/] },
  { ask: 'Which file splits library documents into passages?', any: [/\blibrary\/store\.ts\b|\bstore\.ts\b/] },
  { ask: 'Where is the Telegram bot long polling implemented?', any: [/\btelegram\.ts\b/] },
  { ask: 'Which file encrypts the secrets vault, and with what cipher?', any: [/\bvault\.ts\b/] },
];

function passes(q: (typeof QUESTIONS)[number], answer: string): boolean {
  if (q.any && !q.any.some((r) => r.test(answer))) return false;
  if (q.all && !q.all.every((r) => r.test(answer))) return false;
  if (q.atLeast && q.atLeast.of.filter((r) => r.test(answer)).length < q.atLeast.n) return false;
  return true;
}

const dataDir = mkdtempSync(join(tmpdir(), 'sara-codemap-eval-'));
const vault = new Vault(dataDir);
const store = new Store(join(dataDir, 'sara.db'));
const tools = new ToolRegistry();
const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools, approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: false, detail: 'eval' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), events: new EventHub() };
app.settings.update({
  providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
  defaultProviderId: 'ol',
  defaultModel: opt.model,
  ownerName: 'Alex',
  timeZone: 'America/Chicago',
  disclosureAcceptedAt: new Date().toISOString(),
  ...(opt.embed ? { routes: { embeddings: { providerId: 'ol', model: opt.embed } } } : {}),
});
const maps = new CodeMaps({ cacheDir: join(dataDir, 'cache', 'codemap'), target: () => embedTarget(app) });
app.codemap = maps;
for (const t of createCodeTools(() => app.codemap)) tools.add(t);

// Sara's own code in a workspace.
const ws = workspaceDir(dataDir, 'sara');
for (const d of ['src', 'web', 'test']) cpSync(join(ROOT, d), join(ws, d), { recursive: true });
for (const f of ['package.json', 'README.md']) cpSync(join(ROOT, f), join(ws, f));
const t0 = Date.now();
const store0 = maps.get(ws);
store0.refreshAll();
const indexMs = Date.now() - t0;
let vectorMs = 0;
if (opt.embed) {
  const t1 = Date.now();
  const target = embedTarget(app)!;
  while (await store0.indexVectors(target, 64)) {
    /* all chunks */
  }
  vectorMs = Date.now() - t1;
}
console.log(`Mapped ${store0.status().files} files in ${indexMs} ms${opt.embed ? `; vectors in ${Math.round(vectorMs / 1000)} s` : ''}.`);

const CODE_TOOLS = ['code_map', 'code_find', 'code_refs', 'code_deps'];
const OFF = ['write_file', 'edit_file', 'shell', 'web_fetch'];
type Run = { ask: string; pass: boolean; toolCalls: number; byTool: Record<string, number>; filesRead: string[]; seconds: number; answer: string; error?: string };

async function runMode(mode: 'with' | 'without'): Promise<Run[]> {
  const perms: Record<string, Permission> = Object.fromEntries(OFF.map((n) => [n, 'never' as Permission]));
  if (mode === 'without') for (const n of CODE_TOOLS) perms[n] = 'never';
  app.settings.update({ toolPermissions: perms });
  const out: Run[] = [];
  const picked = opt.questions ? opt.questions.split(',').map((n) => QUESTIONS[Number(n) - 1]).filter(Boolean) : QUESTIONS;
  for (const q of picked) {
    const conv = store.createConversation({ mode: 'coding', workspace: 'sara', title: `${mode}: ${q.ask.slice(0, 40)}` });
    const started = Date.now();
    const byTool: Record<string, number> = {};
    const files = new Set<string>();
    let answer = '';
    let error: string | undefined;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), Number(opt.timeout) * 1000);
    try {
      for await (const ev of runTurn(app, conv.id, q.ask, ctl.signal)) {
        if (ev.type === 'token') answer += ev.text;
        else if (ev.type === 'tool_call') {
          byTool[ev.name] = (byTool[ev.name] ?? 0) + 1;
          if (ev.name === 'read_file' && typeof ev.args.path === 'string') files.add(ev.args.path.replace(/^\.\//, ''));
          answer = ''; // keep only the final reply's words
        } else if (ev.type === 'error') error = ev.message;
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      clearTimeout(timer);
    }
    const final = store.messages(conv.id).filter((m) => m.role === 'assistant' && m.content.trim()).at(-1)?.content ?? answer;
    const run: Run = { ask: q.ask, pass: !error && passes(q, final), toolCalls: Object.values(byTool).reduce((a, b) => a + b, 0), byTool, filesRead: [...files], seconds: Math.round((Date.now() - started) / 1000), answer: final.slice(0, 600), ...(error ? { error } : {}) };
    out.push(run);
    console.log(`[${mode}] ${run.pass ? 'PASS' : 'FAIL'} ${q.ask} — ${run.toolCalls} tool calls (${Object.entries(byTool).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}), ${run.filesRead.length} files read, ${run.seconds}s${error ? ` [${error}]` : ''}\n    ${final.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
  return out;
}

const summary = (runs: Run[]) => ({ pass: runs.filter((r) => r.pass).length, of: runs.length, toolCalls: runs.reduce((n, r) => n + r.toolCalls, 0), filesRead: runs.reduce((n, r) => n + r.filesRead.length, 0), seconds: runs.reduce((n, r) => n + r.seconds, 0) });
const result: Record<string, unknown> = { at: new Date().toISOString(), model: opt.model, embed: opt.embed ?? null, files: store0.status().files, indexMs, vectorMs };
try {
  if (opt.only !== 'with') {
    const runs = await runMode('without');
    result.without = { ...summary(runs), runs };
  }
  if (opt.only !== 'without') {
    const runs = await runMode('with');
    result.with = { ...summary(runs), runs };
  }
} finally {
  maps.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
for (const m of ['without', 'with'] as const) {
  const s = result[m] as ReturnType<typeof summary> | undefined;
  if (s) console.log(`${m.padEnd(7)} code tools: ${s.pass}/${s.of} right · ${s.toolCalls} tool calls · ${s.filesRead} files read · ${s.seconds}s`);
}
const out = join(ROOT, 'evals', 'results', `${new Date().toISOString().slice(0, 10)}-codemap.json`);
mkdirSync(dirname(out), { recursive: true });
// Merge with earlier runs of the day (never overwrite them).
let all: unknown[] = [];
if (existsSync(out)) {
  try {
    const prev = JSON.parse(readFileSync(out, 'utf8')) as unknown;
    all = Array.isArray(prev) ? prev : [prev];
  } catch {
    all = [];
  }
}
all.push(result);
writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Results: ${out}`);
