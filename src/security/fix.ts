// Phase 81 (harness track M6, §7 #5): the fix-branch loop. From one finding (or "Fix all high"):
//   1. a LOCAL branch `sara/fix-<id>` in its own git worktree under <data>/cache/fix-branches (the
//      owner's checked-out branch, index and files are never touched; uncommitted work is copied in
//      and committed on the fix branch as its base, so the fix sees what the owner sees);
//   2. the Coding model is asked to fix ONLY that finding: it answers with exact find/replace
//      edits to the finding's file, applied by code inside the worktree (no tools, no commands);
//   3. the finding's own rule runs again on the fixed file (the re-check is the proof), and the
//      project's tests, when they can be found, run in an M5 sandbox copy of the worktree;
//   4. the fix is committed on the branch and shown as a diff: Apply to my branch (only the fix's
//      files are written into the real workspace, never over a file that changed meanwhile), Keep
//      the branch (the worktree goes, the branch stays for later), or Discard (both go).
// Nothing is ever pushed: this module's git helper refuses every command but a short local list
// (src/security/git.ts), and pushing or opening a PR goes through the normal approval like always.
// The fix has its own token budget (the security pass's budget; M4 rule: no override, it stops).
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppContext } from '../chat.ts';
import { resolveChain } from '../chat.ts';
import { RunRecorder } from '../runs.ts';
import { runInSandbox } from '../sandbox-run.ts';
import type { Conversation } from '../store.ts';
import { resolveInside, workspaceDir } from '../tools/workspace.ts';
import { readWorkspaceText, type Finding, type FixState } from './findings.ts';
import { dirtyFiles, git, repoState } from './git.ts';
import { askModel, jsonIn, securitySettings, walkFiles } from './pass.ts';
import { checkFile, RULES, type RuleId } from './rules.ts';

/** Never copied into the fix worktree or written back by Apply. */
const NEVER = /(^|\/)(\.git|node_modules|\.venv|venv|__pycache__|target|dist|build)(\/|$)/;

export const branchName = (id: number) => `sara/fix-${id}`;

/** The project's own test command, read from its files (undefined when there is none). */
export function detectTests(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const t = pkg.scripts?.test;
    if (t && !/no test specified/.test(t)) return 'npm test';
  } catch {
    /* no package.json */
  }
  if (existsSync(join(dir, 'pytest.ini')) || existsSync(join(dir, 'conftest.py')) || (existsSync(join(dir, 'pyproject.toml')) && /\[tool\.pytest/.test(readFileSync(join(dir, 'pyproject.toml'), 'utf8'))) || walkFiles(dir, 2, 500).some((f) => /(^|\/)test_[\w-]+\.py$/.test(f))) return 'python -m pytest -q';
  if (existsSync(join(dir, 'Cargo.toml'))) return 'cargo test';
  if (existsSync(join(dir, 'go.mod'))) return 'go test ./...';
  return undefined;
}

/** The model's edits applied to one file's text: each `find` must be there exactly once. */
export function applyEdits(text: string, edits: { find: string; replace: string }[]): { text: string } | { error: string } {
  let out = text;
  // Models often write \n where the file has \r\n: match on the file's own line endings.
  const crlf = text.includes('\r\n');
  for (const e of edits) {
    let find = String(e.find ?? '');
    let rep = String(e.replace ?? '');
    if (crlf) {
      find = find.replace(/\r?\n/g, '\r\n');
      rep = rep.replace(/\r?\n/g, '\r\n');
    }
    if (!find.trim()) return { error: 'an edit had nothing to find' };
    const at = out.indexOf(find);
    if (at < 0) return { error: `this text isn't in the file: ${find.slice(0, 120)}` };
    if (out.indexOf(find, at + 1) >= 0) return { error: `this text is in the file more than once: ${find.slice(0, 120)}` };
    out = out.slice(0, at) + rep + out.slice(at + find.length);
  }
  return { text: out };
}

const FIX_SYSTEM = `You fix ONE security finding in ONE file. Change only what fixes it: no other refactoring, renaming, formatting or new features. Keep the code working and keep its behaviour for normal input.
Answer with JSON only: {"edits":[{"find":"exact text from the file (a few whole lines)","replace":"the new text"}],"note":"one sentence on what you changed"}
Each "find" must be copied exactly from the file and appear in it only once.`;

interface Work {
  promise: Promise<Finding | undefined>;
  dir: string;
}

