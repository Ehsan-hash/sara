// Phase 81 (harness track M6, §7 #2): live dependency advisories from OSV.dev (one source, no key).
// A package list goes out only when the owner switched it on (off by default, the list shown
// first), never from private conversations or private local mode ("Nothing leaves this
// computer"), and only through `netFetch` (src/net-guard.ts). Answers are cached in each space's
// sara.db: clean and vulnerable verdicts 6 hours, errors 1 hour; offline nothing is asked and the
// cache answers (even past its time); a package never seen is "not checked: offline".
//
// The API: POST /v1/querybatch with up to 50 {package:{name, ecosystem}, version} queries (the ids
// that affect each), then GET /v1/vulns/{id} for each id's summary, severity and fixed version
// (cached a day). One request is in flight per space at a time (a queue), so a big lockfile is a
// few calls in a row, never a burst.
import type { DatabaseSync } from 'node:sqlite';
import { netFetch, privateLocalOn } from '../net-guard.ts';
import { pkgKey, type Ecosystem, type Pkg } from './deps.ts';
import type { FindingSeverity } from './findings.ts';

export const OSV_URL = 'https://api.osv.dev';
export const CLEAN_TTL_S = 6 * 3600;
export const ERROR_TTL_S = 3600;
export const VULN_TTL_S = 24 * 3600;
export const BATCH_MAX = 50;

export interface Advisory {
  id: string;
  summary: string;
  severity: FindingSeverity;
  aliases: string[];
  /** The first version that fixes it (when OSV says). */
  fixed?: string;
  url: string;
}

export interface Verdict {
  status: 'vulnerable' | 'clean' | 'unknown';
  vulns: Advisory[];
  checkedAt: string;
  /** Why it is unknown: offline (or private local mode), or the service answered with an error. */
  reason?: 'offline' | 'error';
  /** Answered from a cache entry older than its time (offline). */
  stale?: boolean;
  fromCache?: boolean;
}

type Row = Record<string, string | number | null>;

export interface OsvOptions {
  baseUrl?: string;
  /** Injectable for tests (default: netFetch, the one way out). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  timeoutMs?: number;
}

/** How serious an OSV entry is, from its own database's word (GHSA: LOW/MODERATE/HIGH/CRITICAL) or a CVSS score. */
export function osvSeverity(v: { database_specific?: { severity?: unknown }; severity?: { type?: string; score?: string }[]; affected?: { ecosystem_specific?: { severity?: unknown } }[] }): FindingSeverity {
  const word = String(v.database_specific?.severity ?? v.affected?.[0]?.ecosystem_specific?.severity ?? '').toUpperCase();
  if (word === 'CRITICAL' || word === 'HIGH') return 'high';
  if (word === 'MODERATE' || word === 'MEDIUM') return 'medium';
  if (word === 'LOW') return 'low';
  // A CVSS v3 vector carries no number; numeric scores (some databases) do.
  const score = Number(v.severity?.find((s) => /^\d+(\.\d+)?$/.test(String(s.score ?? '')))?.score);
  if (Number.isFinite(score)) return score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';
  return 'medium';
}

/** The first fixed version OSV lists for this package. */
export function fixedVersion(v: { affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events?: { fixed?: string }[] }[] }[] }, p: Pkg): string | undefined {
  for (const a of v.affected ?? []) {
    if (a.package?.name && a.package.name.toLowerCase() !== p.name.toLowerCase()) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed;
  }
  return undefined;
}

export class OsvClient {
  readonly #db: DatabaseSync;
  readonly #base: string;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly #now: () => Date;
  readonly #timeout: number;
  /** One request in flight at a time (a queue of calls). */
  #chain: Promise<unknown> = Promise.resolve();
  /** Counters (tests, the settings page). */
  readonly stats = { requests: 0, batches: 0, details: 0, inFlight: 0, maxInFlight: 0, offline: 0 };

  constructor(db: DatabaseSync, opts: OsvOptions = {}) {
    this.#db = db;
    this.#base = (opts.baseUrl ?? OSV_URL).replace(/\/+$/, '');
    this.#fetch = opts.fetch ?? ((url, init) => netFetch(url, init));
    this.#now = opts.now ?? (() => new Date());
    this.#timeout = opts.timeoutMs ?? 15_000;
    db.exec(`CREATE TABLE IF NOT EXISTS advisory_cache (
      ecosystem TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      ttl_s INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      PRIMARY KEY (ecosystem, name, version)
    );
    CREATE TABLE IF NOT EXISTS advisory_vulns (
      id TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      data TEXT NOT NULL
    );`);
  }

