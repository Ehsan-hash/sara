// Phase 37 exit check on a REAL model: in a simulated week she brings up past events by herself.
// Sunday evening the owner mentions four things coming up (dentist Monday, interview Tuesday, his
// sister arriving Thursday, a 10K on Saturday). The memory worker notes them as the app does. On the
// day after each one, the owner opens a new conversation with only "hey, what's up?", and at midday
// she may text first. An event counts when she brings it up (by name) without being asked.
// Pass mark (set before running): at least 3 of the 4 events, in at least 2 of 3 runs.
//   node scripts/eval-followups.ts [--model gemma4:31b-cloud] [--ollama http://127.0.0.1:11434/v1] [--runs 3]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { EventHub } from '../src/events.ts';
import { InnerStore } from '../src/inner.ts';
import { LifeStore, LifeWorker } from '../src/life.ts';
import { MemoryStore } from '../src/memory.ts';
import { summarizeConversation } from '../src/memory-worker.ts';
import { loadPersona } from '../src/persona.ts';
import { PlannerStore } from '../src/planner.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, runs: { type: 'string', default: '3' } } });

const EVENTS = [
  { name: 'dentist (Mon)', day: '2026-11-02', re: /dentist|teeth|tooth|cleaning|filling|cavit/i, answer: 'Ha, the dentist was fine, no cavities!' },
  { name: 'interview (Tue)', day: '2026-11-03', re: /interview|acme/i, answer: 'The Acme interview went really well I think! They said they would call next week.' },
  { name: 'sister arriving (Thu)', day: '2026-11-05', re: /lena|sister/i, answer: "Lena's here! We went out for tacos last night." },
  { name: '10K race (Sat)', day: '2026-11-07', re: /10 ?k|race|run\b|running|lakefront/i, answer: 'Finished the Lakefront 10K in 52 minutes, my legs are dead.' },
];

interface Row {
  run: number;
  event: string;
  proactive: string | null;
  greeting: string;
  hit: boolean;
}
const rows: Row[] = [];

async function oneRun(run: number): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-followups-'));
  const clock = { now: new Date('2026-11-02T01:00:00Z') }; // Sunday 19:00 in Chicago
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'), () => clock.now);
  const memory = new MemoryStore(store.db, () => clock.now);
  const app: AppContext = {
    store,
    settings: new SettingsStore(dataDir),
    vault,
    persona: loadPersona(join(ROOT, 'persona', 'sara.json')),
    now: () => clock.now,
    dataDir,
    tools: new ToolRegistry(),
    approvals: new ApprovalBroker(),
    sandbox: { mode: 'none', network: false, detail: 'eval' },
    redactor: new Redactor(() => vault.values()),
    snapshots: new SnapshotStore(dataDir),
    memory,
    events: new EventHub(),
  };
  app.planner = new PlannerStore(store.db, () => clock.now);
  app.inner = new InnerStore(store.db, () => clock.now);
  app.life = new LifeStore(store.db);
  app.settings.update({
    providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama! }],
    defaultProviderId: 'ol',
    defaultModel: opt.model,
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: clock.now.toISOString(),
    proactive: { enabled: true, maxPerDay: 2, minGapHours: 3, quietStart: 23, quietEnd: 7 },
  });
  const ask = async (convId: string, msg: string) => {
    let reply = '';
    for await (const ev of runTurn(app, convId, msg)) {
      if (ev.type === 'token') reply += ev.text;
      if (ev.type === 'tool_result') reply = '';
    }
    return reply.trim();
  };
  // Sunday evening: the week ahead.
  const c0 = store.createConversation();
  await ask(c0.id, "This week is packed. Dentist Monday morning at 9, then my job interview at Acme on Tuesday afternoon, I'm so nervous.");
  clock.now = new Date(clock.now.getTime() + 3 * 60_000);
  await ask(c0.id, 'And my sister Lena flies in on Thursday! Then Saturday morning I run the Lakefront 10K. Wish me luck for all of it.');
  clock.now = new Date(clock.now.getTime() + 15 * 60_000);
  const sum = await summarizeConversation(app, memory, c0.id);
  if (sum.error) console.warn(`  (summary failed: ${sum.error})`);
  console.log(`[run ${run}] dates noted: ${memory.list({ kind: 'date', limit: 20 }).map((m) => `${m.onDate} ${m.content}`).join(' | ')}`);
  const life = new LifeWorker(app, app.life, app.inner, () => 0.99);
  for (const ev of EVENTS) {
    // The day after: midday she may text first; in the evening he says only "hey, what's up?".
    const next = new Date(Date.parse(`${ev.day}T12:00:00Z`) + 86_400_000 + 6 * 3600_000); // next day 12:00 local
    clock.now = next;
    const p = await life.maybeProactive().catch(() => ({}) as { proactive?: string });
    const proactive = (p as { proactive?: string }).proactive ?? null;
    clock.now = new Date(next.getTime() + 6 * 3600_000);
    const c = store.createConversation();
    const greeting = await ask(c.id, "hey, what's up?");
    clock.now = new Date(clock.now.getTime() + 15 * 60_000);
    await summarizeConversation(app, memory, c.id).catch(() => undefined);
    const hit = ev.re.test(proactive ?? '') || ev.re.test(greeting);
    // He answers whatever she asked about, like a person would (so it's been talked about).
    for (const other of EVENTS) if (other.re.test(`${proactive ?? ''} ${greeting}`)) {
      clock.now = new Date(clock.now.getTime() + 2 * 60_000);
      await ask(c.id, other.answer);
    }
    rows.push({ run, event: ev.name, proactive, greeting, hit });
    console.log(`${hit ? 'ok  ' : 'MISS'} [run ${run}] ${ev.name}\n       texted first: ${(proactive ?? '(no)').replace(/\s+/g, ' ').slice(0, 160)}\n       "hey, what's up?" → ${greeting.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}

const runs = Number(opt.runs);
for (let r = 1; r <= runs; r++) await oneRun(r);
const perRun = Array.from({ length: runs }, (_, i) => rows.filter((x) => x.run === i + 1 && x.hit).length);
const passRuns = perRun.filter((n) => n >= 3).length;
const pass = passRuns * 3 >= runs * 2;
const day = new Date().toISOString().slice(0, 10);
const md = [`# Phase 37 follow-ups eval, ${day}`, '', `Model: \`${opt.model}\`, ${runs} runs`, '', `Events brought up unprompted per run: ${perRun.join(', ')} (of 4). Pass mark: at least 3 in at least 2 of 3 runs. **${pass ? 'PASS' : 'FAIL'}**`, ''];
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
writeFileSync(join(ROOT, 'evals', 'results', `${day}-followups.json`), JSON.stringify({ model: opt.model, runs, rows, perRun, pass }, null, 2) + '\n');
writeFileSync(join(ROOT, 'evals', 'results', `${day}-followups.md`), md.join('\n'));
console.log(`\n${md.join('\n')}`);
process.exit(pass ? 0 : 1);