export class FixBranches {
  readonly #app: AppContext;
  readonly #root: string;
  /** Fixes running now (by finding id). Tests await them. */
  readonly running = new Map<number, Work>();
  /** One fix at a time per space (each one is a model call plus a test run). */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(app: AppContext, cacheRoot: string) {
    this.#app = app;
    this.#root = cacheRoot;
  }

  #store() {
    const f = this.#app.findings;
    if (!f) throw new Error('Findings are not available here.');
    return f;
  }

  /** Where a finding's workspace is (the owner's workspaces folder). */
  #wsDir(f: Finding): string {
    if (!f.workspace) throw new Error('This finding has no workspace.');
    return workspaceDir(this.#app.rootDir ?? this.#app.dataDir, f.workspace);
  }

  /** Start-up: fixes that were running when the server stopped are marked failed (their worktrees were swept). */
  recover(): number {
    const store = this.#app.findings;
    if (!store) return 0;
    let n = 0;
    for (const f of store.list({ status: 'open', limit: 2000 })) {
      if (f.fix?.state !== 'working' && f.fix?.state !== 'ready') continue;
      try {
        const ws = this.#wsDir(f);
        git(ws, ['worktree', 'prune']);
        // A finished fix keeps its branch (as a kept fix); one cut short loses it.
        if (f.fix.state === 'working') git(ws, ['branch', '-D', f.fix.branch]);
      } catch {
        /* the workspace is gone */
      }
      store.setFix(f.id, { ...f.fix, state: f.fix.state === 'ready' ? 'kept' : 'failed', stage: undefined, ...(f.fix.state === 'working' ? { error: 'Interrupted by a restart.' } : {}), endedAt: new Date().toISOString() });
      n++;
    }
    return n;
  }

  /** Can this finding go through the fix loop? (A reason when it can't.) */
  why(f: Finding): string | undefined {
    if (f.status !== 'open') return 'Only open findings can be fixed.';
    if (f.source !== 'security' && f.source !== 'threat' && f.source !== 'redteam') return f.source === 'advisory' ? 'Dependency findings are fixed by upgrading the package (see the advice).' : 'This kind of finding has no code fix.';
    if (!f.file || !f.quote) return 'This finding names no file.';
    if (f.fix?.state === 'working' || f.fix?.state === 'ready') return 'A fix for this finding is already on its branch.';
    let ws: string;
    try {
      ws = this.#wsDir(f);
    } catch (err) {
      return (err as Error).message;
    }
    const r = repoState(ws);
    if (!r.repo) return 'The fix loop needs the workspace to be a git repository.';
    if (!r.commit) return 'The fix loop needs at least one commit in the repository.';
    return undefined;
  }

  /** Starts the loop for one finding (in the background); returns the finding with its fix state. */
  start(id: number, opts: { signal?: AbortSignal } = {}): Finding {
    const store = this.#store();
    const f = store.get(id);
    if (!f) throw new Error('Finding not found.');
    const no = this.why(f);
    if (no) throw new Error(no);
    const ws = this.#wsDir(f);
    // An old branch of the same name (a fix kept earlier): this one gets its own name.
    let branch = branchName(id);
    for (let n = 2; git(ws, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).status === 0; n++) branch = `${branchName(id)}-${n}`;
    const dir = join(this.#root, `${id}-${randomUUID().slice(0, 8)}`, 'ws');
    const state: FixState = { state: 'working', branch, startedAt: new Date().toISOString(), stage: 'making the branch' };
    const marked = store.setFix(id, state, branch)!;
    const promise = (this.#chain = this.#chain.then(() => this.#run(f, ws, dir, branch, opts.signal)).catch((err: Error) => {
      store.setFix(id, { ...(store.get(id)?.fix ?? state), state: 'failed', error: err.message.slice(0, 500), endedAt: new Date().toISOString(), stage: undefined });
      this.#cleanup(ws, dir, branch, true);
      return store.get(id);
    })) as Promise<Finding | undefined>;
    this.running.set(id, { promise, dir });
    void promise.finally(() => this.running.delete(id));
    return marked;
  }

  /** "Fix all high": every open, fixable finding of high (or block) severity in a workspace, one after another. */
  startAll(workspace: string, opts: { signal?: AbortSignal } = {}): { started: number[]; skipped: { id: number; why: string }[] } {
    const store = this.#store();
    const started: number[] = [];
    const skipped: { id: number; why: string }[] = [];
    for (const f of store.list({ workspace, status: 'open', minSeverity: 'high' })) {
      const no = this.why(f);
      if (no) {
        skipped.push({ id: f.id, why: no });
        continue;
      }
      this.start(f.id, opts);
      started.push(f.id);
    }
    return { started, skipped };
  }

  async #run(f: Finding, ws: string, dir: string, branch: string, outer?: AbortSignal): Promise<Finding | undefined> {
    const store = this.#store();
    const app = this.#app;
    const s = securitySettings(app.settings.get());
    const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(15 * 60_000)]) : AbortSignal.timeout(15 * 60_000);
    const stage = (st: string, extra: Partial<FixState> = {}) => store.setFix(f.id, { ...(store.get(f.id)!.fix as FixState), stage: st, ...extra });
    const name = app.persona.name && app.persona.name !== 'Sara' ? app.persona.name : 'Sara';
    // 1. The branch in its own worktree (the owner's branch and files stay as they are).
    mkdirSync(dirname(dir), { recursive: true });
    const add = git(ws, ['worktree', 'add', '-b', branch, dir, 'HEAD'], { timeout: 120_000 });
    if (add.status !== 0) throw new Error(`Could not make the fix branch: ${add.err.trim().slice(0, 300)}`);
    // The owner's uncommitted work (tracked changes and new files) is the fix's base.
    const dirty = dirtyFiles(ws).filter((p) => !NEVER.test(p));
    for (const rel of dirty) {
      const src = join(ws, ...rel.split('/'));
      try {
        if (lstatSync(src).isSymbolicLink() || !lstatSync(src).isFile()) continue;
      } catch {
        continue;
      }
      const dst = join(dir, ...rel.split('/'));
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    // Deleted files stay deleted on the base too.
    for (const rel of git(ws, ['ls-files', '--deleted', '-z']).out.split('\0').filter(Boolean)) rmSync(join(dir, ...rel.split('/')), { force: true });
    if (dirty.length) {
      git(dir, ['add', '-A', '--', '.'], { name });
      git(dir, ['commit', '-q', '--no-verify', '-m', `${name}: your uncommitted changes (base for fixing finding #${f.id})`], { name });
    }
    const baseSha = git(dir, ['rev-parse', 'HEAD']).out.trim();
    stage('asking the Coding model', { baseSha });
    // 2. The Coding model fixes only this finding, in the worktree (code applies its edits).
    const conv: Conversation = (f.conversationId ? app.store.getConversation(f.conversationId) : undefined) ?? { id: '', title: 'Fix', providerId: null, model: null, workspace: f.workspace ?? '', mode: 'coding', private: false, channel: 'web', channelKey: null, partner: null, projectId: null, archivedAt: null, tags: [], createdAt: '', updatedAt: '' };
    const rec = app.runs && conv.id ? new RunRecorder(app.runs, { kind: 'security', conversationId: conv.id, title: `Fix finding #${f.id}` }) : RunRecorder.none();
    let chain = resolveChain(app, conv, 'coding');
    if (rec.on) chain = chain.map((c) => ({ ...c, provider: rec.wrap(c.provider, 'security fix') }));
    const rule = f.rule as RuleId;
    const isCodeRule = Boolean(RULES[rule]);
    const count = (text: string) => (isCodeRule ? checkFile(f.file!, text, { only: [rule] }).length : text.includes(f.quote!) ? 1 : 0);
    const original = readFileSync(join(dir, ...f.file!.split('/')), 'utf8');
    const before = count(original);
    let attempts = 0;
    let feedback = '';
    let note = '';
    let fixedText: string | undefined;
    let after = before;
    let status: 'ok' | 'error' | 'budget' = 'ok';
    try {
      while (attempts < 2) {
        attempts++;
        const spent = rec.on ? rec.totals().tokens : 0;
        const lines = original.split(/\r?\n/);
        const from = lines.length > 400 ? Math.max(0, (f.line ?? 1) - 80) : 0;
        const to = lines.length > 400 ? Math.min(lines.length, (f.line ?? 1) + 80) : lines.length;
        const shown = lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`).join('\n');
        const user = `Finding #${f.id} (${f.rule}): ${f.title}\nFile: ${f.file}, line ${f.line}\nThe line: ${f.quote}\nHow to fix: ${f.advice}\n${feedback ? `\nYour last try didn't fix it: ${feedback}\n` : ''}\nThe file${from || to < lines.length ? ` (lines ${from + 1}-${to})` : ''}, with line numbers (not part of the code):\n${shown}`;
        const prompt = Math.ceil((FIX_SYSTEM.length + user.length) / 3.5);
        const room = s.budgetTokens - spent - prompt;
        if (room < 300) {
          status = 'budget';
          feedback = feedback || 'the fix budget ran out';
          break;
        }
        rec.startStep({ label: `Fix try ${attempts}` });
        const { text } = await askModel(chain, [{ role: 'system', content: FIX_SYSTEM }, { role: 'user', content: user }], Math.min(2500, room), signal);
        const j = jsonIn(text) as { edits?: { find: string; replace: string }[]; note?: string } | undefined;
        const edits = Array.isArray(j?.edits) ? j!.edits.filter((e) => e && typeof e === 'object').slice(0, 10) : [];
        if (!edits.length) {
          feedback = 'the answer had no edits';
          continue;
        }
        const r = applyEdits(original, edits);
        if ('error' in r) {
          feedback = r.error;
          continue;
        }
        const n = count(r.text);
        if (n >= before && before > 0) {
          feedback = `the check still finds the problem (${n} time${n === 1 ? '' : 's'})`;
          after = n;
          continue;
        }
        fixedText = r.text;
        after = n;
        note = String(j?.note ?? '').slice(0, 300);
        break;
      }
    } finally {
      rec.close(status === 'budget' ? 'budget' : 'ok');
    }
    const tokens = rec.on ? rec.totals().tokens : 0;
    if (fixedText === undefined) {
      this.#cleanup(ws, dir, branch, true);
      return store.setFix(f.id, { ...(store.get(f.id)!.fix as FixState), state: 'failed', stage: undefined, attempts, tokens, error: status === 'budget' ? 'Stopped: the fix budget ran out.' : `No working fix: ${feedback}.`, recheck: { fixed: false, before, after, remaining: [] }, endedAt: new Date().toISOString(), ...(rec.on ? { runId: rec.id } : {}) });
    }
    writeFileSync(join(dir, ...f.file!.split('/')), fixedText);
    // 3. The re-check (only this finding's rule) and the project's tests in a sandbox copy.
    const remaining = isCodeRule ? checkFile(f.file!, fixedText, { only: [rule] }).map((x) => ({ line: x.line ?? 0, quote: x.quote ?? '' })) : [];
    const recheck = { fixed: after < before || before === 0, before, after, remaining };
    stage('running the tests', { recheck, attempts, tokens, note });
    let tests: FixState['tests'] = null;
    const cmd = s.runTests ? detectTests(dir) : undefined;
    const gate = app.sandboxGate;
    if (cmd && gate) {
      const iso = gate.isolation();
      const g = gate.settings();
      try {
        const r = await runInSandbox(dir, cmd, { cacheDir: gate.cacheDir, base: app.sandbox, isolation: iso, network: false, timeoutMs: g.timeLimitS * 1000, signal, maxBytes: g.maxMB * 1048576, keep: false, dockerImage: g.dockerImage, preferWorktree: false });
        const out = r.run?.output ?? r.notRun ?? '';
        tests = { command: cmd, ran: Boolean(r.run), exitCode: r.run?.exitCode ?? null, timedOut: r.run?.timedOut ?? false, ms: r.run?.ms ?? 0, output: out.length > 3000 ? `…${out.slice(-3000)}` : out, isolated: iso.isolated, label: iso.label, ...(r.notRun ? { note: r.notRun } : {}) };
      } catch (err) {
        tests = { command: cmd, ran: false, exitCode: null, timedOut: false, ms: 0, output: '', isolated: false, label: '', note: (err as Error).message.slice(0, 300) };
      }
    } else if (cmd) tests = { command: cmd, ran: false, exitCode: null, timedOut: false, ms: 0, output: '', isolated: false, label: '', note: 'No sandbox here to run the tests in.' };
    // 4. Committed on the fix branch (local only), shown as a diff.
    git(dir, ['add', '--', f.file!], { name });
    git(dir, ['commit', '-q', '--no-verify', '-m', `${name}: fix finding #${f.id}: ${f.title}`.slice(0, 200)], { name });
    const fixSha = git(dir, ['rev-parse', 'HEAD']).out.trim();
    const diff = git(dir, ['diff', '--no-color', '--no-ext-diff', baseSha, fixSha]).out;
    const files = git(dir, ['diff', '--name-only', baseSha, fixSha]).out.split('\n').map((x) => x.trim()).filter(Boolean);
    return store.setFix(f.id, { ...(store.get(f.id)!.fix as FixState), state: 'ready', stage: undefined, baseSha, fixSha, recheck, tests, diff: diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n[… cut]` : diff, files, attempts, tokens, note, endedAt: new Date().toISOString(), ...(rec.on ? { runId: rec.id } : {}) });
  }

  /** Apply to my branch: only the fix's files, never over a file that changed since the fix started. */
  apply(id: number): Finding {
    const store = this.#store();
    const f = store.get(id);
    if (!f?.fix || f.fix.state !== 'ready' || !f.fix.baseSha || !f.fix.fixSha) throw new Error('There is no finished fix to apply.');
    const ws = this.#wsDir(f);
    const dir = this.#dirOf(f);
    const written: string[] = [];
    const conflicts: string[] = [];
    for (const rel of f.fix.files ?? []) {
      if (NEVER.test(rel)) {
        conflicts.push(rel);
        continue;
      }
      const real = resolveInside(ws, rel);
      // The real file must still be exactly what the fix started from.
      const base = git(dir ?? ws, ['show', `${f.fix.baseSha}:${rel}`]);
      const now = readWorkspaceText(ws, rel);
      const fixed = git(dir ?? ws, ['show', `${f.fix.fixSha}:${rel}`]);
      if (base.status !== 0 || fixed.status !== 0 || now === undefined || now !== base.out) {
        conflicts.push(rel);
        continue;
      }
      try {
        if (lstatSync(real).isSymbolicLink()) {
          conflicts.push(rel);
          continue;
        }
      } catch {
        /* new file */
      }
      writeFileSync(real, fixed.out);
      written.push(rel);
    }
    if (!written.length) {
      store.setFix(id, { ...f.fix, applied: { written, conflicts } });
      throw new Error(`Nothing applied: ${conflicts.join(', ')} changed since the fix started. Keep the branch and merge it yourself, or discard it.`);
    }
    // Applied: the branch and its worktree go (the change is in your files now, uncommitted).
    this.#cleanup(ws, dir, f.fix.branch, true);
    store.setFix(id, { ...f.fix, state: 'applied', applied: { written, conflicts }, endedAt: new Date().toISOString() });
    return store.setStatus(id, 'fixed', 'Fixed on a branch and applied to your files')!;
  }

  /** Keep the branch: the worktree goes, the local branch stays (merge it when you like). */
  keep(id: number): Finding {
    const store = this.#store();
    const f = store.get(id);
    if (!f?.fix || f.fix.state !== 'ready') throw new Error('There is no finished fix to keep.');
    this.#cleanup(this.#wsDir(f), this.#dirOf(f), f.fix.branch, false);
    return store.setFix(id, { ...f.fix, state: 'kept', endedAt: new Date().toISOString() })!;
  }

  /** Discard: the worktree and the branch go; the finding stays open. */
  discard(id: number): Finding {
    const store = this.#store();
    const f = store.get(id);
    if (!f?.fix || (f.fix.state !== 'ready' && f.fix.state !== 'failed' && f.fix.state !== 'kept')) throw new Error('There is no fix to discard.');
    this.#cleanup(this.#wsDir(f), this.#dirOf(f), f.fix.branch, true);
    return store.setFix(id, { ...f.fix, state: 'discarded', endedAt: new Date().toISOString() }, null)!;
  }

  /** The worktree folder of a finding's fix (from git's own list). */
  #dirOf(f: Finding): string | undefined {
    if (!f.fix) return undefined;
    const ws = this.#wsDir(f);
    const list = git(ws, ['worktree', 'list', '--porcelain']).out.split('\n\n');
    for (const block of list) {
      const path = /^worktree (.+)$/m.exec(block)?.[1];
      const br = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      if (path && br === f.fix.branch) return path;
    }
    return undefined;
  }

  #cleanup(ws: string, dir: string | undefined, branch: string, dropBranch: boolean): void {
    if (dir && existsSync(dir)) {
      git(ws, ['worktree', 'remove', '--force', dir], { timeout: 60_000 });
      try {
        rmSync(dirname(dir), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* Windows: a file still held; swept at start-up */
      }
    }
    git(ws, ['worktree', 'prune']);
    if (dropBranch) git(ws, ['branch', '-D', branch]);
  }
}

/** Start-up: fix worktrees left by a restart go (their branches stay, as kept fixes). */
export function sweepFixDirs(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* in use */
  }
}
