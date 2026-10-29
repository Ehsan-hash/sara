// Phase 74: where a document's bytes come from. Big PDFs (up to about 1 GB) are never loaded
// whole: the reader asks for the pieces it needs (the cross-reference table at the end, then each
// object by its offset), so memory stays small however large the file is. A small file already in
// memory uses the same interface. Both count what was read, so tests and measurements can check
// that a page was read without touching the rest of the file.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

export interface ReadStats {
  /** How many reads were made. */
  reads: number;
  /** Bytes read in total. */
  bytes: number;
  /** The largest single read. */
  maxRead: number;
}

export interface ByteSource {
  readonly size: number;
  readonly stats: ReadStats;
  /** Up to `len` bytes from `pos` (fewer at the end of the file). */
  read(pos: number, len: number): Buffer;
  close(): void;
}

const count = (s: ReadStats, n: number) => {
  s.reads++;
  s.bytes += n;
  if (n > s.maxRead) s.maxRead = n;
};

/** Bytes already in memory (small documents, tests). */
export class BufferSource implements ByteSource {
  readonly #b: Buffer;
  readonly size: number;
  readonly stats: ReadStats = { reads: 0, bytes: 0, maxRead: 0 };
  constructor(b: Buffer) {
    this.#b = b;
    this.size = b.length;
  }
  read(pos: number, len: number): Buffer {
    const start = Math.max(0, Math.min(this.size, Math.floor(pos)));
    const out = this.#b.subarray(start, Math.min(this.size, start + Math.max(0, Math.floor(len))));
    count(this.stats, out.length);
    return out;
  }
  close(): void {}
}

/** A file on disk, read piece by piece (never whole). */
export class FileSource implements ByteSource {
  readonly #fd: number;
  readonly size: number;
  readonly stats: ReadStats = { reads: 0, bytes: 0, maxRead: 0 };
  #closed = false;
  constructor(path: string) {
    this.#fd = openSync(path, 'r');
    this.size = fstatSync(this.#fd).size;
  }
  read(pos: number, len: number): Buffer {
    const start = Math.max(0, Math.min(this.size, Math.floor(pos)));
    const n = Math.max(0, Math.min(this.size - start, Math.floor(len)));
    const out = Buffer.allocUnsafe(n);
    let got = 0;
    while (got < n) {
      const r = readSync(this.#fd, out, got, n - got, start + got);
      if (r <= 0) break;
      got += r;
    }
    count(this.stats, got);
    return got === n ? out : out.subarray(0, got);
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.#fd);
  }
}
