// Phase 74: big documents in her library. Limits lifted and configurable; uploads streamed to disk
// in resumable pieces; the PDF reader reading a generated book without loading it whole; a
// background job that goes on after a restart, pauses and cancels; every scanned page read;
// contents from bookmarks or headings; section summaries; key points that scale; word + meaning
// search that returns the right page; citations with page links; private local mode; the member
// size limit; the demo's refusal. Uses a small generated book (scripts/make-big-pdf.ts).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeBigPdf } from '../scripts/make-big-pdf.ts';
import { OwnerAuth } from '../src/auth.ts';
import { MemberSettings } from '../src/household.ts';
import { setPrivateLocal } from '../src/net-guard.ts';
import { answerOcr, buildContents, cancelJob, chatFirst, yielding, closeAllPagers, factsBudget, learnSteps, pauseJob, resumeJob, runJob, summaryTargets } from '../src/library/bigread.ts';
import { openPdfFile, PdfBook } from '../src/library/pdf.ts';
import { BufferSource } from '../src/library/source.ts';
import { cleanLibraryLimits, DEFAULT_MAX_MB, DEFAULT_MEMBER_MAX_MB, LibraryStore, libraryLimits, MAX_DOC_BYTES, sha256File } from '../src/library/store.ts';
import { createLibraryTool, librarySection } from '../src/library/use.ts';
import { quantize, VectorIndex } from '../src/library/vectors.ts';
import { learnOne, MAX_FACTS_PER_DOC, MAX_SEEN_PAGES, readOne } from '../src/library/worker.ts';
import { createSaraServer } from '../src/server.ts';
import { chatTurns } from '../src/chat.ts';
// @ts-expect-error plain JS module shared with the browser
import { inline } from '../web/markdown.js';
import { exportAll, importAll } from '../src/export.ts';
import { SettingsStore } from '../src/settings.ts';
import { fakeEmbedder, makeApp, ROOT, tempDir, text } from './helpers.ts';

