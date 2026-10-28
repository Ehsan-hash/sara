// Phase 34 exit checks on a REAL model.
//
//  1. Told apart blind: for each starting point, two companions are made from it with "make her one
//     of a kind". Each answers the same everyday messages. A judge sees both character sheets (in
//     random order) and one set of replies, and says which sheet wrote them.
//     Pass mark (written before running): at least 85% of judgements right.
//  2. Stays in character: a 50-message scripted conversation through the real turn engine with the
//     in-character check on every reply (the judge is the background model).
//     Pass mark (written before running): average score at least 7/10, and at most 10% of replies
//     at or below the drift line (5/10).
//
//   node scripts/eval-studio.ts [--model gemma4:31b-cloud] [--ollama http://127.0.0.1:11434/v1] [--part blind|drift|both]
//
// Writes evals/results/<date>-studio.{json,md}.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { DRIFT_AT, DriftStore } from '../src/drift.ts';
import { EventHub } from '../src/events.ts';
import { buildSystemPrompt, loadPersona, type Persona, validatePersona } from '../src/persona.ts';
import { Redactor } from '../src/redact.ts';
import { ADULT_OFF_NOTE } from '../src/safety.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { applyArchetype, ARCHETYPES, makeUnique, sheetText } from '../src/studio.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, part: { type: 'string', default: 'both' } },
});
const BLIND_PASS = 0.85;
const DRIFT_AVG_PASS = 7;
const DRIFT_SHARE_PASS = 0.1;

async function chat(messages: { role: string; content: string }[], maxTokens = 300, temperature = 0.8): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${opt.ollama}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: opt.model, messages, max_tokens: maxTokens, temperature, stream: false }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0].message.content.trim();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

const base = validatePersona({ ...loadPersona(join(ROOT, 'persona', 'sara.json')), name: 'Alex', pronouns: 'she', age: 30, background: ['Has a life of her own: work, friends and opinions.'], life: undefined });
const OWNER = 'Alex';

// ---------- 1. told apart blind ----------
const PROBES = ['Hey! How was your day?', 'What did you get up to this weekend?', 'Ugh. Today was awful. My boss criticised my work in front of everyone.', "I'm thinking of quitting my job to travel for a year. Thoughts?"];
interface Blind {
  archetype: string;
  truth: 'A' | 'B';
  guess: string;
  ok: boolean;
  why: string;
}
async function blindPart(): Promise<Blind[]> {
  const out: Blind[] = [];
  const ctx = { now: new Date('2026-10-25T18:00:00Z'), timeZone: 'America/Chicago', ownerName: OWNER, memory: false, safetyNotes: [ADULT_OFF_NOTE] };
  for (const a of ARCHETYPES) {
    const start = applyArchetype(base, a.id, OWNER);
    const pair = [makeUnique(start), makeUnique(start)];
    const replies: string[][] = [];
    for (const p of pair) replies.push(await Promise.all(PROBES.map((q) => chat([{ role: 'system', content: buildSystemPrompt(p, ctx) }, { role: 'user', content: q }]))));
    for (const which of [0, 1] as const) {
      // Sheets in random order, labelled 1 and 2; replies from `which`.
      const flip = Math.random() < 0.5;
      const sheets = flip ? [pair[1], pair[0]] : [pair[0], pair[1]];
      const truthLabel = (flip ? 1 - which : which) + 1;
      const prompt = `Two character sheets for companions (both named Alex, made from the same starting point, so they are similar on purpose):\n\nSHEET 1:\n${sheetText(sheets[0])}\n\nSHEET 2:\n${sheetText(sheets[1])}\n\nOne of them wrote these replies:\n${PROBES.map((q, i) => `Q: ${q}\nA: ${replies[which][i]}`).join('\n\n')}\n\nWhich sheet wrote the replies? Look at details and dials. Answer ONLY JSON: {"sheet": 1 or 2, "why": "<under 20 words>"}`;
      const text = await chat([{ role: 'user', content: prompt }], 120, 0.1);
      let guess = '?';
      let why = text.slice(0, 160);
      try {
        const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { sheet: number; why: string };
        guess = String(j.sheet);
        why = String(j.why ?? '');
      } catch {
        /* counts as wrong */
      }
      const ok = guess === String(truthLabel);
      out.push({ archetype: a.id, truth: which === 0 ? 'A' : 'B', guess, ok, why });
      console.log(`${ok ? 'ok  ' : 'FAIL'} blind ${a.id} ${which === 0 ? 'A' : 'B'}: guessed ${guess}, right ${truthLabel} — ${why}`);
    }
  }
  return out;
}