  /** One HTTP call, queued behind any other (never two at once from this space). */
  #queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => {
      this.stats.inFlight++;
      this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.stats.inFlight);
      this.stats.requests++;
      try {
        return await fn();
      } finally {
        this.stats.inFlight--;
      }
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  #cached(p: Pkg): { verdict: Verdict; fresh: boolean } | undefined {
    const r = this.#db.prepare('SELECT * FROM advisory_cache WHERE ecosystem = ? AND name = ? AND version = ?').get(p.ecosystem, p.name.toLowerCase(), p.version) as Row | undefined;
    if (!r) return undefined;
    try {
      const verdict = JSON.parse(String(r.verdict)) as Verdict;
      const age = (this.#now().getTime() - Date.parse(String(r.fetched_at))) / 1000;
      return { verdict, fresh: age < Number(r.ttl_s) };
    } catch {
      return undefined;
    }
  }

  #store(p: Pkg, v: Verdict, ttl: number): void {
    this.#db.prepare('INSERT INTO advisory_cache (ecosystem, name, version, fetched_at, ttl_s, verdict) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ecosystem, name, version) DO UPDATE SET fetched_at = excluded.fetched_at, ttl_s = excluded.ttl_s, verdict = excluded.verdict').run(p.ecosystem, p.name.toLowerCase(), p.version, v.checkedAt, ttl, JSON.stringify(v));
  }

  /** What the cache holds now (no request): the settings page and offline answers. */
  peek(p: Pkg): Verdict | undefined {
    const c = this.#cached(p);
    return c ? { ...c.verdict, fromCache: true, ...(c.fresh ? {} : { stale: true }) } : undefined;
  }

  /** Cache size (the settings page). */
  cacheSize(): number {
    return Number((this.#db.prepare('SELECT COUNT(*) AS n FROM advisory_cache').get() as Row).n);
  }

  clearCache(): void {
    this.#db.exec('DELETE FROM advisory_cache; DELETE FROM advisory_vulns;');
  }

  async #post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.#queued(async () => {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeout)]) : AbortSignal.timeout(this.#timeout);
      const r = await this.#fetch(`${this.#base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: sig });
      if (!r.ok) throw new OsvHttpError(r.status);
      return r.json();
    });
  }

  async #get(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.#queued(async () => {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeout)]) : AbortSignal.timeout(this.#timeout);
      const r = await this.#fetch(`${this.#base}${path}`, { method: 'GET', headers: { accept: 'application/json' }, signal: sig });
      if (!r.ok) throw new OsvHttpError(r.status);
      return r.json();
    });
  }

  async #details(id: string, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
    const r = this.#db.prepare('SELECT * FROM advisory_vulns WHERE id = ?').get(id) as Row | undefined;
    if (r && (this.#now().getTime() - Date.parse(String(r.fetched_at))) / 1000 < VULN_TTL_S) {
      try {
        return JSON.parse(String(r.data));
      } catch {
        /* fetch again */
      }
    }
    this.stats.details++;
    const data = (await this.#get(`/v1/vulns/${encodeURIComponent(id)}`, signal)) as Record<string, unknown>;
    // Kept small: what the finding shows.
    const keep = { id: data.id, summary: data.summary, details: typeof data.details === 'string' ? data.details.slice(0, 600) : undefined, aliases: data.aliases, severity: data.severity, database_specific: data.database_specific, affected: Array.isArray(data.affected) ? (data.affected as unknown[]).slice(0, 5) : undefined };
    this.#db.prepare('INSERT INTO advisory_vulns (id, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data').run(id, this.#now().toISOString(), JSON.stringify(keep));
    return keep;
  }

  /**
   * Verdicts for these packages: fresh cache first, then OSV in batches of at most 50 (one call
   * in flight). Offline / private local mode: no request; the cache answers (even stale) and the
   * rest are `unknown` with reason `offline`.
   */
  async check(pkgs: Pkg[], signal?: AbortSignal): Promise<Map<string, Verdict>> {
    const out = new Map<string, Verdict>();
    const todo: Pkg[] = [];
    const seen = new Set<string>();
    for (const p of pkgs) {
      const k = pkgKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = this.#cached(p);
      if (c?.fresh) out.set(k, { ...c.verdict, fromCache: true });
      else todo.push(p);
    }
    const offline = (p: Pkg) => {
      const c = this.#cached(p);
      out.set(pkgKey(p), c ? { ...c.verdict, fromCache: true, stale: true } : { status: 'unknown', vulns: [], checkedAt: this.#now().toISOString(), reason: 'offline' });
    };
    if (!todo.length) return out;
    if (privateLocalOn()) {
      this.stats.offline++;
      for (const p of todo) offline(p);
      return out;
    }
    for (let i = 0; i < todo.length; i += BATCH_MAX) {
      const batch = todo.slice(i, i + BATCH_MAX);
      let results: { vulns?: { id: string }[] }[];
      try {
        this.stats.batches++;
        const r = (await this.#post('/v1/querybatch', { queries: batch.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }, signal)) as { results?: { vulns?: { id: string }[] }[] };
        results = Array.isArray(r?.results) ? r.results : [];
      } catch (err) {
        if (err instanceof OsvHttpError) {
          for (const p of batch) {
            const v: Verdict = { status: 'unknown', vulns: [], checkedAt: this.#now().toISOString(), reason: 'error' };
            this.#store(p, v, ERROR_TTL_S);
            out.set(pkgKey(p), v);
          }
        } else {
          // No answer at all (no network, refused, timed out): offline. Nothing cached.
          this.stats.offline++;
          for (const p of todo.slice(i)) offline(p);
          return out;
        }
        continue;
      }
      for (let k = 0; k < batch.length; k++) {
        const p = batch[k];
        const ids = [...new Set((results[k]?.vulns ?? []).map((v) => String(v.id)).filter(Boolean))].slice(0, 20);
        const vulns: Advisory[] = [];
        for (const id of ids) {
          let d: Record<string, unknown> | undefined;
          try {
            d = await this.#details(id, signal);
          } catch {
            d = undefined; // still listed, with what we know
          }
          vulns.push({
            id,
            summary: String((d?.summary as string | undefined) ?? (d?.details as string | undefined)?.split('\n')[0] ?? id).slice(0, 300),
            severity: d ? osvSeverity(d as Parameters<typeof osvSeverity>[0]) : 'medium',
            aliases: Array.isArray(d?.aliases) ? (d!.aliases as unknown[]).map(String).slice(0, 5) : [],
            ...(d && fixedVersion(d as Parameters<typeof fixedVersion>[0], p) ? { fixed: fixedVersion(d as Parameters<typeof fixedVersion>[0], p) } : {}),
            url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
          });
        }
        const v: Verdict = { status: vulns.length ? 'vulnerable' : 'clean', vulns, checkedAt: this.#now().toISOString() };
        this.#store(p, v, CLEAN_TTL_S);
        out.set(pkgKey(p), v);
      }
    }
    return out;
  }
}

class OsvHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`OSV answered ${status}`);
    this.status = status;
  }
}

/** The worst severity of a verdict's advisories. */
export function worst(v: Verdict): FindingSeverity {
  const rank: Record<FindingSeverity, number> = { block: 4, high: 3, medium: 2, low: 1, info: 0 };
  return v.vulns.reduce<FindingSeverity>((a, x) => (rank[x.severity] > rank[a] ? x.severity : a), 'low');
}

/** One line about a vulnerable package (approval card, her tool result, the finding's title). */
export function advisoryLine(p: Pkg, v: Verdict): string {
  const ids = v.vulns.slice(0, 3).map((x) => x.id).join(', ');
  const fixed = v.vulns.map((x) => x.fixed).find(Boolean);
  return `${p.name} ${p.version} (${p.ecosystem}): ${v.vulns.length} known ${v.vulns.length === 1 ? 'vulnerability' : 'vulnerabilities'} (${ids}${v.vulns.length > 3 ? ', …' : ''})${fixed ? `; fixed in ${fixed}` : ''}`;
}

/** An install the check stopped (the approval card's "Known vulnerability" section). */
export interface AdvisoryCard {
  command: string;
  packages: { ecosystem: Ecosystem; name: string; version: string; severity: FindingSeverity; vulns: { id: string; summary: string; severity: FindingSeverity; fixed?: string; url: string }[] }[];
}

/** What she reads when the owner said no to a vulnerable install (her tool result). */
export function declinedInstallOutput(card: AdvisoryCard): string {
  const lines = card.packages.map((p) => {
    const fixed = p.vulns.map((v) => v.fixed).find(Boolean);
    return `- ${p.name} ${p.version}: ${p.vulns.map((v) => v.id).slice(0, 3).join(', ')}${fixed ? ` (fixed in ${fixed})` : ''}`;
  });
  return `Not installed: known vulnerabilities, and the owner said no.\n${lines.join('\n')}\nPick a fixed version (or another package) and tell the owner.`;
}

export type { Ecosystem };
