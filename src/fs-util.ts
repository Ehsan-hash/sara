// Small file helpers shared by the stores.
//
// writeFileAtomic: a crash or power loss mid-write must never leave a torn file (a truncated
// owner.json would stop the server from starting). The data goes to a temp file in the same
// folder, is flushed to disk, and is then renamed over the target in one step.

import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** Windows can briefly refuse a rename while an indexer or antivirus has the file open. */
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Write `data` to `path` so readers see either the old file or the whole new one.
 * `mode` applies when the file is created (default 0o600: owner-only). Use 0o666 for
 * files that were written with Node's default mode before (umask still applies).
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): void {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w', mode);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    try { fsyncSync(fd); } catch { /* some file systems refuse fsync; the rename still helps */ }
  } catch (err) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw err;
  }
  closeSync(fd);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt < 8 && RETRY_CODES.has(code)) { pause(25 * (attempt + 1)); continue; }
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}