const LOCAL = { id: 'p', label: 'Ollama here', kind: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:9/v1' };

function setup(t: { after: (fn: () => void | Promise<void>) => void }, provider = LOCAL) {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-29T12:00:00Z') };
  const app = makeApp(dir, clock);
  app.library = new LibraryStore(app.store.db, dir, () => clock.now);
  app.settings.update({ providers: [provider], defaultProviderId: provider.id, defaultModel: 'm', ownerName: 'Alex', timeZone: 'America/Chicago', disclosureAcceptedAt: clock.now.toISOString() });
  t.after(async () => {
    await closeAllPagers();
    app.store.close();
    cleanup();
  });
  return { app, dir, lib: app.library };
}

/** A generated book in the test's folder, added to her library like an upload. */
async function addBook(lib: LibraryStore, dir: string, name: string, opts: Parameters<typeof makeBigPdf>[1]) {
  const path = join(dir, `${name}.src.pdf`);
  const book = makeBigPdf(path, opts);
  const copy = join(dir, `${name}.upload`);
  writeFileSync(copy, readFileSync(path));
  const doc = lib.addFile({ name: `${name}.pdf`, path: copy, sha: await sha256File(copy), keep: true });
  return { book, doc, path };
}

test('limits are lifted and configurable: 1 GB PDFs, every scanned page, key points that grow with length', () => {
  assert.equal(MAX_SEEN_PAGES, Infinity);
  const l = libraryLimits({});
  assert.deepEqual(l, { maxMb: DEFAULT_MAX_MB, memberMaxMb: DEFAULT_MEMBER_MAX_MB, ocr: 'ask', speed: 2 });
  assert.equal(DEFAULT_MAX_MB, 1024);
  assert.equal(DEFAULT_MEMBER_MAX_MB, 100);
  assert.equal(cleanLibraryLimits({ maxMb: 2048, memberMaxMb: 50, ocr: 'local', speed: 1 }, l).maxMb, 2048);
  assert.throws(() => cleanLibraryLimits({ maxMb: 99999 }, l), /offered/);
  assert.throws(() => cleanLibraryLimits({ ocr: 'cloud' }, l), /offered/);
  // Other kinds of file (read whole) keep a memory-sized cap.
  assert.equal(MAX_DOC_BYTES, 100 * 1024 * 1024);
  // Key points: 30 for ordinary documents, many more for a 1,000-page book.
  assert.equal(factsBudget(50_000), MAX_FACTS_PER_DOC);
  assert.ok(factsBudget(3_000_000) > 250 && factsBudget(3_000_000) <= 400);
  assert.equal(learnSteps(50_000), 6);
  assert.ok(learnSteps(3_000_000) > 60);
});

test('the PDF reader reads a page from a generated book without loading the file (xref, object streams, scans, outline)', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  // 30 pages with 3 scans, plus incompressible pictures that make the file ~8 MB.
  const path = join(dir, 'book.pdf');
  const made = makeBigPdf(path, { pages: 30, scanned: 3, bulkMb: 8 });
  const { book, src } = openPdfFile(path);
  t.after(() => src.close());
  assert.equal(book.doc.mode, 'xref', 'found through its cross-reference table');
  assert.equal(book.pageCount, 30);
  assert.equal(book.title, 'Harbor Wind Farm Maintenance Manual');
  const before = { ...src.stats };
  const body = 10;
  const fact = made.facts.find((f) => !f.scanned && f.page > 10)!;
  const page = book.pageText(fact.page - 1, body);
  const flat = (x: string) => x.replace(/\s+/g, ' ');
  assert.ok(flat(page.text).includes(fact.sentence), 'the fact is on its page');
  const read = src.stats.bytes - before.bytes;
  assert.ok(read < 64 * 1024, `one page read ${read} bytes`);
  assert.ok(src.stats.maxRead <= 1024 * 1024, `largest single read ${src.stats.maxRead}`);
  assert.ok(src.stats.bytes < made.bytes / 4, `everything read so far ${src.stats.bytes} of ${made.bytes}`);
  // Scanned pages are recognised and their picture comes out as a PNG.
  const scan = made.scanned[0];
  assert.equal(book.pageText(scan - 1, body).scan, true);
  const im = book.pageImage(scan - 1);
  assert.ok(typeof im !== 'string' && im.mime === 'image/png');
  // The outline: chapters (level 1) and sections (level 2) with the pages they open.
  const outline = book.outline();
  assert.deepEqual(outline.filter((o) => o.level === 1).map((o) => o.page), made.chapters.map((c) => c.page));
  assert.equal(outline.find((o) => o.level === 2 && o.page > 1)!.page, made.chapters[0].sections[1].page);
  // Headings by size: chapter titles '#', section titles '##'.
  assert.match(book.pageText(0, body).text, /^# Chapter 1: Safety and Access\n\n## 1\.1 /);
  // The same book with object streams and a cross-reference stream reads the same.
  const packed = join(dir, 'packed.pdf');
  makeBigPdf(packed, { pages: 30, scanned: 3, objstm: true });
  const p2 = openPdfFile(packed);
  t.after(() => p2.src.close());
  assert.equal(p2.book.doc.mode, 'xref');
  assert.ok(flat(p2.book.pageText(fact.page - 1, body).text).includes(fact.sentence));
  assert.equal(p2.book.outline().length, outline.length);
  // A damaged table (wrong startxref) still opens, by scanning.
  const raw = readFileSync(path);
  const at = raw.lastIndexOf('startxref');
  const broken = Buffer.concat([raw.subarray(0, at), Buffer.from('startxref\n12345\n%%EOF\n')]);
  const b3 = new PdfBook(new BufferSource(broken));
  assert.equal(b3.doc.mode, 'scan');
  assert.ok(flat(b3.pageText(fact.page - 1, body).text).includes(fact.sentence));
});

test('a book is read page by page in the background: text, every scanned page, contents, summaries, then search with pages', async (t) => {
  const { app, dir, lib } = setup(t);
  const { book, doc } = await addBook(lib, dir, 'manual', { pages: 30, scanned: 3 });
  // The picture model reads each scanned page (local provider: no question asked).
  const COLORS = ['crimson', 'saffron', 'violet'];
  book.scanned.forEach((p, k) => app.script.push(text(`Scanned page ${p}. The reserve pump there is painted ${COLORS[k]}.`)));
  const r = await readOne(app, lib, doc);
  assert.equal(r!.status, 'ready');
  assert.equal(r!.pages, 30);
  assert.equal(r!.pagesSeen, 3, 'every scanned page read');
  const visionCalls = app.requests.filter((q) => Array.isArray((q.messages[1] as { images?: unknown[] })?.images));
  assert.equal(visionCalls.length, 3);
  // Text from a scanned page is found, on its page.
  const scanHit = lib.searchWords('reserve pump painted saffron')[0];
  assert.equal(scanHit.passage.page, book.scanned[1]);
  // A fact on a text page is found on its page.
  const fact = book.facts.find((f) => !f.scanned)!;
  assert.equal(lib.searchWords(fact.question)[0].passage.page, fact.page);
  // The rest: contents from the bookmarks, section summaries (scripted), the whole document, key points.
  const before = app.requests.length;
  app.script.push(...Array.from({ length: 20 }, (_, i) => text(`Summary ${i + 1}: inspections and parts (p. 3).`)));
  let step = await runJob(app, lib, doc.id);
  assert.equal(step, 'done');
  const secs = lib.sections(doc.id);
  assert.equal(secs[0].source, 'outline');
  assert.deepEqual(secs.filter((s) => s.level === 1).map((s) => s.page), book.chapters.map((c) => c.page));
  assert.equal(secs[0].pageEnd, book.chapters[1].page - 1);
  const targets = summaryTargets(secs);
  assert.ok(targets.every((s) => s.summary?.startsWith('Summary')), 'each section got a summary');
  assert.ok(app.requests.length > before + targets.length, 'summaries, the overview and the key points were asked for');
  assert.ok(lib.get(doc.id)!.overview, 'a summary of the whole document');
  const job = lib.job(doc.id)!;
  assert.equal(job.phase, 'done');
  assert.ok(job.timings.text >= 0 && job.timings.ocr >= 0 && job.timings.summaries >= 0);
  step = await runJob(app, lib, doc.id);
  assert.equal(step, 'done');
  // Export and import keep the contents, the summaries and the page numbers (citations still work).
  const file = JSON.parse(JSON.stringify(exportAll(app)));
  const b = setup(t);
  importAll(b.app, file);
  const [copy] = b.lib.list();
  assert.equal(copy.pages, 30);
  assert.equal(b.lib.sections(copy.id).length, secs.length);
  assert.ok(b.lib.sections(copy.id).some((x) => x.summary?.startsWith('Summary')));
  assert.equal(b.lib.searchWords(fact.question)[0].passage.page, fact.page);
});

test('a restart in the middle goes on from the same page (no page twice); pause, resume and cancel', async (t) => {
  const { app, dir, lib } = setup(t);
  const { doc } = await addBook(lib, dir, 'long', { pages: 40 });
  lib.startJob(doc.id);
  // A few slices until about a third is read.
  for (let k = 0; k < 200 && (lib.job(doc.id)!.page < 12); k++) await runJob(app, lib, doc.id, { sliceMs: 5, pauseMs: 0 });
  const at = lib.job(doc.id)!.page;
  assert.ok(at >= 12 && at < 40, `stopped at page ${at}`);
  // "Restart": readers closed, a new store on the same database, and a half-written next page.
  await closeAllPagers();
  const lib2 = new LibraryStore(app.store.db, dir, () => app.now());
  app.library = lib2;
  lib2.db.prepare("INSERT INTO library_passages (doc_id, ord, place, heading, text, page) VALUES (?, ?, 'page ' || ?, NULL, 'half a page', ?)").run(doc.id, (at + 1) * 1000, at + 1, at + 1);
  const { forgetResumed } = await import('../src/library/bigread.ts');
  forgetResumed();
  await runJob(app, lib2, doc.id, { until: 'structure', pauseMs: 0 });
  assert.equal(lib2.get(doc.id)!.status, 'ready');
  const perPage = lib2.db.prepare('SELECT page, COUNT(DISTINCT ord) AS n, SUM(text = ?) AS half FROM library_passages WHERE doc_id = ? GROUP BY page').all('half a page', doc.id) as { page: number; n: number; half: number }[];
  assert.equal(perPage.length, 40, 'every page once');
  assert.ok(perPage.every((p) => !p.half), 'the half-written page was read again');
  const ords = lib2.db.prepare('SELECT ord FROM library_passages WHERE doc_id = ?').all(doc.id) as { ord: number }[];
  assert.equal(new Set(ords.map((o) => o.ord)).size, ords.length, 'no passage twice');

  // Pause and resume.
  const { doc: d2 } = await addBook(lib2, dir, 'second', { pages: 30 });
  lib2.startJob(d2.id);
  await runJob(app, lib2, d2.id, { sliceMs: 5, pauseMs: 0 });
  pauseJob(lib2, d2.id);
  const pausedAt = lib2.job(d2.id)!.page;
  assert.equal(await runJob(app, lib2, d2.id, { pauseMs: 0 }), 'paused');
  assert.equal(lib2.job(d2.id)!.page, pausedAt, 'nothing read while paused');
  resumeJob(lib2, d2.id);
  await runJob(app, lib2, d2.id, { until: 'structure', pauseMs: 0 });
  assert.equal(lib2.get(d2.id)!.status, 'ready');

  // Cancel in the middle: what was read stays, with a note where she stopped.
  const { doc: d3 } = await addBook(lib2, dir, 'third', { pages: 30 });
  lib2.startJob(d3.id);
  for (let k = 0; k < 200 && lib2.job(d3.id)!.page < 5; k++) await runJob(app, lib2, d3.id, { sliceMs: 5, pauseMs: 0 });
  cancelJob(app, lib2, d3.id);
  assert.equal(await runJob(app, lib2, d3.id), 'cancelled');
  const d3now = lib2.get(d3.id)!;
  assert.equal(d3now.status, 'ready');
  assert.ok(d3now.warnings.some((w) => /stopped reading at page \d+ of 30/.test(w)));
});

test('contents without bookmarks: headings by size and numbering, else parts; running heads are not sections', () => {
  const heading = (title: string, page: number, level = 1) => ({ id: page, docId: 1, ord: page, level, title, page, pageEnd: 0, source: 'heading' as const, summary: null });
  const rows = buildContents([], [heading('Chapter 1: Start', 1), heading('1.1 Setup', 3, 2), heading('Chapter 2: Use', 40), heading('2.1 Daily', 41, 2)], 80);
  assert.deepEqual(
    rows.map((r) => [r.title, r.page, r.pageEnd]),
    [['Chapter 1: Start', 1, 39], ['1.1 Setup', 3, 39], ['Chapter 2: Use', 40, 80], ['2.1 Daily', 41, 80]],
  );
  // A running head on every page is dropped.
  const running = Array.from({ length: 60 }, (_, i) => heading('ACME MANUAL', i + 1));
  assert.equal(buildContents([], running, 60).filter((r) => r.title === 'ACME MANUAL').length, 0);
  // Nothing at all: parts of 25 pages.
  assert.deepEqual(buildContents([], [], 60).map((r) => r.title), ['Pages 1–25', 'Pages 26–50', 'Pages 51–60']);
});

test('key points scale with length: a long document is read in more windows and keeps more notes', async (t) => {
  const { app, lib } = setup(t);
  const pages = Array.from({ length: 120 }, (_, i) => ({ where: `page ${i + 1}`, text: Array.from({ length: 30 }, (_, k) => `Line ${k} of page ${i + 1} says the part number for item ${i}-${k} is P${i * 100 + k}.`).join(' ') }));
  const d = lib.add({ name: 'parts.pdf', bytes: Buffer.from('parts list'), keep: true });
  lib.setRead(d.id, { kind: 'pdf', parts: pages, warnings: [] });
  const chars = lib.get(d.id)!.chars;
  assert.ok(chars > 200_000);
  const windows = learnSteps(chars);
  for (let w = 0; w < windows; w++) {
    const notes = Array.from({ length: 8 }, (_, k) => ({ note: `Item ${w}-${k} has part number P${w * 100 + k}.`, quote: `the part number for item ${w}-${k} is P${w * 100 + k}` }));
    app.script.push(text(JSON.stringify({ notes })));
  }
  const kept = await learnOne(app, lib, lib.get(d.id)!);
  assert.ok(windows > 6, `${windows} windows`);
  assert.ok(kept > MAX_FACTS_PER_DOC, `${kept} notes kept (more than the old 30)`);
  assert.ok(kept <= factsBudget(lib.text(d.id, 8_000_000).length));
});

test('key points go on after a pause from the next window (not marked done half way, not asked twice)', async (t) => {
  const { app, lib } = setup(t);
  const pages = Array.from({ length: 60 }, (_, i) => ({ where: `page ${i + 1}`, text: Array.from({ length: 30 }, (_, k) => `Line ${k} of page ${i + 1} says the part number for item ${i}-${k} is P${i * 100 + k}.`).join(' ') }));
  const d = lib.add({ name: 'parts.pdf', bytes: Buffer.from('parts list two'), keep: true });
  lib.setRead(d.id, { kind: 'pdf', parts: pages, warnings: [] });
  const windows = learnSteps(lib.get(d.id)!.chars);
  const say = (w: number) => text(JSON.stringify({ notes: [{ note: `Item ${w}-0 has part number P${w * 100}.`, quote: `the part number for item ${w}-0 is P${w * 100}` }] }));
  // Two windows, then a pause.
  app.script.push(say(0), say(1));
  let done = 0;
  await learnOne(app, lib, lib.get(d.id)!, undefined, (n) => ((done = n), n >= 2));
  assert.equal(done, 2);
  assert.equal(lib.get(d.id)!.learn, 'learning', 'not done half way');
  // Resumed: the rest of the windows, from the third.
  for (let w = 2; w < windows; w++) app.script.push(say(w));
  const asked = app.script.length;
  const kept = await learnOne(app, lib, lib.get(d.id)!, undefined, undefined, undefined, done);
  assert.equal(asked - app.script.length, windows - 2, 'each remaining window asked once');
  assert.equal(lib.get(d.id)!.learn, 'done');
  assert.equal(kept, windows);
});

test('search scales: int8 vectors pick the same best passage; meaning + word search return the right page with a citation link', async (t) => {
  // Quantized brute force agrees with exact cosine on 3,000 random vectors.
  const dim = 64;
  const ix = new VectorIndex('m');
  const vecs: Float32Array[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let i = 0; i < 3000; i++) {
    const v = Float32Array.from({ length: dim }, rnd);
    const n = Math.hypot(...v);
    for (let k = 0; k < dim; k++) v[k] /= n;
    vecs.push(v);
    ix.add(i + 1, 1, v);
  }
  let agree = 0;
  for (let q = 0; q < 50; q++) {
    const query = vecs[q * 7];
    const exact = vecs.map((v, i) => ({ i: i + 1, s: v.reduce((a, x, k) => a + x * query[k], 0) })).sort((a, b) => b.s - a.s)[0].i;
    if (ix.candidates(query, new Set([1]), 5).some((c) => c.id === exact)) agree++;
  }
  assert.equal(agree, 50);
  assert.ok(quantize(vecs[0]).q.every((x) => x >= -127 && x <= 127));
  // A real library: words find the page, meaning (fake embedder) too, and the tool cites the page.
  const { app, dir, lib } = setup(t);
  const url = await fakeEmbedder(t);
  app.settings.update({ providers: [LOCAL, { id: 'e', label: 'E', kind: 'openai-compatible', baseUrl: url }], routes: { embeddings: { providerId: 'e', model: 'fake-embed' } } });
  const { book, doc } = await addBook(lib, dir, 'manual', { pages: 30 });
  await readOne(app, lib, doc);
  await runJob(app, lib, doc.id, { pauseMs: 0 });
  assert.ok(lib.vectorCount('fake-embed') >= lib.get(doc.id)!.passages, 'every passage has a vector');
  const fact = book.facts.find((f) => /firmware/.test(f.sentence))!;
  const hits = await lib.find(fact.question, { target: { config: app.settings.get().providers[1], model: 'fake-embed' } });
  assert.equal(hits[0].passage.page, fact.page);
  const tool = createLibraryTool(() => app);
  const conv = app.store.createConversation({ title: 'Q' });
  const out = String(await tool.run({ action: 'search', query: fact.question }, { conversationId: conv.id } as Parameters<typeof tool.run>[1]));
  assert.ok(out.includes(`[p. ${fact.page}](/#view=library:${doc.id}:${fact.page})`), 'the passage carries its citation link');
  const page = String(await tool.run({ action: 'read', document: 'manual', place: `page ${fact.page}` }, { conversationId: conv.id } as Parameters<typeof tool.run>[1]));
  assert.ok(page.replace(/\s+/g, ' ').includes(fact.sentence));
  const contents = String(await tool.run({ action: 'contents', document: 'manual' }, { conversationId: conv.id } as Parameters<typeof tool.run>[1]));
  assert.match(contents, /Chapter 1: Safety and Access: pages 1-15 \[p\. 1\]\(\/#view=library:\d+:1\)/);
  // A key point learned from the book cites its page too.
  app.memory!.add({ kind: 'fact', content: 'The Heron controller runs firmware 5.12.3.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-29', evidence: 'The firmware of the Heron controller is version 5.12.3', sourceDocId: doc.id });
  assert.equal(lib.pageOf(doc.id, 'The firmware of the Heron controller is version 5.12.3'), fact.page);
  const section = (await librarySection(app, conv, `what does the manual say: ${fact.question}`))!;
  assert.match(section, /\(30 pages\)/);
  assert.match(section, /say which page and add the link/);
});

test('private local mode keeps scanned pages and meaning search local; a cloud picture model asks first with an estimate', async (t) => {
  const cloud = { id: 'c', label: 'Cloud', kind: 'openai-compatible' as const, baseUrl: 'https://api.example.com/v1' };
  const { app, dir, lib } = setup(t, cloud);
  app.settings.update({ prices: [{ model: 'm', inPerM: 2, outPerM: 10 }] });
  const { doc } = await addBook(lib, dir, 'scans', { pages: 12, scanned: 4 });
  // Cloud model, mode off: she waits for the owner, with the cost and time.
  lib.startJob(doc.id);
  assert.equal(await runJob(app, lib, doc.id, { pauseMs: 0 }), 'waiting');
  const { jobView } = await import('../src/library/bigread.ts');
  const view = jobView(app, lib, lib.get(doc.id)!)!;
  assert.equal(view.needs, 'ocr-approval');
  const est = view.estimate as { pages: number; usd: number; local: boolean; seconds: number };
  assert.equal(est.pages, 4);
  assert.equal(est.local, false);
  assert.ok(est.usd > 0 && est.seconds > 0);
  assert.equal(app.requests.length, 0, 'no picture went anywhere before the owner said yes');
  // With private local mode on, the cloud model is never asked, even after "yes".
  setPrivateLocal(true);
  t.after(() => setPrivateLocal(false));
  answerOcr(lib, doc.id, true);
  assert.equal(await runJob(app, lib, doc.id, { pauseMs: 0 }), 'waiting');
  assert.equal(lib.job(doc.id)!.needs, 'local-ocr');
  assert.equal(app.requests.length, 0);
  // Skipping the scanned pages lets the rest go on; meaning search with a cloud embedder is skipped.
  setPrivateLocal(false);
  app.settings.update({ routes: { embeddings: { providerId: 'c', model: 'emb' } } });
  resumeJob(lib, doc.id);
  answerOcr(lib, doc.id, false);
  setPrivateLocal(true);
  app.script.push(...Array.from({ length: 10 }, () => text('Short summary.')));
  await runJob(app, lib, doc.id, { until: 'structure', pauseMs: 0 });
  assert.equal(lib.get(doc.id)!.status, 'ready');
  assert.ok(lib.get(doc.id)!.warnings.some((w) => /4 scanned pages were not read/.test(w)));
  lib.updateJob(doc.id, { phase: 'vectors' });
  await runJob(app, lib, doc.id, { pauseMs: 0 });
  assert.ok(lib.job(doc.id)!.warnings.some((w) => /Meaning search is paused in private local mode/.test(w)));
  assert.equal(lib.vectorCount('emb'), 0);
});

test('uploads stream to disk: one request, or resumable pieces (wrong offset → where to go on); size limits; members; demo', async (t) => {
  const { app, dir, lib } = setup(t);
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const h = { authorization: `Bearer ${auth.newToken}` };
  const json = { ...h, 'content-type': 'application/json' };
  const made = makeBigPdf(join(dir, 'up.pdf'), { pages: 12, bulkMb: 3 });
  const file = readFileSync(made.path);
  // Resumable: start, send a piece, send a piece for the wrong place (409 says where), finish.
  let r = await fetch(`${base}/api/library/uploads`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'up.pdf', size: file.length, keep: true }) });
  assert.equal(r.status, 201);
  const up = (await r.json()) as { id: string; chunkBytes: number; received: number };
  assert.equal(up.chunkBytes, 8 * 1024 * 1024);
  const piece = 1024 * 1024;
  r = await fetch(`${base}/api/library/uploads/${up.id}?offset=0`, { method: 'PUT', headers: { ...h, 'content-type': 'application/octet-stream' }, body: file.subarray(0, piece) });
  assert.equal(((await r.json()) as { received: number }).received, piece);
  // The connection "dropped" and the app sends the first piece again: the server says where it is.
  r = await fetch(`${base}/api/library/uploads/${up.id}?offset=0`, { method: 'PUT', headers: { ...h, 'content-type': 'application/octet-stream' }, body: file.subarray(0, piece) });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { received: number }).received, piece);
  r = await fetch(`${base}/api/library/uploads/${up.id}`, { headers: h });
  assert.equal(((await r.json()) as { received: number }).received, piece);
  // Finishing early is refused.
  r = await fetch(`${base}/api/library/uploads/${up.id}/done`, { method: 'POST', headers: json, body: '{}' });
  assert.equal(r.status, 409);
  for (let off = piece; off < file.length; off += piece) {
    r = await fetch(`${base}/api/library/uploads/${up.id}?offset=${off}`, { method: 'PUT', headers: { ...h, 'content-type': 'application/octet-stream' }, body: file.subarray(off, off + piece) });
    assert.equal(r.status, 200);
  }
  r = await fetch(`${base}/api/library/uploads/${up.id}/done`, { method: 'POST', headers: json, body: '{}' });
  assert.equal(r.status, 201);
  const doc = ((await r.json()) as { doc: { id: number; size: number; status: string } }).doc;
  assert.equal(doc.size, file.length);
  assert.deepEqual(readFileSync(lib.filePath(lib.get(doc.id)!)!), file, 'the stored file is the same, byte for byte');
  // The same file again (one request, streamed): already in her library.
  r = await fetch(`${base}/api/library?name=again.pdf`, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: file });
  assert.equal(((await r.json()) as { already?: boolean }).already, true);
  // Size limits: the owner's setting, refused before any byte is stored.
  r = await fetch(`${base}/api/library/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ maxMb: 100, memberMaxMb: 25, ocr: 'local', speed: 3 }) });
  assert.deepEqual(((await r.json()) as { maxMb: number; memberMaxMb: number; ocr: string; speed: number }).ocr, 'local');
  r = await fetch(`${base}/api/library/uploads`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'huge.pdf', size: 101 * 1024 * 1024 }) });
  assert.equal(r.status, 413);
  assert.match(((await r.json()) as { error: string }).error, /up to 100 MB/);
  // Files over 100 MB must be PDFs (others are read whole): checked on the bytes, not the name.
  // (Shown with the limit itself: a 1 MB text file under a 100 MB limit is fine.)
  r = await fetch(`${base}/api/library?name=notes.txt`, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: 'Notes about the boiler.' });
  assert.equal(r.status, 201);
  // The PDF opens inline at a page for citations, and byte ranges work (the browser's viewer).
  r = await fetch(`${base}/api/library/${doc.id}/file?inline=1`, { headers: { ...h, range: 'bytes=0-7' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(await r.text(), '%PDF-1.5');
  // A household member: their limit is the owner's member limit, and they can't change the owner's settings.
  const ownerSettings = new SettingsStore(app.dataDir);
  const mdir = tempDir();
  const ddir = tempDir();
  const mapp = makeApp(mdir.dir, { now: new Date('2026-10-29T12:00:00Z') });
  mapp.settings = new MemberSettings(mdir.dir, ownerSettings, () => ({ models: [{ providerId: 'p', model: 'm' }], messagesPerDay: 0, costPerDay: 0, voice: true, pictures: true }));
  mapp.library = new LibraryStore(mapp.store.db, mdir.dir);
  const dapp = makeApp(ddir.dir, { now: new Date() });
  dapp.library = new LibraryStore(dapp.store.db, dapp.dataDir);
  // One after-hook: servers, then databases, then folders (Windows can't delete an open database).
  const closers: (() => void)[] = [];
  t.after(() => {
    for (const c of closers) c();
    mapp.store.close();
    dapp.store.close();
    mdir.cleanup();
    ddir.cleanup();
  });
  const rec = { id: 'm1', name: 'Ana', createdAt: '', status: 'active', ownerConfirmed18At: '', memberConfirmed18At: '', limits: { models: [], messagesPerDay: 0, costPerDay: 0, voice: true, pictures: true } };
  const mauth = new OwnerAuth(mdir.dir);
  const msrv = createSaraServer({ app: mapp, auth: mauth, webDir: join(ROOT, 'web'), member: { record: () => rec as never, apps: () => [mapp], deleteSelf: async () => {} } });
  await new Promise<void>((res) => msrv.listen(0, '127.0.0.1', res));
  closers.push(() => msrv.close());
  const mbase = `http://127.0.0.1:${(msrv.address() as { port: number }).port}`;
  const mh = { authorization: `Bearer ${mauth.newToken}`, 'content-type': 'application/json' };
  r = await fetch(`${mbase}/api/library/settings`, { headers: mh });
  const ms = (await r.json()) as { maxBytes: number; owner: boolean };
  assert.equal(ms.maxBytes, 25 * 1024 * 1024, "the owner's member limit");
  assert.equal(ms.owner, false);
  r = await fetch(`${mbase}/api/library/uploads`, { method: 'POST', headers: mh, body: JSON.stringify({ name: 'big.pdf', size: 30 * 1024 * 1024 }) });
  assert.equal(r.status, 413);
  r = await fetch(`${mbase}/api/library/settings`, { method: 'PUT', headers: mh, body: JSON.stringify({ memberMaxMb: 1024 }) });
  assert.equal(r.status, 403);
  // The demo keeps its library closed (reads and uploads).
  const dauth = new OwnerAuth(dapp.dataDir);
  const demo = createSaraServer({ app: dapp, auth: dauth, webDir: join(ROOT, 'web'), demo: true });
  await new Promise<void>((res) => demo.listen(0, '127.0.0.1', res));
  closers.push(() => demo.close());
  const dbase = `http://127.0.0.1:${(demo.address() as { port: number }).port}`;
  const dh = { authorization: `Bearer ${dauth.newToken}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${dbase}/api/library`, { headers: dh })).status, 403);
  assert.equal((await fetch(`${dbase}/api/library/uploads`, { method: 'POST', headers: dh, body: JSON.stringify({ name: 'x.pdf', size: 10 }) })).status, 403);
});

