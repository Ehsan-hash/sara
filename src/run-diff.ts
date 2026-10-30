// Phase 83 (harness track M8, docs/design/HARNESS_TRACK.md §3 M8): comparing two runs of the same
// turn, side by side: an original and a branch made from one of its steps, or two branches. Steps
// are lined up by their index (a branch's steps go on from the step it was made from; the steps
// before come from its parent, recursively), with model, tokens, cost, tool calls and their
// results, memory picks; then the files each changed, the final answers word by word, and one
// summary in numbers (the page writes the sentence in the app's language).
//
// Pure code, no model call. `diffTokens` is Myers' O((N+M)D) shortest edit script, capped so a
// long answer or file can't hold the server up (over the cap: the rest is one replaced block).
import type { RunMessage, RunStore, RunView, StepView, ToolStep, WorkspaceRef } from './runs.ts';
import type { StoredMessage } from './store.ts';

export type DiffOp = { t: '=' | '+' | '-'; s: string };

/** Shortest edit script between two token lists (Myers). Over `maxD` edits: what's left is one -/+ pair. */
export function diffTokens(a: readonly string[], b: readonly string[], maxD = 2000): DiffOp[] {
  // Common start and end first (the usual case: small edits in a long text).
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const ops: DiffOp[] = [];
  const push = (t: DiffOp['t'], s: string) => {
    const last = ops.at(-1);
    if (last && last.t === t) last.s += s;
    else ops.push({ t, s });
  };
  if (pre) push('=', a.slice(0, pre).join(''));
  const n = A.length;
  const m = B.length;
  if (n === 0 || m === 0) {
    if (n) push('-', A.join(''));
    if (m) push('+', B.join(''));
  } else {
    const max = Math.min(n + m, maxD);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
    }
    if (found < 0) {
      // Too many edits: one replaced block (still correct, just not minimal).
      push('-', A.join(''));
      push('+', B.join(''));
    } else {
      const rev: DiffOp[] = [];
      let x = n;
      let y = m;
      for (let d = found; d > 0; d--) {
        const vv = trace[d];
        const k = x - y;
        const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
        const px = vv[off + prevK];
        const py = px - prevK;
        while (x > px && y > py) {
          x--;
          y--;
          rev.push({ t: '=', s: A[x] });
        }
        if (x === px) rev.push({ t: '+', s: B[--y] });
        else rev.push({ t: '-', s: A[--x] });
      }
      while (x > 0 && y > 0) {
        x--;
        y--;
        rev.push({ t: '=', s: A[x] });
      }
      for (let i = rev.length - 1; i >= 0; i--) push(rev[i].t, rev[i].s);
    }
  }
  if (suf) push('=', a.slice(a.length - suf).join(''));
  return ops;
}

/** Words and the spaces between them (so the parts join back into the text). */
export const wordsOf = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? [];

/** A word diff of two answers (capped at 6,000 words each). */
export function diffWords(a: string, b: string): DiffOp[] {
  return diffTokens(wordsOf(a).slice(0, 6000), wordsOf(b).slice(0, 6000));
}

