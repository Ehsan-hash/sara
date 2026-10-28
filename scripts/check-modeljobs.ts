// Phase 38 check on REAL models (Ollama): meaning search with a real embedding model finds notes
// said in other words that word search misses; Test / Compare / Recommended work on what's
// connected; a photo goes to the vision model and the next message back to the text model.
//   node scripts/check-modeljobs.ts [--ollama http://127.0.0.1:11434/v1] [--embed nomic-embed-text]
//        [--chat gpt-oss:20b-cloud] [--vision gemma4:31b-cloud]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { MemoryVectors, embedTarget } from '../src/embeddings.ts';
import { EventHub } from '../src/events.ts';
import { MemoryStore } from '../src/memory.ts';
import { compareModels, connectedModels, recommend, testModel } from '../src/modelpicks.ts';
import { loadPersona } from '../src/persona.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { UploadStore } from '../src/uploads.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, embed: { type: 'string', default: 'nomic-embed-text' }, chat: { type: 'string', default: 'gpt-oss:20b-cloud' }, vision: { type: 'string', default: 'gemma4:31b-cloud' } } });
const dataDir = mkdtempSync(join(tmpdir(), 'sara-modeljobs-'));
const vault = new Vault(dataDir);
const store = new Store(join(dataDir, 'sara.db'));
const memory = new MemoryStore(store.db);
const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools: new ToolRegistry(), approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: false, detail: 'check' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), memory, events: new EventHub(), uploads: new UploadStore(dataDir) };
app.settings.update({
  providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
  defaultProviderId: 'ol',
  defaultModel: opt.chat,
  ownerName: 'Alex',
  timeZone: 'America/Chicago',
  disclosureAcceptedAt: new Date().toISOString(),
  routes: { embeddings: { providerId: 'ol', model: opt.embed! }, vision: { providerId: 'ol', model: opt.vision! } },
});
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};

// 1. Meaning search on real notes, with questions that share no words with them.
const NOTES = [
  'Alex booked the Pine Lake cabin for the weekend of the 14th',
  "Alex's sister Lena is a nurse in Denver",
  'Alex is allergic to shellfish',
  'Alex wants to run a marathon next spring',
  'Alex drives a 2019 Subaru Outback that needs new brakes',
  'Alex and Sara decided to do Sunday check-ins about his week',
  'Alex hates cilantro',
  "Alex's dog Biscuit is a golden retriever",
  'Alex is learning Spanish on Duolingo',
  'Alex works as a project manager at a logistics company',
];
const ids = NOTES.map((content) => memory.add({ kind: 'fact', content, conversationId: null, sourceMessageId: null, happenedOn: '2026-10-01' }).id);
const vectors = new MemoryVectors(store.db, memory, () => embedTarget(app));
let n = 0;
while (true) {
  const k = await vectors.index();
  if (!k) break;
  n += k;
}
check(n === NOTES.length, `indexed ${n}/${NOTES.length} notes with ${opt.embed}`);
const QUESTIONS: [string, number][] = [
  ['how was the trip to the lake house?', 0],
  ['what does my sibling do for work?', 1],
  ['can I order the shrimp?', 2],
  ['training for a long race', 3],
  ['the car is making a squeaking noise when I stop', 4],
  ['what did we agree to do every week?', 5],
  ['should I put coriander in the salsa?', 6],
  ['the puppy chewed my shoe again', 7],
  ['how is my language practice going?', 8],
  ['my job is stressing me out', 9],
];
let wordHits = 0;
let meaningHits = 0;
for (const [q, want] of QUESTIONS) {
  const words = memory.list({ q, limit: 3 }).some((m) => m.id === ids[want]);
  const near = await vectors.related(q, 3, 0.5, 15_000);
  const meaning = near.some((r) => r.memory.id === ids[want]);
  if (words) wordHits++;
  if (meaning) meaningHits++;
  console.log(`  ${meaning ? '✓' : '✗'} "${q}" → ${near.map((r) => `${r.memory.content.slice(0, 40)} (${r.score.toFixed(2)})`).join(' | ') || '(nothing)'}${words ? '  [words also found it]' : ''}`);
}
check(meaningHits >= 8, `meaning search found ${meaningHits}/10 (word search: ${wordHits}/10)`);
// Unrelated question: nothing above the floor (no made-up matches).
for (const q of ['what is the capital of Australia?', 'tell me a joke', 'what time is it?', 'I love you']) {
  const all = await vectors.related(q, 3, 0, 15_000);
  const kept = await vectors.related(q, 3, undefined, 15_000);
  console.log(`  unrelated "${q}": top ${all.map((r) => r.score.toFixed(2)).join(', ')} → kept ${kept.length}`);
}
let kept = 0;
for (const [q, want] of QUESTIONS) if ((await vectors.related(q, undefined, undefined, 15_000)).some((r) => r.memory.id === ids[want])) kept++;
check(kept >= 8, `with the default rule (floor + closeness to the best) the right note is kept for ${kept}/10`);

