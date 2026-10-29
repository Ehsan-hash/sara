// Phase 74 measurement: a generated 1,000-page book read by a throwaway Sara server on this
// computer with local models (Ollama). Records time per phase, the server's peak memory (the whole
// process, reader threads included), how quickly chat answers while the book is read, and (with
// --eval) how many questions with known answer pages she answers right and with the right page.
//
//   node scripts/bench-big-doc.ts --label text --pages 1000 [--scanned 50] [--bulk-mb 900]
//        [--model gemma4:12b] [--vision gemma4:12b] [--embed nomic-embed-text] [--learn 1]
//        [--speed 2] [--memory-mb 768] [--stop-after done|ready|text] [--eval 30] [--port 7881]
//   node scripts/bench-big-doc.ts --search-scale 300000   (meaning + word search at scale, in-process)
//
// Writes outputs/p74-bench/<label>.json. Ports 7880-7899 only; the data folder is a scratch folder
// that is removed afterwards (--keep keeps it).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { makeBigPdf } from './make-big-pdf.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    pages: { type: 'string', default: '1000' },
    scanned: { type: 'string', default: '0' },
    'bulk-mb': { type: 'string', default: '0' },
    model: { type: 'string', default: 'gemma4:12b' },
    vision: { type: 'string', default: 'gemma4:12b' },
    embed: { type: 'string', default: 'nomic-embed-text' },
    ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' },
    learn: { type: 'string', default: '1' },
    speed: { type: 'string', default: '2' },
    'memory-mb': { type: 'string' },
    'stop-after': { type: 'string', default: 'done' },
    eval: { type: 'string', default: '0' },
    port: { type: 'string', default: '7881' },
    scratch: { type: 'string', default: process.env.SARA_SCRATCH ?? join(process.env.LOCALAPPDATA ?? '.', 'hermes', 'cache', 'scratch', 'p74') },
    keep: { type: 'boolean', default: false },
    'search-scale': { type: 'string' },
    'chat-every': { type: 'string', default: '45' },
    'pause-probe': { type: 'boolean', default: false },
  },
});
const OUT = join(ROOT, 'outputs', 'p74-bench');
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = Number(o.port);
if (port < 7880 || port > 7899) throw new Error('Use a port from 7880 to 7899.');

