// Phase 74: a big PDF is read in its own thread, one page per request. The thread keeps the
// file open (the cross-reference table and the page list are read once), and has its own memory
// limit; each page has a time limit. A strange page can only fail itself, and the server (chat
// included) keeps answering while a 1,000-page book is read.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { type OutlineItem, openPdfFile, type PageText, type PdfBook } from './pdf.ts';
import { ReadError } from './read.ts';
import type { FileSource, ReadStats } from './source.ts';

/** The reader thread's memory limit (MB); a small server can set less (SARA_LIBRARY_MEMORY_MB). */
export const PAGER_MEMORY_MB = Math.max(128, Number(process.env.SARA_LIBRARY_MEMORY_MB) || 768);
const PAGE_TIMEOUT_MS = 90_000;
const OPEN_TIMEOUT_MS = 5 * 60_000;

export interface PagerInfo {
  pages: number;
  title?: string;
  outline: OutlineItem[];
  bodySize: number;
  mode: 'xref' | 'scan';
  warnings: string[];
}

type Req = { id: number; op: 'open'; path: string; bodySize?: number } | { id: number; op: 'page'; i: number } | { id: number; op: 'image'; i: number } | { id: number; op: 'stats' };

if (!isMainThread && (workerData as { saraPager?: boolean } | null)?.saraPager) {
  let book: PdfBook | undefined;
  let src: FileSource | undefined;
  let body = 0;
  parentPort!.on('message', (m: Req) => {
    try {
      if (m.op === 'open') {
        ({ book, src } = openPdfFile(m.path));
        body = m.bodySize || book.bodySize();
        const info: PagerInfo = { pages: book.pageCount, ...(book.title ? { title: book.title } : {}), outline: book.outline(), bodySize: body, mode: book.doc.mode, warnings: book.warnings };
        return parentPort!.postMessage({ id: m.id, ok: true, value: info });
      }
      if (!book) throw new ReadError('The document is not open.');
      if (m.op === 'page') return parentPort!.postMessage({ id: m.id, ok: true, value: book.pageText(m.i, body) });
      if (m.op === 'image') {
        const im = book.pageImage(m.i);
        return parentPort!.postMessage({ id: m.id, ok: true, value: typeof im === 'string' ? { problem: im } : { mime: im.mime, data: im.data } });
      }
      if (m.op === 'stats') return parentPort!.postMessage({ id: m.id, ok: true, value: { stats: src?.stats, heap: process.memoryUsage().heapUsed } });
    } catch (err) {
      parentPort!.postMessage({ id: m.id, ok: false, message: (err as Error).message, readError: err instanceof ReadError });
    }
  });
}

/** One open PDF in its reader thread. */
export class Pager {
  readonly #w: Worker;
  #next = 1;
  #waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  #dead: Error | undefined;
  info: PagerInfo | undefined;

  private constructor(memoryMb: number) {
    this.#w = new Worker(new URL(import.meta.url), { workerData: { saraPager: true }, resourceLimits: { maxOldGenerationSizeMb: memoryMb }, execArgv: ['--disable-warning=ExperimentalWarning'] });
    this.#w.unref();
    this.#w.on('message', (r: { id: number; ok: boolean; value?: unknown; message?: string; readError?: boolean }) => {
      const w = this.#waiting.get(r.id);
      if (!w) return;
      this.#waiting.delete(r.id);
      clearTimeout(w.timer);
      if (r.ok) w.resolve(r.value);
      else w.reject(r.readError ? new ReadError(r.message ?? 'She couldn\'t read this page.') : new Error(r.message));
    });
    const fail = (err: Error) => {
      this.#dead = err;
      for (const [, w] of this.#waiting) {
        clearTimeout(w.timer);
        w.reject(err);
      }
      this.#waiting.clear();
    };
    this.#w.on('error', (err: Error & { code?: string }) => fail(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ReadError('This page needs more memory to read than she allows.') : new ReadError(`The reader stopped (${err.message}).`)));
    this.#w.on('exit', (code) => fail(new ReadError(`The reader stopped (code ${code}).`)));
  }

  static async open(path: string, opts: { memoryMb?: number; bodySize?: number } = {}): Promise<Pager> {
    const p = new Pager(opts.memoryMb ?? PAGER_MEMORY_MB);
    try {
      p.info = (await p.#ask({ op: 'open', path, ...(opts.bodySize ? { bodySize: opts.bodySize } : {}) }, OPEN_TIMEOUT_MS)) as PagerInfo;
    } catch (err) {
      void p.close();
      throw err;
    }
    return p;
  }

  get alive(): boolean {
    return !this.#dead;
  }

  #ask(req: { op: Req['op'] } & Record<string, unknown>, ms = PAGE_TIMEOUT_MS): Promise<unknown> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        // A page that runs too long: the thread is stopped (a new one opens for the next page).
        this.#dead = new ReadError('This page took too long to read.');
        void this.#w.terminate();
        reject(this.#dead);
      }, ms);
      this.#waiting.set(id, { resolve, reject, timer });
      this.#w.postMessage({ ...req, id });
    });
  }

  /** One page's text (0-based index). */
  page(i: number): Promise<PageText> {
    return this.#ask({ op: 'page', i }) as Promise<PageText>;
  }

  /** A scanned page's picture. */
  async image(i: number): Promise<{ mime: 'image/jpeg' | 'image/png'; data: Buffer } | { problem: string }> {
    const r = (await this.#ask({ op: 'image', i })) as { mime: 'image/jpeg' | 'image/png'; data: Uint8Array } | { problem: string };
    return 'problem' in r ? r : { mime: r.mime, data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
  }

  /** What the thread has read from the file so far, and its heap (for tests and measurements). */
  stats(): Promise<{ stats: ReadStats; heap: number }> {
    return this.#ask({ op: 'stats' }) as Promise<{ stats: ReadStats; heap: number }>;
  }

  async close(): Promise<void> {
    if (!this.#dead) this.#dead = new ReadError('The reader was closed.');
    await this.#w.terminate();
  }
}