// 2. Test, Recommended and Compare on what's connected.
const tEmb = await testModel(app, 'embeddings', 'ol', opt.embed!);
check(tEmb.ok, `Test (meaning search): ${tEmb.sample ?? tEmb.error}`);
const tVis = await testModel(app, 'vision', 'ol', opt.vision!);
check(tVis.ok && /wom|girl|person|portrait|smil|hair/i.test(tVis.sample ?? ''), `Test (vision, ${opt.vision}): ${tVis.ok ? `${(tVis.firstMs! / 1000).toFixed(1)} s, “${tVis.sample?.slice(0, 120)}”` : tVis.error}`);
const tQuick = await testModel(app, 'quick', 'ol', opt.chat!);
check(tQuick.ok, `Test (quick, ${opt.chat}): ${tQuick.ok ? `${tQuick.speed}, ${(tQuick.firstMs! / 1000).toFixed(1)} s, “${tQuick.sample?.slice(0, 60)}”` : tQuick.error}`);
const cands = await connectedModels(app);
const picks = recommend(cands, { providerId: 'ol', model: opt.chat });
console.log(`  recommended from ${cands.length} models: ${Object.entries(picks).map(([j, p]) => `${j}=${p!.model}`).join(', ')}`);
check(Boolean(picks.embeddings && /embed/.test(picks.embeddings.model)) && Boolean(picks.vision), 'recommended picks include an embedding model and a vision model');
const cmp = await compareModels(app, 'writing', [{ providerId: 'ol', model: opt.chat! }, { providerId: 'ol', model: opt.vision! }]);
check(cmp.every((c) => c.ok && (c.sample?.length ?? 0) > 80), `Compare (writing): ${cmp.map((c) => `${c.model} ${c.ok ? `${(c.totalMs! / 1000).toFixed(1)} s, ${c.sample!.length} chars` : c.error}`).join(' | ')}`);

// 3. A photo goes to the vision model; the next message back to the text model.
const pic = app.uploads!.save(`data:image/jpeg;base64,${readFileSync(join(ROOT, 'web', 'sara', 'portrait-happy.jpg')).toString('base64')}`);
const conv = store.createConversation();
const say = async (text: string, images?: string[]) => {
  let reply = '';
  for await (const ev of runTurn(app, conv.id, text, undefined, images ? { images } : {})) if (ev.type === 'token') reply += ev.text;
  const last = store.messages(conv.id).filter((m) => m.role === 'assistant').at(-1);
  return { reply: reply.trim(), model: String(last?.meta?.model ?? '') };
};
const a = await say("I found this picture of you, what's in it?", [pic.id]);
check(a.model === opt.vision && a.reply.length > 20, `photo turn on ${a.model}: “${a.reply.replace(/\s+/g, ' ').slice(0, 140)}”`);
const b = await say('haha cute. anyway, how is your day going?');
check(b.model === opt.chat && b.reply.length > 5, `next turn on ${b.model}: “${b.reply.replace(/\s+/g, ' ').slice(0, 140)}”`);

store.close();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
console.log(fails ? `\n${fails} FAILED` : '\nPASS');
process.exit(fails ? 1 : 0);
