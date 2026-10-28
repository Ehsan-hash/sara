// Phase 39 exit check on REAL models: a multi-part coding task (plan → code → test → review) in a
// small project that already has a hidden bug (its test fails). The team should finish with at
// least three helpers, the tester should catch the failing test and the coder fix it, and every
// receipt in her report should match what really happened (checked here independently: the
// files exist, and `node --test` passes when this script runs it itself).
//   node scripts/eval-team.ts [--ollama http://127.0.0.1:11434/v1] [--chat gemma4:31b-cloud]
//        [--coding kimi-k2.7-code:cloud] [--runs 1]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { AppContext } from '../src/chat.ts';
import { EventHub } from '../src/events.ts';
import { MemoryStore } from '../src/memory.ts';
import { loadPersona } from '../src/persona.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { lastRunFailed, TeamManager, teamHelpers } from '../src/team.ts';
import { editFileTool, listDir, readFileTool, searchTool, shellTool, writeFileTool } from '../src/tools/builtin.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, chat: { type: 'string', default: 'gemma4:31b-cloud' }, coding: { type: 'string', default: 'kimi-k2.7-code:cloud' }, runs: { type: 'string', default: '1' } } });

const PRICE = `// Prices for a small shop.
export function total(items) {
  // Sum of price × quantity for each item.
  let sum = 0;
  for (const it of items) sum += it.price;
  return Math.round(sum * 100) / 100;
}
`;
const PRICE_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from './price.js';

test('total adds price × quantity', () => {
  assert.equal(total([{ price: 2.5, quantity: 2 }, { price: 1, quantity: 3 }]), 8);
});
`;
const GOAL = 'In this project, add a function discount(amount, percent) to price.js that returns the amount reduced by the percent, rounded to cents (percent outside 0 to 100 throws a RangeError). Add tests for it in price.test.js. Make sure all the tests pass with `node --test`, and get the change reviewed.';

let fails = 0;
for (let run = 1; run <= Number(opt.runs); run++) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-team-'));
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'));
  const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools: new ToolRegistry(), approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: false, detail: 'eval' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), memory: new MemoryStore(store.db), events: new EventHub() };
  for (const t of [listDir, readFileTool, writeFileTool, editFileTool, searchTool, shellTool]) app.tools.add(t);
  app.team = new TeamManager(app, store.db);
  app.settings.update({
    providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
    defaultProviderId: 'ol',
    defaultModel: opt.chat,
    routes: { coding: { providerId: 'ol', model: opt.coding! } },
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    toolPermissions: { shell: 'auto', write_file: 'auto', edit_file: 'auto' },
    shellNetwork: false,
    // The owner's own Coder (replaces the built-in): no shell, so the tester is the one who runs
    // the tests (otherwise a strong coder finds and fixes the hidden bug before the tester sees it).
    helpers: [{ id: 'coder', name: 'Coder', role: 'coder', instructions: "You can't run commands; the tester runs the tests.", tools: ['list_dir', 'read_file', 'search', 'write_file', 'edit_file'] }],
  });
  const conv = store.createConversation({ mode: 'coding', title: 'Team eval' });
  const ws = workspaceDir(dataDir, conv.workspace);
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'package.json'), '{ "name": "shop", "type": "module", "scripts": { "test": "node --test" } }\n');
  writeFileSync(join(ws, 'price.js'), PRICE);
  writeFileSync(join(ws, 'price.test.js'), PRICE_TEST);
  const t0 = Date.now();
  const task = app.team.start(conv.id, GOAL, { limits: { minutes: 25, steps: 14 } });
  console.log(`[run ${run}] team task #${task.id} started`);
  const off = app.events!.subscribe((ev) => {
    if (ev.type !== 'team') return;
  });
  const done = await app.team.finished(task.id);
  off();
  const names = new Map(teamHelpers(app).map((h) => [h.id, h.name]));
  console.log(`[run ${run}] ${done.status} in ${Math.round((Date.now() - t0) / 1000)} s, about ${done.tokens.toLocaleString('en-US')} tokens`);
  for (const s of done.steps) console.log(`  ${s.idx + 1}. ${names.get(s.helper) ?? s.helper}: ${s.title} [${s.status}]${s.because ? ` (${s.because})` : ''}\n     ${s.receipts.map((r) => `${r.name}${r.name === 'shell' ? ` \`${String(r.args.command).slice(0, 60)}\` → ${/^\[(exit code \w+)/.exec(r.output)?.[1] ?? r.status}` : r.args.path ? ` ${r.args.path}` : ''}`).join('; ') || '(no tools)'}`);
  const msg = store.messages(conv.id).filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
  console.log(`  her report:\n${msg.split('\n').map((l) => `   | ${l}`).join('\n')}`);
  // Independent checks.
  const helpersUsed = new Set(done.steps.filter((s) => s.status === 'done').map((s) => s.helper));
  const testers = done.steps.filter((s) => names.get(s.helper) === 'Tester' && s.status === 'done');
  const caught = testers.some((s) => lastRunFailed(s.receipts));
  const fixed = done.steps.some((s) => s.because && /found a failure/.test(s.because) && s.status === 'done');
  let testsPass = false;
  try {
    execFileSync(process.execPath, ['--test'], { cwd: ws, stdio: 'pipe', timeout: 60_000 });
    testsPass = true;
  } catch {
    testsPass = false;
  }
  const filesLine = /Files written or changed: (.+)/.exec(msg)?.[1] ?? '';
  const filesExist = filesLine.split(', ').filter(Boolean).every((f) => existsSync(join(ws, f)));
  const reportRuns = [...msg.matchAll(/ran `.*?`: exit code (\d+)/g)].map((m) => Number(m[1]));
  const realRuns = done.steps.flatMap((s) => s.receipts).filter((r) => r.name === 'shell').map((r) => Number(/^\[exit code (\d+)/.exec(r.output)?.[1] ?? -1));
  const checks: [boolean, string][] = [
    [done.status === 'done', `finished (status ${done.status})`],
    [helpersUsed.size >= 3, `${helpersUsed.size} helpers did a part (${[...helpersUsed].map((h) => names.get(h)).join(', ')})`],
    [caught, 'the tester caught the failing test'],
    [fixed, 'the coder fixed it after being sent back'],
    [testsPass, '`node --test` passes when run independently'],
    [filesExist, `every file in her report exists (${filesLine || 'none'})`],
    [JSON.stringify(reportRuns) === JSON.stringify(realRuns), `the runs in her report match the receipts (${reportRuns.join(', ')})`],
  ];
  for (const [ok, what] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails++;
  }
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
console.log(fails ? `\n${fails} FAILED` : '\nPASS');
process.exit(fails ? 1 : 0);
