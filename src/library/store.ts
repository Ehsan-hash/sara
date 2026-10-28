// Phase 44: her library. Documents the owner gives her are kept as they came (in <data>/library),
// read into passages that remember where they are ("page 4", "sheet Budget", "slide 3"), and found
// again by their words (SQLite FTS5, always) and by meaning (vectors, when the Meaning search job is
// set). A document is either kept in her library (searchable from any of the owner's chats) or
// "read once" for a single conversation (found only there, gone with that conversation).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { cosine, type EmbedTarget, embedTexts } from '../embeddings.ts';
import { ftsQuery } from '../memory.ts';

/** Largest file she takes (the readers also cap the text). */
export const MAX_DOC_BYTES = 60 * 1024 * 1024;
/** About how long a passage is, and how much neighbouring passages overlap. */
export const PASSAGE_CHARS = 1400;
const OVERLAP_CHARS = 200;
/** Meaning-search floor for passages (nomic-embed-text: relevant ~0.55+, unrelated up to ~0.5). */
export const PASSAGE_MIN_SCORE = 0.52;
const VECTOR_BATCH = 32;

export type DocStatus = 'waiting' | 'reading' | 'ready' | 'failed';
export type LearnStatus = 'off' | 'waiting' | 'learning' | 'done' | 'failed';
export type DocOrigin = 'library' | 'chat' | 'telegram' | 'discord';

export interface LibraryDoc {
  id: number;
  name: string;
  kind: string | null;
  size: number;
  sha: string;
  title: string | null;
  status: DocStatus;
  error: string | null;
  warnings: string[];
  /** Kept in her library (true) or read once for one conversation (false). */
  keep: boolean;
  conversationId: string | null;
  origin: DocOrigin;
  passages: number;
  chars: number;
  /** Pages read by the picture model (scanned pages, photos of pages). */
  pagesSeen: number;
  learn: LearnStatus;
  learnError: string | null;
  facts: number;
  /** One line on what it is ("A 12-month lease for 14 Elm St, from March 2026"), written while learning. */
  summary: string | null;
  addedAt: string;
  readAt: string | null;
}

export interface Passage {
  id: number;
  docId: number;
  ord: number;
  /** Where in the document: "page 4", "sheet Budget", "slide 3", "chapter 2", or "". */
  place: string;
  heading: string | null;
  text: string;
}

export interface PassageHit {
  passage: Passage;
  doc: LibraryDoc;
  /** Higher is better; word hits and meaning hits are merged by rank. */
  score: number;
  by: 'words' | 'meaning' | 'both';
}

