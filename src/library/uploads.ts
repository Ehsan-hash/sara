// Phase 74: documents up to about 1 GB arrive streamed to disk, never held in memory. Two ways:
//  - one request whose body is the file (small files, and big ones on a direct connection), piped
//    to a temporary file with a size cap;
//  - a resumable upload in pieces (8 MB each by default) with an upload id and an offset, for big
//    files through proxies that limit a request's size (nginx's client_max_body_size) or
//    connections that drop: a piece that didn't arrive is sent again from the offset the server
//    reports. Unfinished uploads are removed after a day.
import { randomBytes } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { writeFileAtomic } from '../fs-util.ts';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

/** The size of one piece of a resumable upload (the app sends this much per request). */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** A piece may be at most this big (a client may pick smaller pieces). */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const STALE_MS = 24 * 3600_000;

export class LibraryUploadError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export interface UploadMeta {
  id: string;
  name: string;
  size: number;
  keep: boolean;
  conversationId: string | null;
  learn: boolean;
  createdAt: string;
}

const ID = /^[a-f0-9]{24}$/;

/** Is there room on the disk for a file this big (plus a margin)? */
export function diskHasRoom(dir: string, bytes: number): boolean {
  try {
    const st = statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize) > bytes * 1.05 + 64 * 1024 * 1024;
  } catch {
    return true; // can't tell: let the write itself fail if it must
  }
}

/** Streams a request body into a file, stopping (and removing the file) past `max` bytes. */
export async function bodyToFile(req: IncomingMessage, path: string, max: number, flags: 'w' | 'a' = 'w'): Promise<number> {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new LibraryUploadError(413, 'Request body too large');
  const out = createWriteStream(path, { flags, mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max) throw new LibraryUploadError(413, 'Request body too large');
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', r));
    }
  } catch (err) {
    out.destroy();
    throw err;
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  return size;
}

/** Uploads in progress (in <data>/library/incoming). */
export class LibraryUploads {
  readonly dir: string;
  readonly #now: () => Date;

  constructor(libraryDir: string, now: () => Date = () => new Date()) {
    this.dir = join(libraryDir, 'incoming');
    this.#now = now;
  }

  #ensure(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  #part(id: string): string {
    return join(this.dir, `${id}.part`);
  }

  #metaPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** A temporary file for a one-request upload. */
  tempPath(): string {
    this.#ensure();
    return join(this.dir, `${randomBytes(12).toString('hex')}.tmp`);
  }

  /** Removes uploads nobody finished within a day. */
  sweep(): void {
    if (!existsSync(this.dir)) return;
    const now = this.#now().getTime();
    for (const f of readdirSync(this.dir)) {
      try {
        if (now - statSync(join(this.dir, f)).mtimeMs > STALE_MS) rmSync(join(this.dir, f), { force: true });
      } catch {
        /* gone already */
      }
    }
  }

  start(m: Omit<UploadMeta, 'id' | 'createdAt'>, max: number): UploadMeta & { received: number; chunkBytes: number } {
    if (!Number.isSafeInteger(m.size) || m.size <= 0) throw new LibraryUploadError(400, 'Say how big the file is.');
    if (m.size > max) throw new LibraryUploadError(413, 'Documents can be up to {mb} MB here.', { params: { mb: Math.round(max / 1048576) } });
    this.sweep();
    this.#ensure();
    if (!diskHasRoom(this.dir, m.size * 2)) throw new LibraryUploadError(507, 'There is not enough free disk space on the server for this file.');
    const meta: UploadMeta = { ...m, id: randomBytes(12).toString('hex'), createdAt: this.#now().toISOString() };
    writeFileAtomic(this.#metaPath(meta.id), JSON.stringify(meta), 0o600);
    writeFileSync(this.#part(meta.id), Buffer.alloc(0), { mode: 0o600 });
    return { ...meta, received: 0, chunkBytes: CHUNK_BYTES };
  }

  get(id: string): (UploadMeta & { received: number }) | undefined {
    if (!ID.test(id) || !existsSync(this.#metaPath(id)) || !existsSync(this.#part(id))) return undefined;
    try {
      const meta = JSON.parse(readFileSync(this.#metaPath(id), 'utf8')) as UploadMeta;
      return { ...meta, received: statSync(this.#part(id)).size };
    } catch {
      return undefined;
    }
  }

  /**
   * Adds one piece at `offset`. A piece for the wrong offset is refused with the offset the server
   * has (409), so the app sends again from there.
   */
  async append(id: string, offset: number, req: IncomingMessage): Promise<number> {
    const u = this.get(id);
    if (!u) throw new LibraryUploadError(404, 'That upload is not here any more. Add the file again.');
    if (offset !== u.received) throw new LibraryUploadError(409, 'That piece is for another place in the file.', { received: u.received });
    const room = Math.min(MAX_CHUNK_BYTES, u.size - u.received);
    try {
      await bodyToFile(req, this.#part(id), room, 'a');
    } catch (err) {
      // A piece that broke off or was too big: cut the file back to where the piece started.
      const fd = openSync(this.#part(id), 'r+');
      try {
        ftruncateSync(fd, offset);
      } finally {
        closeSync(fd);
      }
      throw err instanceof LibraryUploadError ? err : new LibraryUploadError(400, 'That piece did not arrive whole. Send it again.', { received: offset });
    }
    return statSync(this.#part(id)).size;
  }

  /** The whole file arrived: hands its path over (the caller moves it into the library). */
  finish(id: string): { meta: UploadMeta; path: string } {
    const u = this.get(id);
    if (!u) throw new LibraryUploadError(404, 'That upload is not here any more. Add the file again.');
    if (u.received !== u.size) throw new LibraryUploadError(409, 'Not all of the file has arrived yet.', { received: u.received });
    rmSync(this.#metaPath(id), { force: true });
    const { received: _r, ...meta } = u;
    return { meta, path: this.#part(id) };
  }

  abort(id: string): boolean {
    if (!ID.test(id)) return false;
    const had = existsSync(this.#part(id));
    rmSync(this.#part(id), { force: true });
    rmSync(this.#metaPath(id), { force: true });
    return had;
  }
}