// ---------------------------------------------------------------- search at scale (in-process)
if (o['search-scale']) {
  const { LibraryStore } = await import('../src/library/store.ts');
  const n = Number(o['search-scale']);
  const dir = join(o.scratch, `search-${n}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'sara.db'));
  const lib = new LibraryStore(db, dir);
  // Filler words (not the words of the question, so the one passage that has them is the answer).
  const words = [...new Set(readFileSync(join(ROOT, 'scripts', 'make-big-pdf.ts'), 'utf8').match(/[a-z]{4,}/g)!)].filter((w) => !/^(calibration|constant|unit)/.test(w));
  db.exec("INSERT INTO library_docs (name, size, sha, ext, status, keep, added_at) VALUES ('scale.pdf', 1, 'x', 'pdf', 'ready', 1, '2026-10-29')");
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const t0 = Date.now();
  db.exec('BEGIN');
  const put = db.prepare('INSERT INTO library_passages (doc_id, ord, place, heading, text, page) VALUES (1, ?, ?, NULL, ?, ?)');
  const vput = db.prepare('INSERT INTO library_vectors (passage_id, model, vec) VALUES (?, ?, ?)');
  const DIM = 768;
  for (let i = 1; i <= n; i++) {
    const page = Math.floor(i / 3) + 1;
    const text = Array.from({ length: 180 }, () => words[Math.floor(rnd() * words.length)]).join(' ') + (i === Math.floor(n * 0.61) ? ' The calibration constant for unit 7 is 4.183.' : '');
    put.run(i, `page ${page}`, text, page);
    const v = new Float32Array(DIM);
    let s = 0;
    for (let k = 0; k < DIM; k++) s += (v[k] = rnd() * 2 - 1) ** 2;
    s = Math.sqrt(s);
    for (let k = 0; k < DIM; k++) v[k] /= s;
    vput.run(i, 'scale', new Uint8Array(v.buffer));
    if (i % 20000 === 0) {
      db.exec('COMMIT');
      db.exec('BEGIN');
    }
  }
  db.exec('COMMIT');
  const buildMs = Date.now() - t0;
  const rss0 = process.memoryUsage().rss;
  const t1 = Date.now();
  const ix = lib.vectorIndex('scale');
  const loadMs = Date.now() - t1;
  const rss1 = process.memoryUsage().rss;
  const q = new Float32Array(DIM).map(() => rnd() * 2 - 1);
  const allowed = new Set([1]);
  const times: number[] = [];
  for (let k = 0; k < 20; k++) {
    const t = performance.now();
    ix.candidates(q, allowed, 48);
    times.push(performance.now() - t);
  }
  const ftsTimes: number[] = [];
  let ftsPage = 0;
  for (let k = 0; k < 20; k++) {
    const t = performance.now();
    const r = lib.searchWords('calibration constant unit 7', { limit: 8 });
    ftsTimes.push(performance.now() - t);
    ftsPage = r[0]?.passage.page ?? 0;
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const res = { passages: n, dim: DIM, buildSeconds: buildMs / 1000, indexLoadSeconds: loadMs / 1000, indexMb: Math.round(ix.bytes / 1048576), rssGrowthMb: Math.round((rss1 - rss0) / 1048576), vectorSearchMsMedian: Math.round(med(times) * 10) / 10, vectorSearchMsMax: Math.round(Math.max(...times) * 10) / 10, wordSearchMsMedian: Math.round(med(ftsTimes) * 100) / 100, wordSearchFoundPage: ftsPage, expectedPage: Math.floor(Math.floor(n * 0.61) / 3) + 1 };
  console.log(JSON.stringify(res, null, 2));
  writeFileSync(join(OUT, `search-${n}.json`), JSON.stringify(res, null, 2));
  db.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

// ---------------------------------------------------------------- the book
const runDir = join(o.scratch, `run-${o.label}`);
rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
const dataDir = join(runDir, 'data');
mkdirSync(dataDir, { recursive: true });
const pdfPath = join(runDir, 'manual.pdf');
let t = Date.now();
const book = makeBigPdf(pdfPath, { pages: Number(o.pages), scanned: Number(o.scanned), bulkMb: Number(o['bulk-mb']) || undefined });
const genSeconds = (Date.now() - t) / 1000;
console.log(`book: ${book.pages} pages, ${(book.bytes / 1048576).toFixed(1)} MB, ${book.scanned.length} scanned, made in ${genSeconds}s`);

// ---------------------------------------------------------------- a throwaway server
const now = new Date().toISOString();
const P = { id: 'ollama', label: 'Ollama on this computer', kind: 'openai-compatible', baseUrl: o.ollama, local: true };
const pick = (model: string) => ({ providerId: 'ollama', model });
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ providers: [P], defaultProviderId: 'ollama', defaultModel: o.model, ownerName: 'Alex', timeZone: 'America/Chicago', disclosureAcceptedAt: now, routes: { chat: pick(o.model), background: pick(o.model), vision: pick(o.vision), ...(o.embed ? { embeddings: pick(o.embed) } : {}) }, libraryLimits: { maxMb: 2048, speed: Number(o.speed) } }, null, 2),
);
const NODE = process.execPath;
const env = { ...process.env, SARA_DEBUG_LIBRARY: '1', SARA_DATA: dataDir, SARA_PORT: String(port), SARA_HOST: '127.0.0.1', ...(o['memory-mb'] ? { SARA_LIBRARY_MEMORY_MB: o['memory-mb'] } : {}) };
const child = spawn(NODE, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src', 'main.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${port}`;
const stop = () => {
  try {
    child.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
for (let k = 0; k < 120; k++) {
  if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
  await sleep(500);
}
const token = readFileSync(join(dataDir, 'first-token.txt'), 'utf8').trim();
const H = { authorization: `Bearer ${token}` };
const J = { ...H, 'content-type': 'application/json' };
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${base}/api${path}`, { ...init, headers: { ...(init.body && typeof init.body === 'string' ? J : H), ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body as Record<string, unknown>;
};

/** The server process's memory (working set), from Windows' task list. */
function rssMb(): number {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${child.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const m = /"([\d,.\s]+) K"/.exec(out);
    return m ? Math.round(Number(m[1].replace(/[^\d]/g, '')) / 1024) : 0;
  } catch {
    return 0;
  }
}

/** One chat message: time to her first word and to the end of the reply. */
async function chat(text: string, conv?: string): Promise<{ firstMs: number; totalMs: number; reply: string; conv: string }> {
  const c = conv ?? String(((await api('/conversations', { method: 'POST', body: JSON.stringify({ title: 'bench' }) })) as { id: string }).id);
  const t0 = performance.now();
  const r = await fetch(`${base}/api/conversations/${c}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ content: text }) });
  if (!r.ok || !r.body) throw new Error(`chat: ${r.status} ${await r.text()}`);
  let first = 0;
  let reply = '';
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const type = /^event: (\S+)/m.exec(ev)?.[1];
      const data = /^data: (.*)$/m.exec(ev)?.[1];
      if (type === 'token' && data) {
        if (!first) first = performance.now() - t0;
        reply += (JSON.parse(data) as { text: string }).text;
      }
    }
  }
  return { firstMs: Math.round(first), totalMs: Math.round(performance.now() - t0), reply, conv: c };
}

