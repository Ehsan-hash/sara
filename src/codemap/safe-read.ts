// Reading a workspace file for the code map without following links (THREAT_MODEL §5: a link that
// points outside the workspace is refused). A hostile repo can ship `README.md -> ../../owner.json`;
// the code tools run with no approval, so they must never read through a link.
//
// The checks, in order: lstat says a plain file (not a link); open with O_NOFOLLOW where the system
// has it; fstat of the open descriptor is the same file lstat saw (closes the lstat→open race); the
// real path stays inside the workspace's real path. Any failure reads as "no file".
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { inside } from '../tools/workspace.ts';

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

const realRoots = new Map<string, string>();
function realRoot(root: string): string {
  let r = realRoots.get(root);
  if (r === undefined) {
    r = realpathSync.native(root);
    if (realRoots.size > 200) realRoots.clear();
    realRoots.set(root, r);
  }
  return r;
}

/**
 * Reads up to `maxBytes` of `root/rel` (a plain file inside the workspace), or returns null when it is
 * missing, a link, a folder, bigger than `maxSize`, or resolves outside the workspace.
 */
export function readInsideNoFollow(root: string, abs: string, maxBytes = 2_000_000, maxSize = Infinity): Buffer | null {
  let fd: number | undefined;
  try {
    const target = resolve(abs);
    const pre = lstatSync(target);
    if (!pre.isFile() || pre.size > maxSize) return null;
    const rootReal = realRoot(root);
    // Every part of the path must stay inside: a linked parent folder is refused too.
    const real = realpathSync.native(target);
    if (!inside(rootReal, real)) return null;
    fd = openSync(target, constants.O_RDONLY | NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.ino !== pre.ino || st.dev !== pre.dev || st.size > maxSize) return null;
    // Re-check after opening: the path may have been swapped between the checks above.
    if (!inside(rootReal, realpathSync.native(target))) return null;
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = readSync(fd, buf, off, len - off, off);
      if (n <= 0) break;
      off += n;
    }
    return off === len ? buf : buf.subarray(0, off);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Text version of readInsideNoFollow ('' when refused). */
export function readTextInside(root: string, abs: string, maxChars = 20_000, maxSize = 2_000_000): string {
  const b = readInsideNoFollow(root, abs, maxChars * 4, maxSize);
  return b ? b.toString('utf8').slice(0, maxChars) : '';
}

/** True when `abs` is a plain file (not a link) inside the workspace. */
export function isPlainFileInside(root: string, abs: string): boolean {
  try {
    const target = resolve(abs);
    if (!lstatSync(target).isFile()) return false;
    return inside(realRoot(root), realpathSync.native(target));
  } catch {
    return false;
  }
}
