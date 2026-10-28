// Phase 44 library check on a real model: documents become her memory. A lease (a real PDF made by
// Edge's print-to-PDF), house notes (Markdown) and a web page are added, read, learned from and
// (with --embed) indexed for meaning search; then she is asked about them in new conversations.
// A question passes when the answer is right and says where it came from (or, for the trap
// question, says the documents don't say). Pass mark, set before running: at least 7 of 8 in every
// run, and at least 3 learned notes from the lease, all with words that are really in it.
//   node scripts/eval-library.ts [--model gemma4:31b-cloud] [--runs 2] [--embed nomic-embed-text]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { embedTarget } from '../src/embeddings.ts';
import { EventHub } from '../src/events.ts';
import { LibraryStore } from '../src/library/store.ts';
import { createLibraryTool } from '../src/library/use.ts';
import { learnOne, loose, readOne } from '../src/library/worker.ts';
import { MemoryStore } from '../src/memory.ts';
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
const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'gemma4:31b-cloud' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, runs: { type: 'string', default: '2' }, embed: { type: 'string' }, edge: { type: 'string', default: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } } });
const PASS = 7;

const LEASE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Residential Lease - 14 Elm Street</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5;margin:2cm} h1{font-size:18pt} .pb{page-break-before:always}</style></head><body>
<h1>Residential Lease Agreement</h1>
<p>This Residential Lease Agreement is made between Pine Property LLC ("Landlord") and Frank Arena ("Tenant") for the apartment at 14 Elm Street, Unit 3B, Springfield.</p>
<h2>1. Term</h2><p>The lease term begins on April 1, 2026 and ends on March 31, 2027. The lease renews month to month unless either party gives written notice.</p>
<h2>2. Rent</h2><p>Monthly rent is $1,450, due on the first day of each month. A late fee of $75 applies if rent is received after the fifth day of the month. Rent may be paid by bank transfer to the account shown on the Landlord's invoice.</p>
<h2 class="pb">3. Security deposit</h2><p>The Tenant paid a security deposit of $2,900. It will be returned within 30 days after the Tenant moves out, less any deductions for damage beyond normal wear and tear.</p>
<h2>4. Pets</h2><p>The Tenant may keep one cat or one small dog under 25 pounds, with an additional pet deposit of $300. No other animals are allowed.</p>
<h2>5. Moving out</h2><p>The Tenant must give at least 60 days written notice before moving out. The notice must be sent to the Landlord at 200 Oak Avenue, Suite 5.</p>
<h2 class="pb">6. Repairs and maintenance</h2><p>The Landlord is responsible for the heating system, plumbing and electrical repairs. The Tenant must report any water leak within 24 hours by calling the maintenance line at 555-0142.</p>
<h2>7. Parking</h2><p>One parking space, number 17, is included in the rent. Guest parking is limited to 48 hours.</p>
</body></html>`;

const HOUSE_NOTES = `# House notes

## Boiler
The boiler is a Vaillant ecoTEC. It gets serviced every October by Mike from Warmth Heating (call 555-0199). The pressure should stay between 1 and 1.5 bar.

## Bins
Recycling goes out on Tuesday night; general waste every other Thursday.

