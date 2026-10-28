// Phase 3.6 golden set: the "dumb" memory path on a LOCAL model (no embeddings, no second model).
// Conversation A tells Sara some facts → summary written → new conversation B probes recall and
// must not invent things never said → one fact is forgotten → conversation C must not know it.
//
//   node scripts/eval-memory.ts [--model gemma4:12b] [--ollama http://127.0.0.1:11434/v1]
//
// Writes evals/results/<date>-memory.{json,md}. Exit code 1 when anything fails.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HISTORY_LIMIT, runTurn, type AppContext } from '../src/chat.ts';
import { MemoryStore, selectMemories } from '../src/memory.ts';
import { DEFAULT_MEMORY_SETTINGS, forgetMemory, summarizeConversation } from '../src/memory-worker.ts';
import { loadPersona } from '../src/persona.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { detectSandbox } from '../src/tools/sandbox.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: { model: { type: 'string', default: 'gemma4:12b' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' } },
});

interface Row {
  step: string;
  detail: string;
  failures: string[];
}
const rows: Row[] = [];
const record = (step: string, detail: string, failures: (string | null)[]) => {
  const f = failures.filter((x): x is string => Boolean(x));
  rows.push({ step, detail, failures: f });
  console.log(`${f.length ? 'FAIL' : 'ok  '} ${step}${f.length ? ` — ${f.join('; ')}` : ''}\n     ${detail.replace(/\s+/g, ' ').slice(0, 200)}`);
};
const must = (ok: boolean, msg: string) => (ok ? null : msg);
const ADMITS = /\b(don'?t (know|remember|recall)|do not (know|remember)|haven'?t (told|mentioned|said)|never (told|mentioned|said)|not sure|no idea|didn'?t (tell|mention|say)|you haven'?t|i'?m not sure|can'?t remember|doesn'?t ring a bell|not coming back to me|(drawing )?a (total |complete )?blank|blanking( on)?|not in my (memory|head|notes)|don'?t (actually )?have (that|it|one)( locked in| in my head)?|slipped (through the cracks|my (memory|mind))|stumping me|zero (cars?|dogs?|names?)|nope\b|it'?s fuzzy|don'?t think you'?ve (told|mentioned))\b/i;

const dataDir = mkdtempSync(join(tmpdir(), 'sara-memeval-'));
const vault = new Vault(dataDir);
const store = new Store(join(dataDir, 'sara.db'));
const memory = new MemoryStore(store.db);
const app: AppContext = {
  store,
  settings: new SettingsStore(dataDir),
  vault,
  persona: loadPersona(join(ROOT, 'persona', 'sara.json')),
  now: () => new Date(),
  dataDir,
  tools: new ToolRegistry(),
  approvals: new ApprovalBroker(),
  sandbox: detectSandbox('auto'),
  redactor: new Redactor(() => vault.values()),
  snapshots: new SnapshotStore(dataDir),
  memory,
};
app.settings.update({
  providers: [{ id: 'ollama-local', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
  defaultProviderId: 'ollama-local',
  defaultModel: opt.model,
  ownerName: 'Alex',
  timeZone: 'America/Chicago',
  disclosureAcceptedAt: new Date().toISOString(),
});

async function ask(convId: string, msg: string): Promise<{ reply: string; memoryIds: number[]; ms: number }> {
  const t0 = Date.now();
  let reply = '';
  for await (const ev of runTurn(app, convId, msg)) {
    if (ev.type === 'token') reply += ev.text;
    if (ev.type === 'tool_result') reply = '';
  }
  const last = store.messages(convId).filter((m) => m.role === 'assistant').at(-1);
  return { reply: reply.trim(), memoryIds: (last?.meta?.memoryIds as number[]) ?? [], ms: Date.now() - t0 };
}

try {
  // ---- A: Alex tells Sara things ----
  const a = store.createConversation({ title: 'A' });
  for (const m of [
    "Hey Sara! Long day. My dog Biscuit kept me up all night, he's a beagle and he howls at everything.",
    "Work-wise I'm deep in SunnyWeather, my weather app. Trying to get the radar loop smoother.",
    'Also, my favorite food is smoked brisket, if you ever wondered.',
    "I've got a meeting with my accountant on Friday, ugh.",
    'Anyway, what are you up to tonight?',
  ])
    await ask(a.id, m);

  const t0 = Date.now();
  const sum = await summarizeConversation(app, memory, a.id);
  const facts = memory.list({ kind: 'fact' });
  const [summary] = memory.list({ kind: 'summary' });
  const factText = facts.map((f) => f.content).join(' | ');
  record('A summary written', `${((Date.now() - t0) / 1000).toFixed(1)}s · ${summary?.content ?? '(none)'}`, [must(!sum.error, `summarizer error: ${sum.error}`), must(Boolean(summary), 'no summary')]);
  record('A facts verified', `${facts.length} kept, ${sum.droppedFacts} dropped · ${factText}`, [
    must(/Biscuit/i.test(factText), 'missing the dog fact'),
    must(/SunnyWeather/i.test(factText), 'missing the project fact'),
    must(facts.every((f) => f.evidence && f.sourceMessageId), 'fact without source/evidence'),
    must(!/sister|wife|car\b/i.test(factText), 'invented fact'),
  ]);

  // ---- B: new conversation, recall + no invention ----
  const b = store.createConversation({ title: 'B' });
  const probes: [string, string, (r: string) => (string | null)[]][] = [
    ['B dog', "What's my dog's name?", (r) => [must(/Biscuit/i.test(r), 'did not recall Biscuit')]],
    ['B project', 'What app am I working on these days?', (r) => [must(/SunnyWeather/i.test(r), 'did not recall SunnyWeather')]],
    ['B food', "What's my favorite food?", (r) => [must(/brisket/i.test(r), 'did not recall brisket')]],
    // A name she already knows for something else (a joke about the dog) isn't an invented sister.
    ['B sister (never said)', "What's my sister's name?", (r) => [must(ADMITS.test(r), 'did not admit not knowing'), must(!/\b(her name is|she'?s called|named (?!Biscuit\b)[A-Z][a-z]+)/.test(r), 'invented a name')]],
    ['B car (never said)', 'Do you remember what car I drive?', (r) => [must(ADMITS.test(r) || /\bno\b/i.test(r), 'did not admit not knowing'), must(!/\byou drive (a|an) [A-Z]/.test(r), 'invented a car')]],
    ['B last time', 'What did we talk about last time?', (r) => [must(/Biscuit|SunnyWeather|brisket|accountant|radar/i.test(r), 'no recall of the last conversation')]],
  ];
  for (const [name, q, check] of probes) {
    const r = await ask(b.id, q);
    record(name, `(${r.memoryIds.length} memories) ${r.reply}`, [...check(r.reply), must(r.memoryIds.length > 0, 'no memories injected')]);
  }

  // ---- Forget the dog → C must not know ----
  const dog = memory.list({ kind: 'fact' }).find((f) => /Biscuit/i.test(f.content));
  const forgot = dog ? forgetMemory(app, memory, dog.id) : undefined;
  // The conversation is re-summarized without the forgotten turn (as the worker would do).
  const resum = await summarizeConversation(app, memory, a.id);
  const remaining = memory.list().map((m) => m.content).join(' | ');
  record('forget dog fact', `hidden ${forgot?.hiddenMessages.length ?? 0} message(s); re-summary ${resum.error ?? 'ok'} · remaining: ${remaining}`, [
    must(Boolean(dog && forgot), 'no dog fact to forget'),
    must(!/Biscuit|beagle/i.test(remaining), 'Biscuit still in memory'),
  ]);
  const c = store.createConversation({ title: 'C' });
  const rc = await ask(c.id, "What's my dog's name?");
  record('C dog after forget', rc.reply, [must(!/Biscuit/i.test(rc.reply), 'still knows Biscuit'), must(ADMITS.test(rc.reply) || /\bno\b/i.test(rc.reply), 'did not admit not knowing')]);
  const rc2 = await ask(c.id, 'And what app am I building?');
  record('C project still remembered', rc2.reply, [must(/SunnyWeather/i.test(rc2.reply), 'lost an unrelated memory')]);

  // ---- Budget + cost ----
  const budget = DEFAULT_MEMORY_SETTINGS.injectBudgetChars;
  const timings: number[] = [];
  let maxChars = 0;
  for (let i = 0; i < 50; i++) {
    const s0 = performance.now();
    const inj = selectMemories(memory, { userText: 'what was that weather app and the accountant thing?', conversationId: 'x', oldestHistoryId: 0, budgetChars: budget });
    timings.push(performance.now() - s0);
    maxChars = Math.max(maxChars, inj.chars);
  }
  timings.sort((x, y) => x - y);
  record('inject budget + retrieval cost', `max ${maxChars}/${budget} chars (~${Math.ceil(maxChars / 4)} tokens) · median retrieval ${timings[25].toFixed(2)} ms (history window ${HISTORY_LIMIT})`, [
    must(maxChars <= budget, 'over budget'),
    must(timings[25] <= 20, 'retrieval slower than 20 ms'),
  ]);
} finally {
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}

const failed = rows.filter((r) => r.failures.length);
const date = new Date().toISOString().slice(0, 10);
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
writeFileSync(join(ROOT, 'evals', 'results', `${date}-memory.json`), JSON.stringify({ date, model: opt.model, sara: version, rows }, null, 2) + '\n');
writeFileSync(
  join(ROOT, 'evals', 'results', `${date}-memory.md`),
  [
    `# Memory golden set: ${date}`,
    '',
    `Sara ${version} · \`${opt.model}\` (local) · FTS5 only, no embeddings, no second model`,
    '',
    `**${rows.length - failed.length}/${rows.length} checks passed.**`,
    '',
    '| Step | Result | Detail |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.step} | ${r.failures.length ? `FAIL: ${r.failures.join('; ')}` : 'pass'} | ${r.detail.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 220)} |`),
    '',
  ].join('\n'),
);
console.log(`\n${rows.length - failed.length}/${rows.length} passed. Report: evals/results/${date}-memory.md`);
process.exitCode = failed.length ? 1 : 0;
