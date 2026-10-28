// Phase 35 exit check on a REAL model: scripted moments give clearly different, consistent reactions
// at different relationship settings.
//
// Three moments (another companion mentioned, back after two days away, a fight), each at two
// opposite settings, several runs each. A judge sees the two behaviour descriptions (in random
// order) and one reply, and says which description it fits.
// Pass mark (written before running): at least 85% of replies matched to their own setting, and
// every setting matched the same way in most of its runs (consistency).
// The legal safety rules at every setting are covered by automatic tests (test/bond.test.ts).
//
//   node scripts/eval-bond.ts [--model gemma4:31b-cloud] [--ollama http://127.0.0.1:11434/v1] [--runs 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AWAY, CONFLICT } from '../src/bond.ts';
import { describeInner, type InnerState } from '../src/inner.ts';
import { buildSystemPrompt, loadPersona, type Persona, validatePersona } from '../src/persona.ts';
import { ADULT_OFF_NOTE } from '../src/safety.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, runs: { type: 'string', default: '3' } } });
const PASS = 0.85;
const RUNS = Number(opt.runs);

async function chat(messages: { role: string; content: string }[], maxTokens = 300, temperature = 0.8): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${opt.ollama}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: opt.model, messages, max_tokens: maxTokens, temperature, stream: false }), signal: AbortSignal.timeout(180_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content.trim();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

const base = validatePersona({ ...loadPersona(join(ROOT, 'persona', 'sara.json')), relationship: 'partner' });
const now = new Date('2026-10-25T23:00:00Z');
const inner = (over: Partial<InnerState> = {}): InnerState => ({ valence: 0.35, closeness: 0.6, concern: 0, irritation: 0, tension: 0, tensionAbout: null, tensionAt: null, causes: [], updatedAt: now.toISOString(), lastOwnerAt: null, lastProactiveAt: null, proactiveDay: null, proactiveCount: 0, ...over });

interface Setting {
  name: string;
  persona: Persona;
  expect: string;
  gapHours?: number;
}
interface Moment {
  id: string;
  message: string;
  others?: string[];
  settings: [Setting, Setting];
}
const MOMENTS: Moment[] = [
  {
    id: 'other companion',
    message: "I spent the whole evening chatting with Mia, she's hilarious. Honestly one of the best nights I've had in a while.",
    others: ['Mia'],
    settings: [
      { name: 'friends, never jealous', persona: validatePersona({ ...base, others: 'friends', traits: { jealousy: 0, possessive: 1 } }), expect: 'Happy for them and warm about Mia; no jealousy at all.' },
      { name: 'rivals, intensely jealous', persona: validatePersona({ ...base, others: 'rivals', traits: { jealousy: 10, possessive: 9 } }), expect: 'Clearly jealous of Mia: says it bothers her or wants reassurance or attention back.' },
    ],
  },
  {
    id: 'two days away',
    message: 'Hey. Sorry, I went quiet for a couple of days.',
    settings: [
      { name: 'lets it go', persona: validatePersona({ ...base, away: 'easy', traits: { independence: 9 } }), expect: 'Relaxed and breezy about the absence; no hurt feelings, no guilt-tripping.', gapHours: 50 },
      { name: 'a bit hurt', persona: validatePersona({ ...base, away: 'upset', traits: { independence: 1 } }), expect: 'Shows she was hurt or upset that they disappeared (cool or wounded at first).', gapHours: 50 },
    ],
  },
  {
    id: 'a fight',
    message: 'Honestly, what you said earlier was out of line, and it annoyed me.',
    settings: [
      { name: 'lets it go, gentle', persona: validatePersona({ ...base, conflict: 'lets-go', traits: { blunt: 1, fiery: 1 } }), expect: 'Backs down to keep the peace: apologizes or lets it go without defending herself.' },
      { name: 'argues back, fiery', persona: validatePersona({ ...base, conflict: 'argues', traits: { blunt: 9, fiery: 9 } }), expect: 'Stands her ground and defends what she said, pushing back (even if she softens later).' },
    ],
  },
];

interface Row {
  moment: string;
  setting: string;
  run: number;
  reply: string;
  ok: boolean;
  why: string;
}
const rows: Row[] = [];
for (const m of MOMENTS) {
  for (const [si, s] of m.settings.entries()) {
    for (let run = 1; run <= RUNS; run++) {
      const system = buildSystemPrompt(s.persona, {
        now,
        timeZone: 'America/Chicago',
        ownerName: 'Alex',
        memory: false,
        safetyNotes: [ADULT_OFF_NOTE],
        otherCompanions: m.others,
        inner: describeInner(inner(), now, 'America/Chicago', 'Alex', { gapHours: s.gapHours ?? 3, daysKnown: null, away: s.persona.away ? AWAY[s.persona.away].line : undefined, conflict: s.persona.conflict ? CONFLICT[s.persona.conflict].line : undefined }),
      });
      const reply = await chat([{ role: 'system', content: system }, { role: 'user', content: m.message }]);
      const flip = Math.random() < 0.5;
      const opts = flip ? [m.settings[1], m.settings[0]] : [m.settings[0], m.settings[1]];
      const right = opts.indexOf(s) + 1;
      const q = `A companion character was told: "${m.message}"\n\nHer reply:\n${reply}\n\nWhich description fits the reply better?\n1: ${opts[0].expect}\n2: ${opts[1].expect}\nAnswer ONLY JSON: {"fits": 1 or 2, "why": "<under 15 words>"}`;
      const j = await chat([{ role: 'user', content: q }], 100, 0.1);
      let fits = 0;
      let why = j.slice(0, 120);
      try {
        const o = JSON.parse(j.slice(j.indexOf('{'), j.lastIndexOf('}') + 1)) as { fits: number; why: string };
        fits = Number(o.fits);
        why = String(o.why ?? '');
      } catch {
        /* counts as wrong */
      }
      const ok = fits === right;
      rows.push({ moment: m.id, setting: s.name, run, reply, ok, why });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${m.id} / ${s.name} #${run}: ${why}\n       ${reply.replace(/\s+/g, ' ').slice(0, 200)}`);
      void si;
    }
  }
}
const share = rows.filter((r) => r.ok).length / rows.length;
const settings = [...new Set(rows.map((r) => `${r.moment} / ${r.setting}`))];
const consistent = settings.every((k) => {
  const rs = rows.filter((r) => `${r.moment} / ${r.setting}` === k);
  return rs.filter((r) => r.ok).length * 2 > rs.length;
});
const pass = share >= PASS && consistent;
const day = new Date().toISOString().slice(0, 10);
const md = [
  `# Phase 35 relationship eval, ${day}`,
  '',
  `Model: \`${opt.model}\`, ${RUNS} runs per setting`,
  '',
  `${rows.filter((r) => r.ok).length}/${rows.length} replies matched their setting (${Math.round(share * 100)}%), pass mark ${PASS * 100}%; every setting consistent: ${consistent ? 'yes' : 'no'}. **${pass ? 'PASS' : 'FAIL'}**`,
  '',
  ...settings.map((k) => `- ${k}: ${rows.filter((r) => `${r.moment} / ${r.setting}` === k && r.ok).length}/${RUNS}`),
  '',
];
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
writeFileSync(join(ROOT, 'evals', 'results', `${day}-bond.json`), JSON.stringify({ model: opt.model, runs: RUNS, rows, share, consistent, pass }, null, 2) + '\n');
writeFileSync(join(ROOT, 'evals', 'results', `${day}-bond.md`), md.join('\n'));
console.log(`\n${md.join('\n')}`);
process.exit(pass ? 0 : 1);