test('chat first: background model calls wait while a chat turn runs (not at the Fast speed)', async (t) => {
  const { app } = setup(t);
  chatTurns.running++;
  setTimeout(() => chatTurns.running--, 400);
  const t0 = Date.now();
  await chatFirst(app);
  assert.ok(Date.now() - t0 >= 350, 'waited for the chat');
  app.settings.update({ libraryLimits: { speed: 3 } });
  chatTurns.running++;
  const t1 = Date.now();
  await chatFirst(app);
  chatTurns.running--;
  assert.ok(Date.now() - t1 < 100, 'Fast does not wait');
});

test('a background call steps aside when a chat starts, and runs again after it', async (t) => {
  const { app } = setup(t);
  let calls = 0;
  const p = yielding(app, undefined, (signal) => {
    calls++;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve(`done after ${calls} tries`), 300);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    });
  });
  await new Promise((r) => setTimeout(r, 50));
  // A chat starts: the call in flight is stopped; it waits for the chat, then runs again.
  chatTurns.running++;
  for (const f of chatTurns.onStart) f();
  setTimeout(() => chatTurns.running--, 200);
  assert.equal(await p, 'done after 2 tries');
});

test('page links in her answers are links, with or without the leading slash', () => {
  for (const md of ['[p. 412](/#view=library:3:412)', '[p. 412](#view=library:3:412)', '[p. 412](/ #view=library:3:412)', '[p. 412](_#view=library:3:412_)', '[p. 412](*/#view=library:3:412*)']) {
    const [node] = inline(md) as { t: string; href?: string }[];
    assert.equal(node.t, 'a', md);
    assert.equal(node.href, '/#view=library:3:412', md);
  }
  // Anything else starting with # is not.
  assert.notEqual((inline('[x](#javascript:alert)') as { t: string }[])[0].t, 'a');
});