/** A unified diff of two texts (line endings ignored), clipped to `maxChars`. Empty when equal. */
export function unifiedDiff(path: string, before: string, after: string, opts: { context?: number; maxChars?: number } = {}): string {
  const ctx = opts.context ?? 3;
  const norm = (s: string) => s.replace(/\r\n/g, '\n');
  const a = norm(before).split('\n');
  const b = norm(after).split('\n');
  const ops = diffTokens(a.slice(0, 20_000).map((l) => `${l}\n`), b.slice(0, 20_000).map((l) => `${l}\n`));
  // Back to lines with their kind.
  const lines: { t: DiffOp['t']; l: string }[] = [];
  for (const o of ops) for (const l of o.s.split('\n').slice(0, -1)) lines.push({ t: o.t, l });
  if (!lines.some((x) => x.t !== '=')) return '';
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  let ai = 1;
  let bi = 1;
  const cnt = (from: number, to: number, kind: 'a' | 'b') => lines.slice(from, to).filter((x) => x.t === '=' || x.t === (kind === 'a' ? '-' : '+')).length;
  while (i < lines.length) {
    if (lines[i].t === '=') {
      ai++;
      bi++;
      i++;
      continue;
    }
    // A hunk: context before, the changes (joined while gaps are short), context after.
    const start = Math.max(0, i - ctx);
    let end = i;
    for (;;) {
      while (end < lines.length && lines[end].t !== '=') end++;
      let gap = end;
      while (gap < lines.length && lines[gap].t === '=' && gap - end < ctx * 2) gap++;
      if (gap < lines.length && lines[gap].t !== '=' && gap - end < ctx * 2) end = gap;
      else break;
    }
    const stop = Math.min(lines.length, end + ctx);
    const back = i - start;
    const aStart = ai - back;
    const bStart = bi - back;
    out.push(`@@ -${aStart},${cnt(start, stop, 'a')} +${bStart},${cnt(start, stop, 'b')} @@`);
    for (let j = start; j < stop; j++) {
      const x = lines[j];
      out.push(`${x.t === '=' ? ' ' : x.t}${x.l}`);
      if (j >= i) {
        if (x.t !== '+') ai++;
        if (x.t !== '-') bi++;
      }
    }
    i = stop;
  }
  const text = out.join('\n');
  const max = opts.maxChars ?? 8000;
  return text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more characters]` : text;
}

// ------------------------------------------------------------------------------------------------
// Two runs side by side
// ------------------------------------------------------------------------------------------------

export interface StepSide {
  /** The run this step was recorded in (a branch shows its parent's steps before the branch point). */
  runId: number;
  idx: number;
  model: string | null;
  provider: string | null;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  costUnknown: boolean;
  ms: number;
  stopped: string | null;
  memory: number[];
  tools: { name: string; summary: string; args: Record<string, unknown>; status: ToolStep['status']; output: string; approval?: string }[];
}

export interface FileSide {
  /** added / changed / removed relative to where the two runs part, or unchanged. */
  change: 'added' | 'changed' | 'removed' | 'unchanged';
  /** sha256 (16 hex) of the file at the end, when known. */
  sha?: string;
  /** The branch's own diff (from its workspace copy). */
  diff?: string;
}

export interface RunDiff {
  a: { run: RunView; label: 'original' | 'branch' };
  b: { run: RunView; label: 'original' | 'branch' };
  /** Steps both runs share (they part at this index). */
  sharedUntil: number;
  steps: { idx: number; shared: boolean; a?: StepSide; b?: StepSide; same: boolean }[];
  files: { path: string; a: FileSide; b: FileSide; same: boolean }[];
  /** The files of a run that isn't a branch are known from its git manifests (hashes only). */
  filesNote?: string;
  answer: { a: string; b: string; ops: DiffOp[]; same: boolean };
  memory: { a: number[]; b: number[]; onlyA: number[]; onlyB: number[] };
  summary: { stepsA: number; stepsB: number; tokensA: number; tokensB: number; usdA: number; usdB: number; costUnknown: boolean; toolsA: number; toolsB: number; filesDiffer: string[]; sameAnswer: boolean };
}

/** Every step of a run as the owner saw the turn: a branch's parent steps before its branch point, then its own. */
export function fullSteps(runs: RunStore, run: RunView, depth = 0): (StepView & { runId: number })[] {
  const own = runs.steps(run.id).map((s) => ({ ...s, runId: run.id }));
  if (!run.parentRunId || run.branchedFromStep === null || depth > 20) return own;
  const parent = runs.get(run.parentRunId);
  if (!parent) return own;
  return [...fullSteps(runs, parent, depth + 1).filter((s) => s.idx < run.branchedFromStep!), ...own];
}

const side = (s: StepView & { runId: number }): StepSide => ({
  runId: s.runId,
  idx: s.idx,
  model: s.model,
  provider: s.provider,
  tokensIn: s.tokensIn,
  tokensOut: s.tokensOut,
  usd: s.usd,
  costUnknown: s.unpriced + s.unreported > 0,
  ms: s.ms,
  stopped: s.stopped,
  memory: (s.memoryPicks as { id?: number }[]).map((p) => Number(p.id)).filter(Number.isFinite),
  tools: s.tools.map((t) => ({ name: t.name, summary: t.summary, args: t.args, status: t.status, output: t.output.length > 1500 ? `${t.output.slice(0, 1500)}…` : t.output, ...(t.approval ? { approval: t.approval } : {}) })),
});

/** The latest manifest at or before a step (coding runs record one after steps that change files). */
export function refBefore(steps: StepView[], idx: number): WorkspaceRef | null {
  let ref: WorkspaceRef | null = null;
  for (const s of steps) if (s.idx <= idx && s.workspaceRef) ref = s.workspaceRef;
  return ref;
}

type FileState = Map<string, FileSide>;

/** A run's files from the branch point on: a branch's own record, else its git manifests. */
function filesOf(runs: RunStore, run: RunView, steps: (StepView & { runId: number })[], from: number): { files: FileState; hashOnly: boolean } {
  const branchFiles = run.branch?.files as { path: string; change: FileSide['change']; sha?: string; diff?: string }[] | undefined;
  if (Array.isArray(branchFiles)) {
    const own: FileState = new Map(branchFiles.map((f) => [f.path, { change: f.change, ...(f.sha ? { sha: f.sha } : {}), ...(f.diff ? { diff: f.diff } : {}) }]));
    return { files: own, hashOnly: false };
  }
  const startRef = from > 0 ? refBefore(steps, from - 1) : (steps.find((s) => s.idx === 0)?.workspaceRef ?? null);
  const endRef = [...steps].reverse().find((s) => s.workspaceRef)?.workspaceRef ?? null;
  const out: FileState = new Map();
  if (!endRef) return { files: out, hashOnly: true };
  const before = new Map((startRef?.dirty ?? []).map((d) => [d.path, d]));
  const after = new Map((endRef.dirty ?? []).map((d) => [d.path, d]));
  for (const [p, d] of after) {
    const b = before.get(p);
    if (b && b.sha === d.sha && Boolean(b.gone) === Boolean(d.gone)) continue;
    out.set(p, { change: d.gone ? 'removed' : b ? 'changed' : 'changed', ...(d.sha ? { sha: d.sha } : {}) });
  }
  for (const [p] of before) if (!after.has(p)) out.set(p, { change: 'changed' });
  for (const s of steps) if (s.idx >= from) for (const f of s.files) if (!out.has(f)) out.set(f, { change: 'changed' });
  void runs;
  return { files: out, hashOnly: true };
}

/** The run's final answer (her last message with words and no tool calls). */
export function finalAnswer(run: RunView, store: { messageById(id: number): StoredMessage | undefined }, runMessages: (id: number) => RunMessage[]): string {
  if (run.parentRunId) {
    const msgs = runMessages(run.id).filter((m) => m.role === 'assistant' && m.content.trim() && !(m.meta?.toolCalls as unknown[] | undefined)?.length);
    return msgs.at(-1)?.content ?? '';
  }
  return run.replyMessageId ? (store.messageById(run.replyMessageId)?.content ?? '') : '';
}

/** Two runs of one conversation, side by side. */
export function diffRuns(runs: RunStore, store: { messageById(id: number): StoredMessage | undefined }, a: RunView, b: RunView): RunDiff {
  const sa = fullSteps(runs, a);
  const sb = fullSteps(runs, b);
  // Where they part: the first index whose step isn't the very same recorded step in both.
  let sharedUntil = 0;
  while (sharedUntil < sa.length && sharedUntil < sb.length && sa[sharedUntil].runId === sb[sharedUntil].runId && sa[sharedUntil].idx === sb[sharedUntil].idx) sharedUntil++;
  const ids = [...new Set([...sa.map((s) => s.idx), ...sb.map((s) => s.idx)])].sort((x, y) => x - y);
  const steps = ids.map((idx) => {
    const x = sa.find((s) => s.idx === idx);
    const y = sb.find((s) => s.idx === idx);
    const shared = idx < sharedUntil;
    const A = x ? side(x) : undefined;
    const B = y ? side(y) : undefined;
    const same = Boolean(A && B && A.model === B.model && JSON.stringify(A.tools.map((t) => [t.name, t.args, t.status, t.output])) === JSON.stringify(B.tools.map((t) => [t.name, t.args, t.status, t.output])));
    return { idx, shared, ...(A ? { a: A } : {}), ...(B && !shared ? { b: B } : {}), same: shared || same };
  });
  const fa = filesOf(runs, a, sa, sharedUntil);
  const fb = filesOf(runs, b, sb, sharedUntil);
  const paths = [...new Set([...fa.files.keys(), ...fb.files.keys()])].sort();
  const files = paths.map((path) => {
    const x = fa.files.get(path) ?? { change: 'unchanged' as const };
    const y = fb.files.get(path) ?? { change: 'unchanged' as const };
    const same = x.change === y.change && (x.change === 'removed' || x.change === 'unchanged' || (Boolean(x.sha) && x.sha === y.sha));
    return { path, a: x, b: y, same };
  });
  const ansA = finalAnswer(a, store, (id) => runs.runMessages(id));
  const ansB = finalAnswer(b, store, (id) => runs.runMessages(id));
  const ops = diffWords(ansA, ansB);
  const memA = [...new Set(sa.flatMap((s) => side(s).memory))];
  const memB = [...new Set(sb.flatMap((s) => side(s).memory))];
  const sum = (list: (StepView & { runId: number })[]) => ({
    tokens: list.reduce((n, s) => n + s.tokensIn + s.tokensOut, 0),
    usd: Math.round(list.reduce((n, s) => n + s.usd, 0) * 1e8) / 1e8,
    unknown: list.some((s) => s.unpriced + s.unreported > 0),
    tools: list.reduce((n, s) => n + s.tools.length, 0),
  });
  const ta = sum(sa);
  const tb = sum(sb);
  return {
    a: { run: a, label: a.parentRunId ? 'branch' : 'original' },
    b: { run: b, label: b.parentRunId ? 'branch' : 'original' },
    sharedUntil,
    steps,
    files,
    ...(fa.hashOnly || fb.hashOnly ? { filesNote: 'hashes' } : {}),
    answer: { a: ansA, b: ansB, ops, same: ansA === ansB },
    memory: { a: memA, b: memB, onlyA: memA.filter((x) => !memB.includes(x)), onlyB: memB.filter((x) => !memA.includes(x)) },
    summary: { stepsA: sa.length, stepsB: sb.length, tokensA: ta.tokens, tokensB: tb.tokens, usdA: ta.usd, usdB: tb.usd, costUnknown: ta.unknown || tb.unknown, toolsA: ta.tools, toolsB: tb.tools, filesDiffer: files.filter((f) => !f.same).map((f) => f.path), sameAnswer: ansA === ansB },
  };
}

/** The summary in plain English (for logs and the headless API; the page writes its own, translated). */
export function summaryLine(d: RunDiff): string {
  const s = d.summary;
  const parts: string[] = [];
  const steps = s.stepsB - s.stepsA;
  parts.push(steps === 0 ? 'the same number of steps' : `${Math.abs(steps)} ${steps < 0 ? 'fewer' : 'more'} step${Math.abs(steps) === 1 ? '' : 's'}`);
  if (s.tokensA > 0) {
    const pct = Math.round(((s.tokensB - s.tokensA) / s.tokensA) * 100);
    parts.push(pct === 0 ? 'about the same tokens' : `${Math.abs(pct)}% ${pct < 0 ? 'fewer' : 'more'} tokens`);
  }
  if (s.filesDiffer.length) parts.push(`different file edits in ${s.filesDiffer.slice(0, 3).join(', ')}${s.filesDiffer.length > 3 ? ` and ${s.filesDiffer.length - 3} more` : ''}`);
  parts.push(s.sameAnswer ? 'the same answer' : 'a different answer');
  return `The ${d.b.label} used ${parts.join(', ')}.`;
}