/** A piece of a read document, as the readers return it. */
export interface PartIn {
  text: string;
  where: string;
  heading?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS library_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT,
  size INTEGER NOT NULL,
  sha TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  title TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  error TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  keep INTEGER NOT NULL DEFAULT 1,
  conversation_id TEXT,
  origin TEXT NOT NULL DEFAULT 'library',
  passages INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  pages_seen INTEGER NOT NULL DEFAULT 0,
  learn TEXT NOT NULL DEFAULT 'off',
  learn_error TEXT,
  facts INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  added_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS library_docs_conv ON library_docs(conversation_id);
CREATE TABLE IF NOT EXISTS library_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  place TEXT NOT NULL DEFAULT '',
  heading TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS library_passages_doc ON library_passages(doc_id, ord);
CREATE VIRTUAL TABLE IF NOT EXISTS library_fts USING fts5(text, heading, content='library_passages', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS library_passages_ai AFTER INSERT ON library_passages BEGIN
  INSERT INTO library_fts(rowid, text, heading) VALUES (new.id, new.text, coalesce(new.heading, ''));
END;
CREATE TRIGGER IF NOT EXISTS library_passages_ad AFTER DELETE ON library_passages BEGIN
  INSERT INTO library_fts(library_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, coalesce(old.heading, ''));
END;
CREATE TABLE IF NOT EXISTS library_vectors (
  passage_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  vec BLOB NOT NULL
);
`;

type Row = Record<string, string | number | null>;

function toDoc(r: Row): LibraryDoc {
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(String(r.warnings ?? '[]')) as string[];
  } catch {
    /* old row */
  }
  return {
    id: Number(r.id),
    name: String(r.name),
    kind: (r.kind as string | null) ?? null,
    size: Number(r.size),
    sha: String(r.sha),
    title: (r.title as string | null) ?? null,
    status: r.status as DocStatus,
    error: (r.error as string | null) ?? null,
    warnings,
    keep: Boolean(r.keep),
    conversationId: (r.conversation_id as string | null) ?? null,
    origin: r.origin as DocOrigin,
    passages: Number(r.passages),
    chars: Number(r.chars),
    pagesSeen: Number(r.pages_seen),
    learn: r.learn as LearnStatus,
    learnError: (r.learn_error as string | null) ?? null,
    facts: Number(r.facts),
    summary: (r.summary as string | null) ?? null,
    addedAt: String(r.added_at),
    readAt: (r.read_at as string | null) ?? null,
  };
}

const toPassage = (r: Row): Passage => ({ id: Number(r.id), docId: Number(r.doc_id), ord: Number(r.ord), place: String(r.place ?? ''), heading: (r.heading as string | null) ?? null, text: String(r.text) });

/** A file name that is safe to show and store (no folders, no control characters). */
export function cleanName(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const s = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  return s || 'document';
}

/** The file's extension in lower case (letters and digits only), for storing the original. */
function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
}

/**
 * Splits read parts into passages of about PASSAGE_CHARS, on paragraph (then sentence) boundaries,
 * never across a page/sheet/slide; neighbouring passages in the same place overlap a little so a
 * fact on the boundary is found from either side.
 */
export function toPassages(parts: PartIn[], size = PASSAGE_CHARS, overlap = OVERLAP_CHARS): { place: string; heading: string | null; text: string }[] {
  const out: { place: string; heading: string | null; text: string }[] = [];
  for (const part of parts) {
    const place = String(part.where ?? '').slice(0, 80);
    let heading: string | null = part.heading?.trim().slice(0, 200) || null;
    const paras = String(part.text ?? '')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((p) => p.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
    let cur = '';
    let curHeading = heading;
    // Has the passage got text of its own (not only the overlap carried from the one before)?
    let fresh = false;
    const flush = (carry: boolean) => {
      const t = cur.trim();
      if (t && fresh) out.push({ place, heading: curHeading, text: t });
      cur = carry && overlap > 0 && t.length > overlap ? `${t.slice(-overlap).replace(/^\S*\s/, '')}\n\n` : '';
      fresh = false;
      curHeading = heading;
    };
    for (const para of paras) {
      // A Markdown-style heading line starts a new section (no overlap across sections).
      const h = /^#{1,6}\s+(.{1,200})$/.exec(para);
      if (h) {
        flush(false);
        heading = h[1].trim();
        curHeading = heading;
        cur = `${para}\n\n`;
        continue;
      }
      for (const piece of splitLong(para, size)) {
        if (fresh && cur.length + piece.length > size) flush(true);
        cur += `${piece}\n\n`;
        fresh = true;
      }
    }
    flush(false);
  }
  return out;
}

/** One very long paragraph (a table, a page with no blank lines) becomes sentence-sized pieces. */
function splitLong(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < size * 0.5) cut = window.lastIndexOf(' ');
    if (cut < size * 0.3) cut = size - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

export class LibraryStore {
  readonly db: DatabaseSync;
  readonly dir: string;
  readonly #now: () => Date;
  #vecCache: { model: string; rows: { id: number; vec: Float32Array }[] } | undefined;
  /** The last problem making passage vectors (shown on the Library page), cleared on success. */
  vectorError: string | undefined;

  constructor(db: DatabaseSync, dataDir: string, now: () => Date = () => new Date()) {
    this.db = db;
    this.dir = join(dataDir, 'library');
    this.#now = now;
    db.exec(SCHEMA);
  }

  /** Saves the original file and lists it as waiting to be read. */
  add(f: { name: string; bytes: Buffer; keep: boolean; conversationId?: string | null; origin?: DocOrigin; learn?: boolean }): LibraryDoc {
    if (!f.bytes.length) throw new Error('That file is empty.');
    if (f.bytes.length > MAX_DOC_BYTES) throw new Error(`Documents can be up to ${MAX_DOC_BYTES / 1024 / 1024} MB.`);
    const name = cleanName(f.name);
    const sha = createHash('sha256').update(f.bytes).digest('hex');
    const ext = extOf(name);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = join(this.dir, `${sha.slice(0, 40)}.${ext}`);
    if (!existsSync(file)) writeFileSync(file, f.bytes, { mode: 0o600 });
    const r = this.db
      .prepare('INSERT INTO library_docs (name, size, sha, ext, keep, conversation_id, origin, learn, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, f.bytes.length, sha, ext, f.keep ? 1 : 0, f.conversationId ?? null, f.origin ?? (f.keep ? 'library' : 'chat'), f.keep && f.learn !== false ? 'waiting' : 'off', this.#now().toISOString());
    return this.get(Number(r.lastInsertRowid))!;
  }

  /** The same file already kept in her library, if any (so a second upload doesn't double it). */
  findKept(bytes: Buffer): LibraryDoc | undefined {
    const sha = createHash('sha256').update(bytes).digest('hex');
    const r = this.db.prepare("SELECT * FROM library_docs WHERE sha = ? AND keep = 1 AND status != 'failed' ORDER BY id LIMIT 1").get(sha) as Row | undefined;
    return r ? toDoc(r) : undefined;
  }

  get(id: number): LibraryDoc | undefined {
    const r = this.db.prepare('SELECT * FROM library_docs WHERE id = ?').get(id) as Row | undefined;
    return r ? toDoc(r) : undefined;
  }

  /** The original file's bytes. */
  file(doc: LibraryDoc): Buffer | undefined {
    const ext = (this.db.prepare('SELECT ext FROM library_docs WHERE id = ?').get(doc.id) as { ext: string } | undefined)?.ext ?? 'bin';
    const path = join(this.dir, `${doc.sha.slice(0, 40)}.${ext}`);
    return existsSync(path) ? readFileSync(path) : undefined;
  }

  /** Her library (kept documents), newest first; or the documents read once in one conversation. */
  list(opts: { conversationId?: string } = {}): LibraryDoc[] {
    const rows = opts.conversationId
      ? this.db.prepare('SELECT * FROM library_docs WHERE keep = 0 AND conversation_id = ? ORDER BY id DESC').all(opts.conversationId)
      : this.db.prepare('SELECT * FROM library_docs WHERE keep = 1 ORDER BY id DESC').all();
    return (rows as Row[]).map(toDoc);
  }

  /** Documents waiting to be read (oldest first). */
  waiting(limit = 5): LibraryDoc[] {
    return (this.db.prepare("SELECT * FROM library_docs WHERE status IN ('waiting', 'reading') ORDER BY id LIMIT ?").all(limit) as Row[]).map(toDoc);
  }

  /** Read documents whose key facts are still to be written. */
  toLearn(limit = 3): LibraryDoc[] {
    return (this.db.prepare("SELECT * FROM library_docs WHERE status = 'ready' AND keep = 1 AND learn IN ('waiting', 'learning') ORDER BY id LIMIT ?").all(limit) as Row[]).map(toDoc);
  }

  setStatus(id: number, status: DocStatus, error: string | null = null): void {
    this.db.prepare('UPDATE library_docs SET status = ?, error = ? WHERE id = ?').run(status, error, id);
  }

  setLearn(id: number, learn: LearnStatus, patch: { error?: string | null; facts?: number; summary?: string | null } = {}): void {
    this.db.prepare('UPDATE library_docs SET learn = ?, learn_error = ?, facts = coalesce(?, facts), summary = coalesce(?, summary) WHERE id = ?').run(learn, patch.error ?? null, patch.facts ?? null, patch.summary?.trim().slice(0, 300) || null, id);
  }

  rename(id: number, name: string): LibraryDoc | undefined {
    this.db.prepare('UPDATE library_docs SET name = ? WHERE id = ?').run(cleanName(name), id);
    return this.get(id);
  }

  /** Keeps a read-once document in her library after all (it becomes searchable everywhere). */
  keep(id: number, learn = true): LibraryDoc | undefined {
    this.db.prepare("UPDATE library_docs SET keep = 1, conversation_id = NULL, origin = CASE origin WHEN 'chat' THEN 'chat' ELSE origin END, learn = CASE WHEN ? AND learn = 'off' THEN 'waiting' ELSE learn END WHERE id = ?").run(learn ? 1 : 0, id);
    return this.get(id);
  }

  /** Stores what was read: replaces any passages from an earlier read. */
  setRead(id: number, r: { title?: string | null; kind: string; parts: PartIn[]; warnings: string[]; pagesSeen?: number }): LibraryDoc | undefined {
    const passages = toPassages(r.parts);
    this.db.exec('BEGIN');
    try {
      this.#dropPassages(id);
      const put = this.db.prepare('INSERT INTO library_passages (doc_id, ord, place, heading, text) VALUES (?, ?, ?, ?, ?)');
      passages.forEach((p, i) => put.run(id, i, p.place, p.heading, p.text));
      const chars = r.parts.reduce((n, p) => n + String(p.text ?? '').length, 0);
      this.db
        .prepare("UPDATE library_docs SET status = 'ready', error = NULL, kind = ?, title = ?, warnings = ?, passages = ?, chars = ?, pages_seen = ?, read_at = ? WHERE id = ?")
        .run(r.kind, r.title?.trim().slice(0, 300) || null, JSON.stringify(r.warnings.slice(0, 20)), passages.length, chars, r.pagesSeen ?? 0, this.#now().toISOString(), id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.#vecCache = undefined;
    return this.get(id);
  }

  #dropPassages(docId: number): void {
    this.db.prepare('DELETE FROM library_vectors WHERE passage_id IN (SELECT id FROM library_passages WHERE doc_id = ?)').run(docId);
    this.db.prepare('DELETE FROM library_passages WHERE doc_id = ?').run(docId);
  }

  /**
   * Import (export file): a kept document comes back with the text she read (the original file
   * isn't in exports; its text is stored as a .txt so it can be downloaded and read again).
   * Runs inside the caller's transaction. Returns the new id, or the id of the same text already here.
   */
  importDoc(d: { name: string; kind?: string | null; title?: string | null; summary?: string | null; addedAt?: string; passages: { place: string; heading: string | null; text: string }[] }): number {
    const body = Buffer.from(d.passages.map((p) => (p.place ? `[${p.place}]\n${p.text}` : p.text)).join('\n\n'), 'utf8');
    const sha = createHash('sha256').update(body).digest('hex');
    const had = this.db.prepare('SELECT id FROM library_docs WHERE sha = ? AND keep = 1').get(sha) as { id: number } | undefined;
    if (had) return had.id;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = join(this.dir, `${sha.slice(0, 40)}.txt`);
    if (!existsSync(file)) writeFileSync(file, body, { mode: 0o600 });
    const chars = d.passages.reduce((n, p) => n + p.text.length, 0);
    const id = Number(
      this.db
        .prepare("INSERT INTO library_docs (name, kind, size, sha, ext, title, status, keep, origin, passages, chars, learn, summary, added_at, read_at) VALUES (?, ?, ?, ?, 'txt', ?, 'ready', 1, 'library', ?, ?, 'done', ?, ?, ?)")
        .run(cleanName(d.name), d.kind ?? null, body.length, sha, d.title ?? null, d.passages.length, chars, d.summary ?? null, d.addedAt ?? this.#now().toISOString(), this.#now().toISOString()).lastInsertRowid,
    );
    const put = this.db.prepare('INSERT INTO library_passages (doc_id, ord, place, heading, text) VALUES (?, ?, ?, ?, ?)');
    d.passages.forEach((p, i) => put.run(id, i, String(p.place ?? '').slice(0, 80), p.heading ?? null, String(p.text)));
    this.#vecCache = undefined;
    return id;
  }

  /** For export: kept documents with the text she read. */
  exportDocs(): { id: number; name: string; kind: string | null; title: string | null; summary: string | null; addedAt: string; passages: { place: string; heading: string | null; text: string }[] }[] {
    return this.list()
      .filter((d) => d.status === 'ready')
      .map((d) => ({ id: d.id, name: d.name, kind: d.kind, title: d.title, summary: d.summary, addedAt: d.addedAt, passages: this.passages(d.id, { limit: 1_000_000 }).map((p) => ({ place: p.place, heading: p.heading, text: p.text })) }));
  }

  /** Removes a document, its passages and (if nothing else uses it) the original file. */
  delete(id: number): boolean {
    const doc = this.get(id);
    if (!doc) return false;
    const ext = (this.db.prepare('SELECT ext FROM library_docs WHERE id = ?').get(id) as { ext: string }).ext;
    this.#dropPassages(id);
    this.db.prepare('DELETE FROM library_docs WHERE id = ?').run(id);
    const others = (this.db.prepare('SELECT COUNT(*) AS n FROM library_docs WHERE sha = ?').get(doc.sha) as { n: number }).n;
    if (!others) rmSync(join(this.dir, `${doc.sha.slice(0, 40)}.${ext}`), { force: true });
    this.#vecCache = undefined;
    return true;
  }

  /** Read-once documents of a conversation that is being deleted. */
  deleteForConversation(conversationId: string): number {
    const ids = (this.db.prepare('SELECT id FROM library_docs WHERE keep = 0 AND conversation_id = ?').all(conversationId) as { id: number }[]).map((r) => r.id);
    for (const id of ids) this.delete(id);
    return ids.length;
  }

  passages(docId: number, opts: { from?: number; limit?: number } = {}): Passage[] {
    return (this.db.prepare('SELECT * FROM library_passages WHERE doc_id = ? AND ord >= ? ORDER BY ord LIMIT ?').all(docId, opts.from ?? 0, opts.limit ?? 50) as Row[]).map(toPassage);
  }

  passage(id: number): Passage | undefined {
    const r = this.db.prepare('SELECT * FROM library_passages WHERE id = ?').get(id) as Row | undefined;
    return r ? toPassage(r) : undefined;
  }

  /** The whole read text of a document (for reading it once in a chat, or for learning). */
  text(docId: number, maxChars = 200_000): string {
    let out = '';
    let lastPlace = '';
    for (const p of this.db.prepare('SELECT place, text FROM library_passages WHERE doc_id = ? ORDER BY ord').iterate(docId) as Iterable<{ place: string; text: string }>) {
      // Overlap is carried into the next passage: drop the repeated start.
      const piece = p.place && p.place !== lastPlace ? `[${p.place}]\n${p.text}` : p.text;
      lastPlace = p.place;
      out += (out ? '\n\n' : '') + piece;
      if (out.length >= maxChars) return out.slice(0, maxChars);
    }
    return out;
  }

  counts(): { docs: number; passages: number; chars: number; bytes: number; reading: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS docs, coalesce(SUM(passages), 0) AS passages, coalesce(SUM(chars), 0) AS chars, coalesce(SUM(size), 0) AS bytes, coalesce(SUM(status IN ('waiting', 'reading')), 0) AS reading FROM library_docs WHERE keep = 1").get() as Record<string, number>;
    return { docs: Number(r.docs), passages: Number(r.passages), chars: Number(r.chars), bytes: Number(r.bytes), reading: Number(r.reading) };
  }

  /** Which documents a search may look in: her library, plus what was read once in this chat. */
  #scope(conversationId?: string, docIds?: number[]): { sql: string; args: (string | number)[] } {
    const parts = ['(d.keep = 1' + (conversationId ? ' OR d.conversation_id = ?' : '') + ')', "d.status = 'ready'"];
    const args: (string | number)[] = conversationId ? [conversationId] : [];
    if (docIds?.length) {
      parts.push(`d.id IN (${docIds.map(() => '?').join(',')})`);
      args.push(...docIds);
    }
    return { sql: parts.join(' AND '), args };
  }

  /** Passages with the words of the text (best first, by FTS5 rank). */
  searchWords(text: string, opts: { conversationId?: string; docIds?: number[]; limit?: number } = {}): { passage: Passage; rank: number }[] {
    const q = ftsQuery(text);
    if (!q) return [];
    const scope = this.#scope(opts.conversationId, opts.docIds);
    const rows = this.db
      .prepare(
        `SELECT p.*, bm25(library_fts, 1.0, 0.6) AS rank FROM library_fts JOIN library_passages p ON p.id = library_fts.rowid JOIN library_docs d ON d.id = p.doc_id WHERE library_fts MATCH ? AND ${scope.sql} ORDER BY rank LIMIT ?`,
      )
      .all(q, ...scope.args, opts.limit ?? 8) as Row[];
    return rows.map((r) => ({ passage: toPassage(r), rank: Number(r.rank) }));
  }

  /** Makes vectors for up to a batch of passages that don't have one for the current model. */
  async indexVectors(target: EmbedTarget | undefined, limit = VECTOR_BATCH): Promise<number> {
    if (!target) return 0;
    const todo = this.db
      .prepare(
        "SELECT p.id, p.text, p.heading FROM library_passages p JOIN library_docs d ON d.id = p.doc_id LEFT JOIN library_vectors v ON v.passage_id = p.id WHERE d.status = 'ready' AND (v.passage_id IS NULL OR v.model != ?) ORDER BY d.keep ASC, p.id LIMIT ?",
      )
      .all(target.model, limit) as { id: number; text: string; heading: string | null }[];
    if (!todo.length) return 0;
    try {
      const doc = (t: string) => (/nomic-embed/i.test(target.model) ? `search_document: ${t}` : t);
      const vecs = await embedTexts(target, todo.map((p) => doc(`${p.heading ? `${p.heading}\n` : ''}${p.text}`.slice(0, 6000))));
      const put = this.db.prepare('INSERT INTO library_vectors (passage_id, model, vec) VALUES (?, ?, ?) ON CONFLICT(passage_id) DO UPDATE SET model = excluded.model, vec = excluded.vec');
      this.db.exec('BEGIN');
      todo.forEach((p, i) => put.run(p.id, target.model, new Uint8Array(vecs[i].buffer)));
      this.db.exec('COMMIT');
      this.#vecCache = undefined;
      this.vectorError = undefined;
      return todo.length;
    } catch (err) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.vectorError = (err as Error).message;
      throw err;
    }
  }

  /** How many passages have a vector for the model (for the Library page). */
  vectorCount(model: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM library_vectors WHERE model = ?').get(model) as { n: number }).n;
  }

  #vectors(model: string): { id: number; vec: Float32Array }[] {
    if (this.#vecCache?.model === model) return this.#vecCache.rows;
    const rows = (this.db.prepare('SELECT passage_id, vec FROM library_vectors WHERE model = ?').all(model) as { passage_id: number; vec: Uint8Array }[]).map((r) => ({
      id: r.passage_id,
      vec: new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)),
    }));
    this.#vecCache = { model, rows };
    return rows;
  }

  /** Passages closest in meaning to the text (best first), above the floor. */
  async searchMeaning(target: EmbedTarget | undefined, text: string, opts: { conversationId?: string; docIds?: number[]; limit?: number; timeoutMs?: number } = {}): Promise<{ passage: Passage; score: number }[]> {
    if (!target || !text.trim()) return [];
    const rows = this.#vectors(target.model);
    if (!rows.length) return [];
    let q: Float32Array;
    try {
      const query = /nomic-embed/i.test(target.model) ? `search_query: ${text.slice(0, 2000)}` : /mxbai-embed/i.test(target.model) ? `Represent this sentence for searching relevant passages: ${text.slice(0, 2000)}` : text.slice(0, 2000);
      [q] = await embedTexts(target, [query], AbortSignal.timeout(opts.timeoutMs ?? 2500));
    } catch (err) {
      this.vectorError = (err as Error).message;
      return [];
    }
    const scope = this.#scope(opts.conversationId, opts.docIds);
    const allowed = new Set((this.db.prepare(`SELECT p.id FROM library_passages p JOIN library_docs d ON d.id = p.doc_id WHERE ${scope.sql}`).all(...scope.args) as { id: number }[]).map((r) => r.id));
    const scored = rows
      .filter((r) => allowed.has(r.id))
      .map((r) => ({ id: r.id, score: cosine(q, r.vec) }))
      .filter((r) => r.score >= PASSAGE_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 8);
    return scored.flatMap((s) => {
      const p = this.passage(s.id);
      return p ? [{ passage: p, score: s.score }] : [];
    });
  }

  /**
   * Finds passages by words and by meaning and merges them (reciprocal rank: a passage both ways
   * comes first). Each result names its document and place.
   */
  async find(text: string, opts: { target?: EmbedTarget; conversationId?: string; docIds?: number[]; limit?: number; timeoutMs?: number } = {}): Promise<PassageHit[]> {
    const limit = opts.limit ?? 5;
    const words = this.searchWords(text, { ...opts, limit: limit * 2 });
    const meaning = await this.searchMeaning(opts.target, text, { ...opts, limit: limit * 2 });
    const merged = new Map<number, { passage: Passage; score: number; by: PassageHit['by'] }>();
    words.forEach((w, i) => merged.set(w.passage.id, { passage: w.passage, score: 1 / (60 + i), by: 'words' }));
    meaning.forEach((m, i) => {
      const had = merged.get(m.passage.id);
      if (had) {
        had.score += 1 / (60 + i);
        had.by = 'both';
      } else merged.set(m.passage.id, { passage: m.passage, score: 1 / (60 + i), by: 'meaning' });
    });
    const docs = new Map<number, LibraryDoc | undefined>();
    const out: PassageHit[] = [];
    for (const h of [...merged.values()].sort((a, b) => b.score - a.score)) {
      if (!docs.has(h.passage.docId)) docs.set(h.passage.docId, this.get(h.passage.docId));
      const doc = docs.get(h.passage.docId);
      if (doc) out.push({ ...h, doc });
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** "your lease (page 4)": how she names where a passage came from. */
export function sourceLabel(doc: Pick<LibraryDoc, 'name' | 'title'>, place: string): string {
  const name = doc.title && doc.title.length < 80 ? doc.title : doc.name;
  return place ? `${name}, ${place}` : name;
}
