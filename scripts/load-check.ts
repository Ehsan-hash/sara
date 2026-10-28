// Phase 45: load check. Fills a scratch data folder with about a year of use (a conversation most
// days, thousands of messages and memory notes, planner items, and a 500-page document read by the
// real PDF reader), then starts the real server on it and times what a user would notice: start-up,
// the conversation list, opening a long conversation, search, memory, the library, Today, a backup.
// The pass marks are set before running (see LIMITS) and the script exits 1 if any is missed.
//   node scripts/load-check.ts [--days 365] [--keep]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import { readDocument } from '../src/library/read.ts';
import { LibraryStore } from '../src/library/store.ts';
import { MemoryStore } from '../src/memory.ts';
import { PlannerStore } from '../src/planner.ts';
import { Store } from '../src/store.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { days: { type: 'string', default: '365' }, keep: { type: 'boolean', default: false } } });
const DAYS = Number(opt.days);

/** Milliseconds a user would still call quick, on an ordinary small server. */
const LIMITS: Record<string, number> = {
  'start-up (until /api/health answers)': 15_000,
  'conversation list': 500,
  'open a long conversation': 800,
  'search everything ("boiler")': 1_500,
  'memory page': 1_000,
  'library list': 500,
  'library search': 800,
  'Today page': 1_500,
  'read a 500-page PDF': 30_000,
  'backup': 30_000,
};

const WORDS = 'the boiler garden lease dinner Mike Tuesday plan walk coffee rain work email project budget doctor birthday train holiday book film recipe cake car insurance bins'.split(' ');
const pick = (i: number, n: number) => WORDS[(i * 7919 + n * 104729) % WORDS.length];
const sentence = (i: number) => `I was thinking about the ${pick(i, 1)} and the ${pick(i, 2)} today, and whether ${pick(i, 3)} could wait until ${pick(i, 4)}.`;

