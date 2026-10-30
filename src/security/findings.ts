// Phase 81 (harness track M6, docs/design/HARNESS_TRACK.md §2.5): the ONE findings table. Every
// check that can stop or fix work files its findings here: the security pass (code rules and the
// Reviewing model), live dependency advisories, the sandbox gate (M5), the plan check against the
// owner's decisions (M2), and later the threat pass (M7) and red-team mode (M11).
//
// The "no theater" rule: a finding that names a file must quote the real text at that line. Code
// checks it (`validateQuotes`) before anything is stored; a quote that isn't in the file verbatim
// drops the finding. Sandbox and plan-check findings quote output or the owner's own words and were
// checked by their own modules (src/sandbox-run.ts checkedFindings, src/contradict.ts).
import { createHash } from 'node:crypto';
import { lstatSync, openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { resolveInside } from '../tools/workspace.ts';

export type FindingSource = 'security' | 'advisory' | 'sandbox' | 'contradiction' | 'threat' | 'redteam';
export const FINDING_SOURCES: readonly FindingSource[] = ['security', 'advisory', 'sandbox', 'contradiction', 'threat', 'redteam'];
export type FindingSeverity = 'block' | 'high' | 'medium' | 'low' | 'info';
export const FINDING_SEVERITIES: readonly FindingSeverity[] = ['block', 'high', 'medium', 'low', 'info'];
export type FindingStatus = 'open' | 'fixed' | 'dismissed' | 'accepted';
export const FINDING_STATUSES: readonly FindingStatus[] = ['open', 'fixed', 'dismissed', 'accepted'];
/** Who found it: a rule in code, or a model (the Reviewing model; its quote was checked by code). */
export type FindingOrigin = 'code' | 'model';

export const SEVERITY_RANK: Record<FindingSeverity, number> = { block: 4, high: 3, medium: 2, low: 1, info: 0 };

/** A finding before it is stored. */
export interface NewFinding {
  source: FindingSource;
  severity: FindingSeverity;
  rule: string;
  title: string;
  advice: string;
  /** Workspace-relative, forward slashes. */
  file?: string | null;
  /** 1-based. */
  line?: number | null;
  /** The real text at that line (code findings) or the quoted output / owner's words. */
  quote?: string | null;
  origin?: FindingOrigin;
  /** Extra data (an advisory's package, version, ids, fixed version; a sandbox finding's files). */
  meta?: Record<string, unknown>;
  status?: FindingStatus;
  reason?: string | null;
}

/** Where a batch of findings came from. */
export interface FindingScope {
  conversationId?: string | null;
  workspace?: string | null;
  runId?: number | null;
  step?: number | null;
}

/** The fix-branch loop's state on a finding (src/security/fix.ts). */
export interface FixState {
  state: 'working' | 'ready' | 'failed' | 'applied' | 'kept' | 'discarded';
  branch: string;
  startedAt: string;
  endedAt?: string;
  /** What she is doing now ("asking the Coding model", "running the tests"). */
  stage?: string;
  baseSha?: string;
  fixSha?: string;
  /** The finding's rule no longer fires on the fixed file (and the count went down). */
  recheck?: { fixed: boolean; before: number; after: number; remaining: { line: number; quote: string }[] };
  tests?: { command: string; ran: boolean; exitCode: number | null; timedOut: boolean; ms: number; output: string; isolated: boolean; label: string; note?: string } | null;
  diff?: string;
  files?: string[];
  attempts?: number;
  tokens?: number;
  note?: string;
  error?: string;
  /** Apply: files written / left alone because they changed meanwhile. */
  applied?: { written: string[]; conflicts: string[] };
  runId?: number;
}

export interface Finding {
  id: number;
  runId: number | null;
  step: number | null;
  conversationId: string | null;
  workspace: string | null;
  source: FindingSource;
  origin: FindingOrigin;
  severity: FindingSeverity;
  rule: string;
  title: string;
  file: string | null;
  line: number | null;
  quote: string | null;
  advice: string;
  status: FindingStatus;
  reason: string | null;
  fixBranch: string | null;
  fix: FixState | null;
  meta: Record<string, unknown>;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface FindingFilter {
  workspace?: string;
  conversationId?: string;
  runId?: number;
  status?: FindingStatus | 'all';
  severity?: FindingSeverity;
  /** At least this severity. */
  minSeverity?: FindingSeverity;
  source?: FindingSource;
  limit?: number;
}

type Row = Record<string, string | number | null>;
const json = <T>(s: unknown, d: T): T => {
  if (typeof s !== 'string' || !s) return d;
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/**
 * One fingerprint per real problem: the same rule on the same quoted line of the same file (line
 * numbers move as code is edited, so they don't count). An advisory: package + version + ids.
 */
export function fingerprint(f: Pick<NewFinding, 'source' | 'rule' | 'file' | 'quote' | 'meta'>, workspace?: string | null): string {
  const quote = (f.quote ?? '').replace(/\s+/g, ' ').trim();
  const extra = f.source === 'advisory' ? `${String(f.meta?.ecosystem ?? '')}|${String(f.meta?.name ?? '')}|${String(f.meta?.version ?? '')}` : '';
  return createHash('sha256').update([workspace ?? '', f.source, f.rule, f.file ?? '', quote, extra].join('\u0000')).digest('hex').slice(0, 24);
}

export class FindingStore {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  /** Called after any change (the server publishes a `findings` event). */
  onChange?: (f: { conversationId: string | null; workspace: string | null }) => void;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      step INTEGER,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      workspace TEXT,
      source TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'code',
      severity TEXT NOT NULL,
      rule TEXT NOT NULL,
      title TEXT NOT NULL,
      file TEXT,
      line INTEGER,
      quote TEXT,
      advice TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      reason TEXT,
      fix_branch TEXT,
      fix TEXT,
      meta TEXT,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS findings_ws ON findings(workspace, status);
    CREATE INDEX IF NOT EXISTS findings_conv ON findings(conversation_id, id);
    CREATE INDEX IF NOT EXISTS findings_run ON findings(run_id);
    CREATE INDEX IF NOT EXISTS findings_fp ON findings(fingerprint);`);
  }

  #view(r: Row): Finding {
    return {
      id: Number(r.id),
      runId: r.run_id === null ? null : Number(r.run_id),
      step: r.step === null ? null : Number(r.step),
      conversationId: (r.conversation_id as string | null) ?? null,
      workspace: (r.workspace as string | null) ?? null,
      source: r.source as FindingSource,
      origin: (r.origin as FindingOrigin) ?? 'code',
      severity: r.severity as FindingSeverity,
      rule: String(r.rule),
      title: String(r.title),
      file: (r.file as string | null) ?? null,
      line: r.line === null ? null : Number(r.line),
      quote: (r.quote as string | null) ?? null,
      advice: String(r.advice ?? ''),
      status: r.status as FindingStatus,
      reason: (r.reason as string | null) ?? null,
      fixBranch: (r.fix_branch as string | null) ?? null,
      fix: json<FixState | null>(r.fix, null),
      meta: json<Record<string, unknown>>(r.meta, {}),
      fingerprint: String(r.fingerprint),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  /**
   * Stores new findings. A finding the same as one already known (same fingerprint in the same
   * workspace) is not stored twice: an open one gets the newer run/line, a dismissed or accepted
   * one stays as the owner left it. Returns the rows (new or existing) in input order.
   */
  add(list: NewFinding[], scope: FindingScope = {}): Finding[] {
    const out: Finding[] = [];
    const now = this.#now().toISOString();
    const find = this.#db.prepare('SELECT * FROM findings WHERE fingerprint = ? ORDER BY id DESC LIMIT 1');
    const ins = this.#db.prepare(
      'INSERT INTO findings (run_id, step, conversation_id, workspace, source, origin, severity, rule, title, file, line, quote, advice, status, reason, meta, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const touch = this.#db.prepare('UPDATE findings SET run_id = COALESCE(?, run_id), step = COALESCE(?, step), line = COALESCE(?, line), updated_at = ? WHERE id = ?');
    this.#db.exec('BEGIN');
    try {
      for (const f of list) {
        const fp = fingerprint(f, scope.workspace);
        const old = find.get(fp) as Row | undefined;
        // Plan-check, sandbox and install-time findings are per event (each is its own decision): always new.
        const perEvent = f.source === 'contradiction' || f.source === 'sandbox' || f.meta?.install === true;
        if (old && !perEvent && (old.status !== 'fixed' || !f.file)) {
          if (old.status === 'open') touch.run(scope.runId ?? null, scope.step ?? null, f.line ?? null, now, Number(old.id));
          out.push(this.#view((this.#db.prepare('SELECT * FROM findings WHERE id = ?').get(Number(old.id)) as Row) ?? old));
          continue;
        }
        const r = ins.run(
          scope.runId ?? null,
          scope.step ?? null,
          scope.conversationId ?? null,
          scope.workspace ?? null,
          f.source,
          f.origin ?? 'code',
          f.severity,
          f.rule.slice(0, 80),
          f.title.slice(0, 300),
          f.file ?? null,
          f.line ?? null,
          f.quote ? f.quote.slice(0, 500) : null,
          (f.advice ?? '').slice(0, 2000),
          f.status ?? 'open',
          f.reason ?? null,
          f.meta ? JSON.stringify(f.meta).slice(0, 20_000) : null,
          fp,
          now,
          now,
        );
        out.push(this.get(Number(r.lastInsertRowid))!);
      }
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    if (list.length) this.onChange?.({ conversationId: scope.conversationId ?? null, workspace: scope.workspace ?? null });
    return out;
  }

  get(id: number): Finding | undefined {
    const r = this.#db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#view(r) : undefined;
  }

  list(f: FindingFilter = {}): Finding[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.workspace) (where.push('workspace = ?'), args.push(f.workspace));
    if (f.conversationId) (where.push('conversation_id = ?'), args.push(f.conversationId));
    if (f.runId) (where.push('run_id = ?'), args.push(f.runId));
    if (f.status && f.status !== 'all') (where.push('status = ?'), args.push(f.status));
    if (f.severity) (where.push('severity = ?'), args.push(f.severity));
    if (f.minSeverity) {
      const ok = FINDING_SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[f.minSeverity!]);
      where.push(`severity IN (${ok.map(() => '?').join(',')})`);
      args.push(...ok);
    }
    if (f.source) (where.push('source = ?'), args.push(f.source));
    const limit = Math.min(Math.max(1, f.limit ?? 500), 2000);
    const rows = this.#db.prepare(`SELECT * FROM findings ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE severity WHEN 'block' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id DESC LIMIT ${limit}`).all(...args) as Row[];
    return rows.map((r) => this.#view(r));
  }

  /** Open findings per severity (for the badge and the reply's card). */
  counts(f: Omit<FindingFilter, 'status' | 'severity'> = {}): Record<FindingStatus, number> & { bySeverity: Record<FindingSeverity, number> } {
    const all = this.list({ ...f, status: 'all', limit: 2000 });
    const out = { open: 0, fixed: 0, dismissed: 0, accepted: 0, bySeverity: { block: 0, high: 0, medium: 0, low: 0, info: 0 } };
    for (const x of all) {
      out[x.status]++;
      if (x.status === 'open') out.bySeverity[x.severity]++;
    }
    return out;
  }

  workspaces(): string[] {
    return (this.#db.prepare('SELECT DISTINCT workspace FROM findings WHERE workspace IS NOT NULL ORDER BY workspace').all() as Row[]).map((r) => String(r.workspace));
  }

  /** Dismiss / accept (with the owner's reason) or reopen. */
  setStatus(id: number, status: FindingStatus, reason?: string | null): Finding | undefined {
    const now = this.#now().toISOString();
    this.#db.prepare('UPDATE findings SET status = ?, reason = ?, updated_at = ? WHERE id = ?').run(status, reason ? String(reason).slice(0, 500) : null, now, id);
    const f = this.get(id);
    if (f) this.onChange?.({ conversationId: f.conversationId, workspace: f.workspace });
    return f;
  }

  setFix(id: number, fix: FixState | null, branch?: string | null): Finding | undefined {
    const now = this.#now().toISOString();
    if (branch !== undefined) this.#db.prepare('UPDATE findings SET fix = ?, fix_branch = ?, updated_at = ? WHERE id = ?').run(fix ? JSON.stringify(fix) : null, branch, now, id);
    else this.#db.prepare('UPDATE findings SET fix = ?, updated_at = ? WHERE id = ?').run(fix ? JSON.stringify(fix) : null, now, id);
    const f = this.get(id);
    if (f) this.onChange?.({ conversationId: f.conversationId, workspace: f.workspace });
    return f;
  }

  /** Forget every finding (data reset). */
  deleteAll(): number {
    return Number(this.#db.prepare('DELETE FROM findings').run().changes);
  }
}

// ------------------------------------------------------------------------------------------------
// The "no theater" rule
// ------------------------------------------------------------------------------------------------

const MAX_READ = 2 * 1024 * 1024;

/**
 * Reads a workspace file for checking (never through a link, never outside the workspace, at most
 * 2 MB). Returns undefined when it can't be read that way.
 */
export function readWorkspaceText(wsDir: string, rel: string): string | undefined {
  try {
    const abs = resolveInside(wsDir, rel);
    if (lstatSync(abs).isSymbolicLink()) return undefined;
    const fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > MAX_READ) return undefined;
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) {
        const n = readSync(fd, buf, off, st.size - off, off);
        if (!n) break;
        off += n;
      }
      const text = buf.subarray(0, off).toString('utf8');
      return text.includes('\u0000') ? undefined : text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** A quote long enough to mean something (not "x" or "}"). */
const meaningful = (q: string) => q.replace(/\s+/g, '').length >= 6;

/**
 * The "no theater" rule (§2.5): keeps only findings whose quote is found verbatim in the named
 * file. A finding whose line doesn't hold the quote but another line does is moved to that line
 * (models count lines badly); one whose quote is nowhere in the file, too short, or names a file
 * that can't be read, is dropped. Findings without a file (sandbox output, the owner's words) are
 * not code findings and pass unchanged.
 */
export function validateQuotes<T extends NewFinding>(list: T[], read: (file: string) => string | undefined): { kept: T[]; dropped: { finding: T; why: string }[] } {
  const kept: T[] = [];
  const dropped: { finding: T; why: string }[] = [];
  const cache = new Map<string, string[] | undefined>();
  for (const f of list) {
    if (!f.file) {
      kept.push(f);
      continue;
    }
    const quote = (f.quote ?? '').trim();
    if (!quote || !meaningful(quote)) {
      dropped.push({ finding: f, why: 'no quote' });
      continue;
    }
    if (!cache.has(f.file)) {
      const text = read(f.file);
      cache.set(f.file, text === undefined ? undefined : text.split(/\r?\n/));
    }
    const lines = cache.get(f.file);
    if (!lines) {
      dropped.push({ finding: f, why: 'file not readable' });
      continue;
    }
    const at = f.line && f.line >= 1 && f.line <= lines.length && lines[f.line - 1].includes(quote) ? f.line : lines.findIndex((l) => l.includes(quote)) + 1;
    if (!at) {
      dropped.push({ finding: f, why: 'quote not in the file' });
      continue;
    }
    kept.push({ ...f, line: at, quote });
  }
  return { kept, dropped };
}

// ------------------------------------------------------------------------------------------------
// M2 / M5 findings into the table (their Finding-shaped objects stay on the messages and run steps)
// ------------------------------------------------------------------------------------------------

interface ContradictionLike {
  source?: string;
  rule?: string;
  title?: string;
  advice?: string;
  severity?: string;
  quote?: string | null;
  note?: string;
  memoryId?: number;
  matched?: string;
  tool?: string;
  act?: string;
  answer?: string;
  status?: string;
}
interface SandboxLike {
  id?: string;
  command?: string;
  decision?: string;
  findings?: { severity: string; rule: string; title: string; advice: string; quote?: string; files?: string[]; count?: number }[];
}

/**
 * Phase 81: a tool call's plan-check findings (M2) and sandbox observations (M5) also become rows
 * of the findings table, with the owner's answer as the status: an override or an applied try is
 * "accepted", a no or a discarded try "dismissed", a flag she only mentions stays "open".
 * Sandbox notes of severity info ("not isolated", "dependency folders not copied") are left out.
 */
export function recordTurnFindings(store: FindingStore, c: { contradictions?: ContradictionLike[]; sandbox?: SandboxLike }, scope: FindingScope): Finding[] {
  const list: NewFinding[] = [];
  for (const x of c.contradictions ?? []) {
    if (!x || x.source !== 'contradiction') continue;
    const overridden = x.answer === 'override';
    const declined = x.answer === 'deny' || x.answer === 'update';
    list.push({
      source: 'contradiction',
      severity: x.act === 'stop' ? 'high' : 'low',
      rule: `contradiction:${x.rule ?? 'fuzzy'}`,
      title: String(x.title ?? 'Goes against a decision'),
      advice: String(x.advice ?? ''),
      quote: x.quote ?? x.note ?? null,
      meta: { memoryId: x.memoryId, note: x.note, matched: x.matched, tool: x.tool, act: x.act, ...(x.answer ? { answer: x.answer } : {}) },
      status: overridden ? 'accepted' : declined ? 'dismissed' : 'open',
      reason: overridden ? 'Do it anyway (your override on the card)' : x.answer === 'update' ? 'You chose to update the note' : declined ? 'You said no; the action did not run' : null,
    });
  }
  const sb = c.sandbox;
  for (const f of sb?.findings ?? []) {
    if (f.severity === 'info') continue;
    const applied = sb!.decision === 'applied' || sb!.decision === 'auto-applied';
    const ran = sb!.decision === 'ran';
    list.push({
      source: 'sandbox',
      severity: (FINDING_SEVERITIES as readonly string[]).includes(f.severity) ? (f.severity as FindingSeverity) : 'medium',
      rule: `sandbox:${f.rule}`,
      title: f.title,
      advice: f.advice,
      quote: f.quote ?? null,
      meta: { command: sb!.command, decision: sb!.decision, tryId: sb!.id, ...(f.files?.length ? { files: f.files.slice(0, 30) } : {}), ...(f.count ? { count: f.count } : {}) },
      status: applied || ran ? 'accepted' : 'dismissed',
      reason: applied ? 'You applied the try' : ran ? 'You ran it for real' : sb!.decision === 'cancelled' ? 'Cancelled' : 'You discarded the try',
    });
  }
  return list.length ? store.add(list, scope) : [];
}