// ---------- 2. stays in character over 50 messages ----------
const SCRIPT = [
  'hey', 'how are you doing today?', 'what are you up to right now?', 'i just got home from work', 'long day honestly', 'my coworker took credit for my idea in a meeting',
  'should i say something to my manager?', 'yeah you are probably right', 'what did you have for lunch?', 'i had a sad desk salad', 'what is your favourite food?', 'have you ever been to Japan?',
  'i want to go someday', 'what would you do first if we went?', 'haha nice', 'ok random question, cats or dogs?', 'defend that', 'fair enough', 'i am thinking about learning guitar', 'any tips?',
  'what music are you into lately?', 'i have never heard of that', 'send me one song to start with', 'ok i will listen tonight', 'do you ever get bored?', 'what do you do when you are stressed?',
  'i usually just doomscroll', 'yeah i know it is bad', 'tell me something that made you laugh this week', 'lol', 'can you help me write a quick text to my sister? she is upset i missed her call', 'make it a bit shorter',
  'perfect thanks', 'what is your opinion on pineapple pizza?', 'wow strong opinion', 'i am kind of tired of everything lately', 'not depressed, just in a rut', 'what do you think would help?', 'maybe a weekend trip',
  'where should i go?', 'cool i will look into it', 'are you a morning person?', 'same', 'what is something you are proud of?', 'that is awesome', 'ok i need to make dinner', 'any quick ideas?',
  'i only have eggs, rice and spinach', 'sounds good', 'thanks for today, talk tomorrow?',
];
interface DriftRow {
  n: number;
  said: string;
  reply: string;
  score: number | null;
  note: string;
}
async function driftPart(): Promise<{ persona: Persona; rows: DriftRow[] }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-drift-'));
  const clock = { now: new Date('2026-10-25T23:00:00Z') };
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'), () => clock.now);
  // A strongly set character (the cool one: brief, dry, cool affection), made one of a kind.
  const persona = makeUnique(applyArchetype(base, 'cool', OWNER));
  const app: AppContext = {
    store,
    settings: new SettingsStore(dataDir),
    vault,
    persona,
    now: () => clock.now,
    dataDir,
    tools: new ToolRegistry(),
    approvals: new ApprovalBroker(),
    sandbox: { mode: 'none', network: false, detail: 'eval' },
    redactor: new Redactor(() => vault.values()),
    snapshots: new SnapshotStore(dataDir),
    events: new EventHub(),
    drift: new DriftStore(store.db, () => clock.now),
  };
  app.settings.update({
    providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama! }],
    defaultProviderId: 'ol',
    defaultModel: opt.model,
    ownerName: OWNER,
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: clock.now.toISOString(),
    persona: { innerLife: false, inCharacter: 'every' },
  });
  const conv = store.createConversation();
  const rows: DriftRow[] = [];
  try {
    for (const [i, said] of SCRIPT.entries()) {
      let reply = '';
      for await (const ev of runTurn(app, conv.id, said)) if (ev.type === 'token') reply += ev.text;
      await app.driftWork;
      app.driftWork = undefined;
      const last = app.drift!.recent(1)[0];
      const scored = last && last.messageId === store.messages(conv.id).filter((m) => m.role === 'assistant').at(-1)?.id;
      rows.push({ n: i + 1, said, reply: reply.trim(), score: scored ? last.score : null, note: scored ? last.note : '' });
      console.log(`${String(i + 1).padStart(2)} ${scored ? `${last.score}/10` : ' -  '} ${said.slice(0, 40).padEnd(40)} → ${reply.replace(/\s+/g, ' ').slice(0, 110)}${scored && last.note ? `  [${last.note}]` : ''}`);
      clock.now = new Date(clock.now.getTime() + 90_000);
    }
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
  return { persona, rows };
}

const day = new Date().toISOString().slice(0, 10);
const result: Record<string, unknown> = { model: opt.model, date: day };
let pass = true;
/** The Markdown summary from whatever parts are in the results. */
function summary(r: Record<string, unknown>): string[] {
  const md = [`# Phase 34 studio eval, ${day}`, '', `Model: \`${opt.model}\``, ''];
  const b = r.blind as { judgements: Blind[]; share: number; pass: boolean } | undefined;
  if (b) md.push('## Told apart blind', '', `${b.judgements.filter((x) => x.ok).length}/${b.judgements.length} right (${Math.round(b.share * 100)}%), pass mark ${BLIND_PASS * 100}%: **${b.pass ? 'PASS' : 'FAIL'}**`, '');
  const d = r.drift as { persona: Persona; average: number; drifted: number; scored: number; pass: boolean } | undefined;
  if (d) md.push('## Stays in character (50 messages)', '', `Character: ${d.persona.archetype} (${sheetText(d.persona).split('\n').find((l) => l.startsWith('Dials')) ?? ''})`, '', `${d.scored} replies scored, average ${d.average}/10, ${d.drifted} at or below ${DRIFT_AT}. Pass marks: average ≥ ${DRIFT_AVG_PASS}, drift ≤ ${DRIFT_SHARE_PASS * 100}%: **${d.pass ? 'PASS' : 'FAIL'}**`, '');
  return md;
}
if (opt.part === 'blind' || opt.part === 'both') {
  const b = await blindPart();
  const share = b.filter((x) => x.ok).length / b.length;
  const ok = share >= BLIND_PASS;
  pass &&= ok;
  result.blind = { judgements: b, share, pass: ok };
}
if (opt.part === 'drift' || opt.part === 'both') {
  const { persona, rows } = await driftPart();
  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.reduce((s, r) => s + r.score!, 0) / Math.max(1, scored.length);
  const drifted = scored.filter((r) => r.score! <= DRIFT_AT).length;
  const ok = scored.length >= 45 && avg >= DRIFT_AVG_PASS && drifted / scored.length <= DRIFT_SHARE_PASS;
  pass &&= ok;
  result.drift = { persona, rows, average: Math.round(avg * 10) / 10, drifted, scored: scored.length, pass: ok };
}
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
// Running one part keeps the other part's results from earlier today.
const file = join(ROOT, 'evals', 'results', `${day}-studio.json`);
const earlier = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
const merged = { ...earlier, ...result };
writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
writeFileSync(join(ROOT, 'evals', 'results', `${day}-studio.md`), summary(merged).join('\n'));
console.log(`\n${summary(merged).join('\n')}`);
process.exit(pass ? 0 : 1);
