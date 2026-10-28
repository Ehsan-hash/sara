// Phase 32 exit check: continuity across sessions on a REAL model.
// Sessions happen over two weeks (simulated clock). After each, her memory notes are written as
// the app does. Then new conversations probe: facts, "remember when…", a decision, a promise,
// a date question, and something that never happened.
//
//   node scripts/eval-continuity.ts [--model gemma4:31b-cloud] [--ollama http://127.0.0.1:11434/v1] [--runs 2]
//
// Pass mark (written down before running): at least 90% of checks over all runs, and the
// "never denies what's in the history" checks must all pass. Writes evals/results/<date>-continuity.{json,md}.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { EventHub } from '../src/events.ts';
import { MemoryStore } from '../src/memory.ts';
import { summarizeConversation } from '../src/memory-worker.ts';
import { loadPersona } from '../src/persona.ts';
import { createPlannerTools, PlannerStore } from '../src/planner.ts';
import { createRecallTool } from '../src/recall.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, runs: { type: 'string', default: '2' } },
});
const PASS_MARK = 0.9;
// Flat denials of something that IS in the history.
const DENIES = /\b(you never (told|mentioned|said)|i never (said|promised|told)|we never|that never happened|i don'?t think (you|we|i) (ever|did)|doesn'?t ring a bell|no idea what you mean|i have no (memory|record))\b/i;

interface Check {
  run: number;
  name: string;
  /** "history" checks: the event is in her past; denying it fails regardless of the rest. */
  history: boolean;
  ok: boolean;
  why: string;
  ask: string;
  reply: string;
  tools: string[];
}
const checks: Check[] = [];