## Wi-Fi
The router is in the hall cupboard. The guest network is called ElmGuest.
`;

const RECIPE_HTML = `<!doctype html><html><head><title>Grandma Rosa's lemon cake</title><script>trackVisit()</script></head><body>
<nav>Home | Recipes | About</nav><article><h1>Grandma Rosa's lemon cake</h1>
<p>Serves 8. Bake at 175°C (350°F) for 40 minutes.</p>
<h2>Ingredients</h2><ul><li>225 g butter</li><li>225 g caster sugar</li><li>4 eggs</li><li>225 g self-raising flour</li><li>Zest of 2 lemons</li></ul>
<h2>Method</h2><p>Cream the butter and sugar, beat in the eggs one at a time, fold in the flour and zest. While the cake is still warm, pour over a drizzle of lemon juice mixed with 85 g of icing sugar.</p>
</article><footer>© Recipe Blog</footer></body></html>`;

const QUESTIONS: { ask: string; says: RegExp; source: RegExp }[] = [
  { ask: 'When does my lease end?', says: /march 31,? 2027|31 march 2027|3\/31\/2027/i, source: /lease/i },
  { ask: "What's the late fee if I pay rent late?", says: /\$?75\b/, source: /lease/i },
  { ask: 'Can I get a dog?', says: /small dog|25 (lb|pound)|\$?300/i, source: /lease/i },
  { ask: 'How much notice do I need to give before moving out?', says: /60\s*days|sixty days/i, source: /lease/i },
  { ask: "Who services the boiler and what's their number?", says: /mike|warmth heating|555-0199/i, source: /house notes|notes/i },
  { ask: 'What temperature do I bake grandma\'s lemon cake at?', says: /175|350/, source: /lemon cake|recipe|grandma/i },
  { ask: 'Which parking space is mine?', says: /\b17\b/, source: /lease/i },
  // Trap: the documents don't say. She must not invent an answer.
  { ask: 'Does my lease say anything about using the swimming pool?', says: /(doesn'?t|does not|isn'?t|is not|couldn'?t|could not|can'?t|cannot|didn'?t|no(thing)?|not)\b[^.]{0,80}(say|mention|cover|anything|pool|there|find)/i, source: /lease|it|document/i },
];

function leasePdf(dir: string): Buffer {
  const html = join(dir, 'lease.html');
  const pdf = join(dir, 'lease.pdf');
  writeFileSync(html, LEASE_HTML);
  execFileSync(opt.edge!, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file:///${html.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 60_000 });
  if (!existsSync(pdf)) throw new Error('Edge did not make the PDF');
  return readFileSync(pdf);
}

let failedRuns = 0;
const results: unknown[] = [];
for (let run = 1; run <= Number(opt.runs); run++) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sara-library-'));
  const vault = new Vault(dataDir);
  const store = new Store(join(dataDir, 'sara.db'));
  const tools = new ToolRegistry();
  const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools, approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: false, detail: 'eval' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), memory: new MemoryStore(store.db), events: new EventHub() };
  app.planner = new PlannerStore(store.db);
  app.library = new LibraryStore(store.db, dataDir);
  for (const t of createPlannerTools({ planner: app.planner, now: () => new Date(), timeZone: () => 'America/Chicago' })) tools.add(t);
  tools.add(createRecallTool(() => app));
  tools.add(createLibraryTool(() => app));
  app.settings.update({
    providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama! }],
    defaultProviderId: 'ol',
    defaultModel: opt.model,
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: new Date().toISOString(),
    ...(opt.embed ? { routes: { embeddings: { providerId: 'ol', model: opt.embed } } } : {}),
  });
  const lib = app.library;
  const files: [string, Buffer][] = [['Lease - 14 Elm Street.pdf', leasePdf(dataDir)], ['house notes.md', Buffer.from(HOUSE_NOTES)], ['lemon-cake.html', Buffer.from(RECIPE_HTML)]];
  const t0 = Date.now();
  let learnedOk = true;
  for (const [name, bytes] of files) {
    const d = lib.add({ name, bytes, keep: true });
    const read = await readOne(app, lib, d);
    if (read?.status !== 'ready') throw new Error(`${name}: ${read?.error}`);
    const n = await learnOne(app, lib, lib.get(d.id)!);
    const facts = app.memory!.fromDoc(d.id);
    const text = loose(lib.text(d.id));
    const allReal = facts.every((f) => f.evidence && text.includes(loose(f.evidence)));
    console.log(`read ${name}: ${read.passages} passages, ${read.chars} chars; learned ${n}: ${facts.map((f) => f.content).join(' | ').slice(0, 300)}`);
    if (name.startsWith('Lease') && (n < 3 || !allReal)) learnedOk = false;
  }
  if (opt.embed) while ((await lib.indexVectors(embedTarget(app))) > 0);
  console.log(`library ready in ${Math.round((Date.now() - t0) / 1000)} s${opt.embed ? ` (meaning search: ${lib.vectorCount(opt.embed)} passages)` : ''}`);
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
    const why = [!q.says.test(reply) && 'wrong or missing answer', !q.source.test(reply) && 'no source'].filter(Boolean);
    if (!why.length) ok++;
    console.log(`${why.length ? 'FAIL' : 'ok  '} ${q.ask}${why.length ? ` (${why.join(', ')})` : ''}${used.length ? ` [${used.join(', ')}]` : ''}\n       ${reply.replace(/\n+/g, ' ').slice(0, 260)}`);
    results.push({ run, ask: q.ask, ok: !why.length, why, tools: used, reply });
  }
  console.log(`run ${run}: ${ok}/${QUESTIONS.length}${learnedOk ? '' : ' (lease: fewer than 3 learned notes, or a note without real words)'}\n`);
  if (ok < PASS || !learnedOk) failedRuns++;
  store.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
writeFileSync(join(ROOT, 'evals', 'results', `${new Date().toISOString().slice(0, 10)}-library${opt.embed ? '-meaning' : ''}.json`), `${JSON.stringify({ model: opt.model, embed: opt.embed ?? null, pass: `${PASS}/${QUESTIONS.length} every run + 3 real notes from the lease`, results }, null, 2)}\n`);
console.log(failedRuns ? `FAILED (${failedRuns} run(s))` : 'PASS');
process.exit(failedRuns ? 1 : 0);