const result: Record<string, unknown> = { label: o.label, date: now.slice(0, 10), machine: process.env.COMPUTERNAME ? 'dev PC (Windows 11)' : 'unknown', options: { ...o, scratch: undefined }, book: { pages: book.pages, mb: Math.round((book.bytes / 1048576) * 10) / 10, scanned: book.scanned.length, facts: book.facts.length, generateSeconds: genSeconds } };
try {
  // Idle chat (the model is warmed up first, then three measured messages).
  await chat('Say hi in three words.').catch(() => undefined);
  const idle = [];
  for (let k = 0; k < 3; k++) idle.push(await chat('Say hi in three words.'));
  result.chatIdle = idle.map((x) => ({ firstMs: x.firstMs, totalMs: x.totalMs }));
  const idleLib: number[] = [];
  for (let k = 0; k < 5; k++) {
    const t1 = performance.now();
    await api('/library');
    idleLib.push(Math.round(performance.now() - t1));
  }
  result.apiIdleMs = idleLib;
  console.log('idle chat', result.chatIdle);
  // Upload in pieces.
  t = Date.now();
  const file = readFileSync(pdfPath);
  const up = (await api('/library/uploads', { method: 'POST', body: JSON.stringify({ name: 'Harbor manual.pdf', size: file.length, keep: true, learn: o.learn === '1' }) })) as { id: string; chunkBytes: number };
  for (let off = 0; off < file.length; off += up.chunkBytes) {
    const r = await fetch(`${base}/api/library/uploads/${up.id}?offset=${off}`, { method: 'PUT', headers: { ...H, 'content-type': 'application/octet-stream' }, body: file.subarray(off, off + up.chunkBytes) });
    if (!r.ok) throw new Error(`upload piece: ${r.status}`);
  }
  const doc = ((await api(`/library/uploads/${up.id}/done`, { method: 'POST', body: '{}' })) as { doc: { id: number } }).doc;
  result.upload = { seconds: (Date.now() - t) / 1000, mbPerSecond: Math.round((file.length / 1048576 / ((Date.now() - t) / 1000)) * 10) / 10 };
  console.log('uploaded', result.upload);
  // Watch the reading: memory, progress, chat latency while it reads.
  const started = Date.now();
  let peak = rssMb();
  const rssSamples: [number, number][] = [];
  const phases: Record<string, number> = {};
  const during: { phase: string; firstMs: number; totalMs: number }[] = [];
  const apiDuring: number[] = [];
  let lastChat = 0;
  let last: Record<string, unknown> = {};
  let approved = false;
  for (;;) {
    const t1 = performance.now();
    const d = (await api(`/library/${doc.id}`)) as { doc: { status: string; job: Record<string, unknown> | null; pages: number; passages: number } };
    apiDuring.push(Math.round(performance.now() - t1));
    const job = d.doc.job ?? {};
    last = job;
    const phase = String(job.phase ?? d.doc.status);
    if (!(phase in phases)) {
      phases[phase] = (Date.now() - started) / 1000;
      console.log(`${phases[phase]}s → ${phase}`);
    }
    const mb = rssMb();
    peak = Math.max(peak, mb);
    rssSamples.push([Math.round((Date.now() - started) / 1000), mb]);
    if (job.needs === 'ocr-approval' && !approved) {
      approved = true;
      await api(`/library/${doc.id}/ocr`, { method: 'POST', body: JSON.stringify({ approve: true }) });
    }
    // --pause-probe: in the key-points phase, chat while it runs and while it is paused (what slows chat?).
    if (o['pause-probe'] && phase === 'learn' && !result.pauseProbe) {
      const running = [await chat('Say hi in three words.'), await chat('Say hi in three words.')].map((c) => c.firstMs);
      await api(`/library/${doc.id}/pause`, { method: 'POST', body: '{}' });
      await sleep(15_000);
      const paused = [await chat('Say hi in three words.'), await chat('Say hi in three words.')].map((c) => c.firstMs);
      await api(`/library/${doc.id}/resume`, { method: 'POST', body: '{}' });
      result.pauseProbe = { runningFirstMs: running, pausedFirstMs: paused };
      console.log('pause probe', result.pauseProbe);
    }
    if (Date.now() - lastChat > Number(o['chat-every']) * 1000 && !['done', 'cancelled'].includes(phase)) {
      lastChat = Date.now();
      const c = await chat('Say hi in three words.').catch((e: Error) => ({ firstMs: -1, totalMs: -1, reply: e.message, conv: '' }));
      during.push({ phase, firstMs: c.firstMs, totalMs: c.totalMs });
      console.log(`  ${new Date().toISOString()} chat during ${phase}: first word ${c.firstMs} ms, reply ${c.totalMs} ms · page ${job.page}/${job.pages} · ${mb} MB`);
    }
    const stopAt = o['stop-after'];
    if (phase === 'done' || phase === 'cancelled' || (stopAt === 'ready' && d.doc.status === 'ready') || (stopAt === 'text' && phase !== 'text')) break;
    await sleep(2000);
  }
  if (!['done', 'cancelled'].includes(String(last.phase))) await api(`/library/${doc.id}/cancel`, { method: 'POST', body: '{}' }).catch(() => undefined);
  const final = (await api(`/library/${doc.id}`)) as { doc: Record<string, unknown>; sections: { title: string; level: number; page: number; summary: string | null }[]; facts: unknown[] };
  result.reading = {
    totalSeconds: (Date.now() - started) / 1000,
    phaseStartSeconds: phases,
    timingsMs: final.doc.job ? (final.doc.job as Record<string, unknown>).timings : last.timings,
    pages: final.doc.pages,
    passages: final.doc.passages,
    pagesSeen: final.doc.pagesSeen,
    sections: final.sections.length,
    sectionSummaries: final.sections.filter((s) => s.summary).length,
    keyPoints: final.facts.length,
    overview: final.doc.overview ? String(final.doc.overview).slice(0, 400) : null,
    warnings: final.doc.warnings,
  };
  result.memory = { peakRssMb: peak, fileMb: Math.round(book.bytes / 1048576), samples: rssSamples.filter((_, i) => i % 5 === 0).slice(0, 400) };
  result.chatDuring = during;
  result.apiDuringMs = { median: [...apiDuring].sort((a, b) => a - b)[Math.floor(apiDuring.length / 2)], max: Math.max(...apiDuring), n: apiDuring.length };
  console.log(JSON.stringify(result.reading, null, 2), 'peak', peak, 'MB');
  // The eval: questions with known answer pages, each in a new conversation.
  const n = Number(o.eval);
  if (n) {
    const qs = book.facts.slice(0, n);
    const rows: Record<string, unknown>[] = [];
    for (const f of qs) {
      const q = `In the Harbor wind farm manual: ${f.question} Which page says so?`;
      const r = await chat(q).catch((e: Error) => ({ firstMs: -1, totalMs: -1, reply: `ERROR ${e.message}`, conv: '' }));
      const low = r.reply.toLowerCase();
      const right = f.answers.some((a) => low.includes(a.toLowerCase()));
      const cited = [...r.reply.matchAll(/(?:p\.|page|pages|seite|página)\s*(\d{1,4})|view=library:\d+:(\d+)/gi)].map((m) => Number(m[1] ?? m[2]));
      const pageRight = cited.includes(f.page);
      const link = new RegExp(`view=library:\\d+:${f.page}\\)`).test(r.reply);
      rows.push({ page: f.page, scanned: f.scanned, question: f.question, right, pageRight, link, cited: [...new Set(cited)].slice(0, 6), seconds: Math.round(r.totalMs / 100) / 10, reply: r.reply.slice(0, 600) });
      console.log(`${right ? '✓' : '✗'} ${pageRight ? 'p✓' : 'p✗'} p.${f.page}${f.scanned ? ' (scan)' : ''} ${f.question} → ${r.reply.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    result.eval = { questions: rows.length, answerRight: rows.filter((r) => r.right).length, pageRight: rows.filter((r) => r.pageRight).length, bothRight: rows.filter((r) => r.right && r.pageRight).length, withLink: rows.filter((r) => r.link).length, rows };
    console.log(`eval: ${(result.eval as Record<string, number>).answerRight}/${rows.length} answers right, ${(result.eval as Record<string, number>).pageRight}/${rows.length} right page`);
  }
} catch (err) {
  result.error = (err as Error).message;
  console.error(err);
  console.error(log.split('\n').filter((l) => !/token/i.test(l)).slice(-30).join('\n'));
} finally {
  writeFileSync(join(OUT, `${o.label}.json`), JSON.stringify(result, null, 2));
  // Only the library's own lines (the server's start-up text holds its one-time token).
  writeFileSync(join(OUT, `${o.label}.server.log`), log.split('\n').filter((l) => l.startsWith('library:')).join('\n'));
  stop();
  await sleep(1500);
  if (!o.keep) rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  if (existsSync(runDir) && !o.keep) console.warn(`couldn't remove ${runDir}`);
}
process.exit(0);
