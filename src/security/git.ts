// Phase 81: the security pass's own small git helpers (read-only, plus the fix branch's worktree).
// Hardened like every git call of Sara's: no hooks, no fsmonitor, no pager, no external diff, no
// credential helper, no prompts, and never a network operation (nothing here fetches or pushes).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat', '-c', 'diff.external=', '-c', 'credential.helper=', '-c', 'core.untrackedCache=false', '-c', 'protocol.ext.allow=never', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];

/** Commands this module may run (a test asserts nothing else, and never `push`, is called). */
export const GIT_ALLOWED = new Set(['rev-parse', 'status', 'diff', 'show', 'worktree', 'add', 'commit', 'branch', 'ls-files', 'cat-file', 'symbolic-ref']);

/** Every git call made (subcommand + args), for tests that prove no push ever happens. */
export const gitLog: string[][] = [];

export function git(cwd: string, args: string[], opts: { timeout?: number; input?: string; name?: string } = {}): { status: number | null; out: string; err: string } {
  const sub = args[0];
  if (!GIT_ALLOWED.has(sub)) throw new Error(`git ${sub} is not allowed here`);
  gitLog.push([...args]);
  if (gitLog.length > 500) gitLog.splice(0, gitLog.length - 500);
  const name = opts.name || 'Sara';
  const r = spawnSync('git', [...GIT_SAFE, '-c', `user.name=${name}`, '-c', 'user.email=sara@localhost', ...args], {
    cwd,
    timeout: opts.timeout ?? 60_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    input: opts.input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: r.error ? null : r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
}

/** The workspace is the top of a git repository (its own `.git` folder) with at least one commit. */
export function repoState(ws: string): { repo: boolean; commit: boolean; branch?: string; head?: string } {
  try {
    if (!lstatSync(join(ws, '.git')).isDirectory()) return { repo: false, commit: false };
  } catch {
    return { repo: false, commit: false };
  }
  const head = git(ws, ['rev-parse', '--verify', '-q', 'HEAD']);
  const branch = git(ws, ['symbolic-ref', '-q', '--short', 'HEAD']);
  return { repo: true, commit: head.status === 0, ...(head.status === 0 ? { head: head.out.trim() } : {}), ...(branch.status === 0 ? { branch: branch.out.trim() } : {}) };
}

/** Uncommitted files (tracked changes and new, not ignored), forward slashes. */
export function dirtyFiles(ws: string): string[] {
  const st = git(ws, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (st.status !== 0) return [];
  const parts = st.out.split('\0');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    if (p[0] === 'D' || p[1] === 'D') {
      if (p[0] === 'R' || p[0] === 'C') i++;
      continue;
    }
    out.push(p.slice(3));
    if (p[0] === 'R' || p[0] === 'C') i++;
  }
  return out;
}

/** A short content hash (size + sha256) of a workspace file, or '' when missing. */
export function fileSig(ws: string, rel: string): string {
  try {
    const abs = join(ws, ...rel.split('/'));
    const st = statSync(abs);
    if (!st.isFile() || st.size > 4 * 1024 * 1024) return st.isFile() ? `big:${st.size}:${st.mtimeMs}` : '';
    return createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Lines added or changed since the last commit (1-based), per file, from `git diff -U0 HEAD`.
 * A new (untracked) file isn't listed: all its lines are new.
 */
export function changedLines(ws: string, files: string[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (!files.length) return out;
  const d = git(ws, ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', ...files.slice(0, 200)]);
  if (d.status !== 0) return out;
  let cur: Set<number> | undefined;
  for (const line of d.out.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      cur = new Set();
      out.set(f[1], cur);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) {
      const start = Number(h[1]);
      const n = h[2] === undefined ? 1 : Number(h[2]);
      for (let k = 0; k < n; k++) cur.add(start + k);
    }
  }
  return out;
}

/** The diff she reviews: tracked changes against HEAD plus new files in full (capped). */
export function reviewDiff(ws: string, files: string[], read: (rel: string) => string | undefined, cap = 30_000): string {
  const tracked = new Set(git(ws, ['ls-files', '-z', '--', ...files.slice(0, 200)]).out.split('\0').filter(Boolean));
  let out = '';
  const t = files.filter((f) => tracked.has(f));
  if (t.length) out += git(ws, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', ...t]).out;
  for (const f of files.filter((x) => !tracked.has(x))) {
    const text = read(f);
    if (text === undefined) continue;
    out += `\n--- /dev/null\n+++ b/${f} (new file)\n${text.split(/\r?\n/).map((l) => `+${l}`).join('\n')}\n`;
    if (out.length > cap) break;
  }
  return out.length > cap ? `${out.slice(0, cap)}\n[… diff cut at ${cap} characters]` : out;
}