/** A real 500-page PDF (Helvetica text, one stream per page), built by hand. */
function bigPdf(pages: number): Buffer {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const kids: number[] = [];
  for (let p = 0; p < pages; p++) {
    const lines = Array.from({ length: 40 }, (_, l) => `BT /F1 10 Tf 50 ${760 - l * 18} Td (${`Page ${p + 1}, line ${l + 1}: ${sentence(p * 40 + l)}`.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
    const z = deflateSync(Buffer.from(lines, 'latin1'));
    objs.push(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z.toString('latin1')}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objs.length} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Count ${pages} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const results: { what: string; ms: number; note?: string }[] = [];
async function time<T>(what: string, fn: () => Promise<T> | T, note?: (r: T) => string): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  results.push({ what, ms: Math.round(performance.now() - t0), note: note?.(r) });
  return r;
}

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sara-load-'));
console.log(`Filling ${dir} with ${DAYS} days of use…`);
const start = new Date(Date.now() - DAYS * 86_400_000);
let clock = start;
const store = new Store(join(dir, 'sara.db'), () => clock);
const mem = new MemoryStore(store.db, () => clock);
const planner = new PlannerStore(store.db, () => clock);
let messages = 0;
let longest = '';
store.db.exec('BEGIN');
for (let d = 0; d < DAYS; d++) {
  clock = new Date(start.getTime() + d * 86_400_000 + 9 * 3_600_000);
  if (d % 7 === 6) continue; // a day off now and then
  const c = store.createConversation({ title: `Day ${d + 1}: ${pick(d, 5)}` });
  const n = !longest && d >= DAYS - 7 ? 400 : 10 + (d % 25); // one very long conversation near the end
  if (n === 400) longest = c.id;
  for (let m = 0; m < n; m++) {
    clock = new Date(clock.getTime() + 60_000);
    store.addMessage(c.id, m % 2 ? 'assistant' : 'user', `${sentence(d * 100 + m)} ${m % 2 ? 'That sounds like a good idea.' : 'What do you think?'}`);
    messages++;
  }
  for (let k = 0; k < 6; k++) mem.add({ kind: k % 3 ? 'fact' : 'decision', content: `Alex mentioned the ${pick(d, k)} on day ${d + 1}.`, conversationId: c.id, sourceMessageId: null, happenedOn: clock.toISOString().slice(0, 10), evidence: `the ${pick(d, k)}` });
  if (d % 3 === 0) planner.addTask({ title: `Sort out the ${pick(d, 6)}` });
}
store.db.exec('COMMIT');
const lib = new LibraryStore(store.db, dir, () => clock);
const pdf = bigPdf(500);
const doc = lib.add({ name: 'big-manual.pdf', bytes: pdf, keep: true, learn: false });
const read = await time('read a 500-page PDF', () => readDocument('big-manual.pdf', pdf), (r) => `${r.parts.length} pages, ${(pdf.length / 1e6).toFixed(1)} MB`);
lib.setRead(doc.id, read);
store.db.close?.();
const dbMb = (statSync(join(dir, 'sara.db')).size / 1e6).toFixed(1);
console.log(`${messages} messages, ${DAYS * 6} memory notes, a ${read.parts.length}-page document; database ${dbMb} MB.`);

// The real server on that data.
const port = 7895 + Math.floor(Math.random() * 50);
const t0 = performance.now();
const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src', 'main.ts')], { env: { ...process.env, SARA_DATA: dir, SARA_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (b) => (log += b));
proc.stderr.on('data', (b) => (log += b));
const base = `http://127.0.0.1:${port}`;
for (;;) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    /* not yet */
  }
  if (performance.now() - t0 > 60_000) throw new Error(`server didn't start:\n${log}`);
  await new Promise((r) => setTimeout(r, 100));
}
results.push({ what: 'start-up (until /api/health answers)', ms: Math.round(performance.now() - t0) });
const token = /owner token[^\n]*\n\s*(\S+)/i.exec(log)?.[1];
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const get = async (path: string) => {
  const r = await fetch(base + path, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<Record<string, unknown> & unknown[]>;
};
try {
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ ownerName: 'Alex', setupDone: true }) });
  await time('conversation list', () => get('/api/conversations'), (r) => `${r.length} conversations`);
  await time('open a long conversation', () => get(`/api/conversations/${longest}`), (r) => `${(r.messages as unknown[]).length} messages`);
  await time('search everything ("boiler")', () => get('/api/find?q=boiler'), (r) => `${JSON.stringify(r).length} bytes back`);
  await time('memory page', () => get('/api/memories'), (r) => `${r.length} notes`);
  await time('library list', () => get('/api/library'));
  await time('library search', () => get('/api/library/search?q=insurance%20budget'), (r) => `${(r.hits as unknown[] | undefined)?.length ?? 0} hits`);
  await time('Today page', () => get('/api/today'));
  await time('backup', async () => {
    const r = await fetch(`${base}/api/backups`, { method: 'POST', headers: H, body: '{}' });
    return { status: r.status, body: await r.text() };
  }, (r) => `HTTP ${r.status}`);
} finally {
  proc.kill();
  await new Promise((r) => proc.once('exit', r));
}

let ok = true;
console.log('\n| What | Time | Limit | |\n|---|---|---|---|');
for (const r of results) {
  const lim = LIMITS[r.what];
  const pass = lim === undefined || r.ms <= lim;
  ok &&= pass;
  console.log(`| ${r.what}${r.note ? ` (${r.note})` : ''} | ${r.ms} ms | ${lim ?? '–'} ms | ${pass ? 'ok' : 'TOO SLOW'} |`);
}
const out = join(ROOT, 'evals', 'results', `${new Date().toISOString().slice(0, 10)}-load.json`);
writeFileSync(out, JSON.stringify({ days: DAYS, messages, notes: DAYS * 6, dbMb, results, limits: LIMITS }, null, 2));
if (!opt.keep) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
console.log(ok ? '\nPASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
