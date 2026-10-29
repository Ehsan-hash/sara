// Workspace path handling: every file tool path must stay inside the workspace directory,
// including through symlinks.
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ToolError } from './types.ts';

export const WORKSPACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function workspaceDir(dataDir: string, name: string): string {
  if (!WORKSPACE_NAME_RE.test(name)) throw new Error(`Invalid workspace name: ${name}`);
  const dir = resolve(dataDir, 'workspaces', name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return realpathSync(dir);
}

/** True when `p` is `root` or below it (plain path arithmetic; callers resolve links first). */
export function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves a user/model-supplied path inside `root`; throws if it escapes. Every part of the path
 * is checked without following links (lstat), and every link must lead inside the workspace, so a
 * link pointing outside (even one whose target doesn't exist yet) can't be written through.
 */
export function resolveInside(root: string, userPath: string): string {
  const cleaned = (userPath || '.').replace(/^\/+workspace(\/|$)/, '').replace(/^[/\\]+/, '');
  const target = resolve(root, cleaned);
  if (!inside(root, target)) throw new ToolError(`Path "${userPath}" is outside the workspace.`);
  let cur = root;
  for (const part of relative(root, target).split(sep)) {
    if (!part) continue;
    cur = join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      break; // doesn't exist yet: nothing below it can be a link
    }
    if (!st.isSymbolicLink()) continue;
    let real: string;
    try {
      real = realpathSync(cur);
    } catch {
      throw new ToolError(`Path "${userPath}" goes through a link that points nowhere.`);
    }
    if (!inside(root, real)) throw new ToolError(`Path "${userPath}" resolves outside the workspace.`);
  }
  return target;
}

/**
 * Files the file tools may not write or edit: git's own settings and hooks (they can make git run
 * commands, which would skip the approval the shell tool needs) and Sara's helper files.
 */
export function assertWritable(root: string, file: string): void {
  // Compared the way the file system will see them: case doesn't matter on Windows and macOS
  // (".GIT" is ".git"), Windows ignores trailing dots and spaces (".git."), and "GIT~1" is the
  // short name of ".git".
  const rel = relative(root, file)
    .split(/[\\/]/)
    .map((p) => p.replace(/[. ]+$/, '').toLowerCase());
  const bad = rel.some((p) => p === '.git' || /^git~\d+$/.test(p)) || (rel.length === 1 && /^(\.gitconfig|\.git-askpass.*|\.sara-task-.*)$/.test(rel[0])) || rel.at(-1) === '.gitmodules';
  if (bad) throw new ToolError('Git settings and hooks can only be changed with the shell tool or git commands (they need your OK).');
}

export function displayPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/') || '.';
}