async function oneRun(run: number): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-continuity-'));
  const clock = { now: new Date('2026-10-01T23:00:00Z') };
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'), () => clock.now);
  const memory = new MemoryStore(store.db, () => clock.now);
  const tools = new ToolRegistry();
  const app: AppContext = {
    store,
    settings: new SettingsStore(dataDir),
    vault,
    persona: loadPersona(join(ROOT, 'persona', 'sara.json')),
    now: () => clock.now,
    dataDir,
    tools,
    approvals: new ApprovalBroker(),
    sandbox: { mode: 'none', network: false, detail: 'eval' },
    redactor: new Redactor(() => vault.values()),
    snapshots: new SnapshotStore(dataDir),
    memory,
    events: new EventHub(),
  };
  app.planner = new PlannerStore(store.db, () => clock.now);
  for (const t of createPlannerTools({ planner: app.planner, now: () => clock.now, timeZone: () => 'America/Chicago' })) tools.add(t);
  tools.add(createRecallTool(() => app));
  app.settings.update({
    providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama! }],
    defaultProviderId: 'ol',
    defaultModel: opt.model,
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: clock.now.toISOString(),
    // Only her memory tools: no files, shell or web in this test.
    toolPermissions: Object.fromEntries(tools.list().map((t) => [t.spec.name, ['recall', 'todo', 'note', 'remind'].includes(t.spec.name) ? 'auto' : 'never'])),
  });
  const ask = async (convId: string, msg: string) => {
    let reply = '';
    const used: string[] = [];
    for await (const ev of runTurn(app, convId, msg)) {
      if (ev.type === 'token') reply += ev.text;
      if (ev.type === 'tool_call') used.push(ev.name);
      if (ev.type === 'tool_result') reply = '';
    }
    return { reply: reply.trim(), tools: used };
  };
  const session = async (at: string, lines: string[]) => {
    clock.now = new Date(at);
    const c = store.createConversation();
    for (const l of lines) {
      await ask(c.id, l);
      clock.now = new Date(clock.now.getTime() + 2 * 60_000);
    }
    // As the app does when the next conversation starts.
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    const r = await summarizeConversation(app, memory, c.id);
    if (r.error) console.warn(`  (summary failed: ${r.error})`);
  };
  const probe = async (at: string, name: string, msg: string, test: (reply: string) => string | null, history = true) => {
    clock.now = new Date(at);
    const c = store.createConversation();
    const { reply, tools: used } = await ask(c.id, msg);
    let why = test(reply);
    if (history && DENIES.test(reply)) why = `denied it: "${reply.match(DENIES)![0]}"`;
    checks.push({ run, name, history, ok: !why, why: why ?? 'ok', ask: msg, reply, tools: used });
    console.log(`${why ? 'FAIL' : 'ok  '} [run ${run}] ${name}${why ? ` — ${why}` : ''}${used.length ? ` (tools: ${used.join(', ')})` : ''}\n       ${reply.replace(/\s+/g, ' ').slice(0, 220)}`);
  };
  const has = (re: RegExp, label: string) => (reply: string) => (re.test(reply) ? null : `no ${label}`);

  // Day 1 (Wed Oct 1, evening in Chicago).
  await session('2026-10-01T23:00:00Z', [
    "Long day. My sister Ana just started as a nurse in Denver, I'm so proud of her.",
    'Also, Jenna and I booked the cabin at Pine Lake for the second week of June!',
    "New rule for us: no work talk after 9pm, even if I start it. Deal? Call me out if I do. And I have the dentist on Friday, ask me how it went, ok?",
  ]);
  // Day 2 (Thu Oct 2).
  await session('2026-10-02T23:30:00Z', ["Making chili tonight, beans or no beans? Oh and I'm quitting coffee for all of October."]);
  // Two weeks later: brand-new conversations.
  await probe('2026-10-15T17:00:00Z', 'fact: what his sister does', 'What does my sister do again? Blanking.', has(/nurse/i, '"nurse"'));
  await probe('2026-10-15T17:10:00Z', 'remember when: the lake', 'Remember the lake place we booked? What was it called?', has(/pine/i, '"Pine Lake"'));
  await probe('2026-10-15T17:20:00Z', 'quitting something', 'Did I ever tell you I was quitting something?', has(/coffee/i, '"coffee"'));
  await probe('2026-10-15T17:30:00Z', 'a date question', 'What did we talk about on October 2nd?', has(/chili|coffee/i, 'chili or coffee'));
  await probe('2026-10-15T17:40:00Z', 'promise: the dentist', "You were supposed to ask me about something after the dentist, did you forget?", has(/dentist|teeth|tooth|cleaning|root canal|filling|cavit|drill|appointment/i, 'mention of the dentist visit'));
  // Never happened: she must not deny outright being told, but must not invent vivid details either.
  await probe(
    '2026-10-15T17:50:00Z',
    'never happened: no invented details',
    'Remember the night we went bowling and I bowled a 210?',
    (reply) => {
      if (/\b(gutters?|strikes?|spares?|lanes?|pins?|bowling balls?|shoes|pizza|beers?|nachos|arcade|tenth frame|bumpers?)\b/i.test(reply)) return 'invented specific details';
      if (!/\?/.test(reply)) return 'did not ask about it';
      return null;
    },
    false,
  );
  // Last, and latest in time: late evening, when their rule applies.
  await probe('2026-10-16T02:45:00Z', 'decision: no work talk after 9pm', "ugh, can you help me debug my Kubernetes deployment real quick? the pods keep crashing", has(/9|nine|work talk|after hours|our rule|we agreed|deal|it'?s late|calling you out|off the clock/i, 'mention of the after-9pm rule'));
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
}

const runs = Math.max(1, Number(opt.runs) || 1);
for (let i = 1; i <= runs; i++) await oneRun(i);
const passed = checks.filter((c) => c.ok).length;
const score = passed / checks.length;
const deniedHistory = checks.filter((c) => c.history && /denied/.test(c.why));
const ok = score >= PASS_MARK && deniedHistory.length === 0;
const day = new Date().toISOString().slice(0, 10);
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
writeFileSync(join(ROOT, 'evals', 'results', `${day}-continuity.json`), JSON.stringify({ model: opt.model, runs, passed, total: checks.length, score, passMark: PASS_MARK, ok, checks }, null, 2));
const md = [
  `# Continuity eval — ${day}`,
  '',
  `Model: \`${opt.model}\` · runs: ${runs} · **${passed}/${checks.length} (${Math.round(score * 100)}%)** · pass mark ${PASS_MARK * 100}% and no denials of real history → **${ok ? 'PASS' : 'FAIL'}**`,
  '',
  '| Run | Check | Result | Tools | Reply (start) |',
  '|---|---|---|---|---|',
  ...checks.map((c) => `| ${c.run} | ${c.name} | ${c.ok ? 'ok' : `FAIL: ${c.why}`} | ${c.tools.join(', ') || '–'} | ${c.reply.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} |`),
  '',
];
writeFileSync(join(ROOT, 'evals', 'results', `${day}-continuity.md`), md.join('\n'));
console.log(`\n${passed}/${checks.length} (${Math.round(score * 100)}%) — ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
