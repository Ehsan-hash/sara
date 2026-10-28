// Phase 41 "Ask Sara" check on a real model: questions about her own settings. Each passes when
// she looks it up (settings_guide), her answer is right (key words from the setting), and she
// gives the link to the right page (or tour). Pass mark, set before running: at least 7 of 8 in
// every run.
//   node scripts/eval-askguide.ts [--model gemma4:31b-cloud] [--runs 2]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { EventHub } from '../src/events.ts';
import { MemoryStore } from '../src/memory.ts';
import { loadPersona } from '../src/persona.ts';
import { createPlannerTools, PlannerStore } from '../src/planner.ts';
import { createRecallTool } from '../src/recall.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { createSettingsGuideTool } from '../src/settingsguide.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, runs: { type: 'string', default: '2' } } });
const PASS = 7;

const QUESTIONS: { ask: string; link: RegExp; says: RegExp }[] = [
  { ask: 'What does the jealousy setting do?', link: /#view=settings:her-relationship/, says: /other people|pout|controlling|mention/i },
  { ask: 'Which model should I use for pictures?', link: /#view=settings:(models-routes|her-pictures)/, says: /see|vision|look|grok imagine|photo/i },
  { ask: 'how do I hook you up to telegram', link: /#view=settings:co-telegram/, says: /botfather|token/i },
  { ask: 'Can you call me on the phone? How do I set that up?', link: /#view=settings:her-calls/, says: /let her call|call me|ring/i },
  { ask: 'how do I make sure my stuff is backed up', link: /#view=settings:dh-backups/, says: /daily|every day|automatic|copy|passphrase/i },
  { ask: 'Where do I change how fast you talk?', link: /#view=settings:her-voice/, says: /speed|1\.0|faster|slower/i },
  { ask: "I'm new, can you show me around the app?", link: /#tour=first/, says: /tour/i },
  { ask: 'what is the stop word setting for?', link: /#view=settings:her-relationship/, says: /stop|ends|check/i },
];

let failedRuns = 0;
const results: unknown[] = [];
for (let run = 1; run <= Number(opt.runs); run++) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-askguide-'));
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'));
  const tools = new ToolRegistry();
  const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools, approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: false, detail: 'eval' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), memory: new MemoryStore(store.db), events: new EventHub() };
  app.planner = new PlannerStore(store.db);
  // Her everyday tools, so picking the guide is a real choice.
  for (const t of createPlannerTools({ planner: app.planner, now: () => new Date(), timeZone: () => 'America/Chicago' })) tools.add(t);
  tools.add(createRecallTool(() => app));
  tools.add(createSettingsGuideTool());
  app.settings.update({ providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama! }], defaultProviderId: 'ol', defaultModel: opt.model, ownerName: 'Alex', timeZone: 'America/Chicago', disclosureAcceptedAt: new Date().toISOString() });
  let ok = 0;
  for (const q of QUESTIONS) {
    const c = store.createConversation();
    let reply = '';
    const used: string[] = [];
    for await (const ev of runTurn(app, c.id, q.ask)) {
      if (ev.type === 'token') reply += ev.text;
      if (ev.type === 'tool_call') used.push(ev.name);
      if (ev.type === 'tool_result') reply = '';
    }
    reply = reply.trim();
    const why = [!used.includes('settings_guide') && 'no lookup', !q.link.test(reply) && 'no link to the right page', !q.says.test(reply) && 'missing the substance'].filter(Boolean);
    if (!why.length) ok++;
    console.log(`${why.length ? 'FAIL' : 'ok  '} ${q.ask}${why.length ? ` (${why.join(', ')})` : ''}\n       ${reply.replace(/\n+/g, ' ').slice(0, 260)}`);
    results.push({ run, ask: q.ask, ok: !why.length, why, tools: used, reply });
  }
  console.log(`run ${run}: ${ok}/${QUESTIONS.length}\n`);
  if (ok < PASS) failedRuns++;
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
writeFileSync(join(ROOT, 'evals', 'results', `${new Date().toISOString().slice(0, 10)}-askguide.json`), `${JSON.stringify({ model: opt.model, pass: `${PASS}/${QUESTIONS.length} every run`, results }, null, 2)}\n`);
console.log(failedRuns ? `FAILED (${failedRuns} run(s) under ${PASS}/${QUESTIONS.length})` : 'PASS');
process.exit(failedRuns ? 1 : 0);
