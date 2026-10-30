// Phase 23: updates from Settings. Sara runs as an unprivileged user, so she never updates
// herself: she drops a one-word request file ("check" or "update") in her data folder, and the
// root-owned sara-updater.path unit runs `sara web-request`, which backs up, updates, checks
// health and goes back to the previous version by itself if the new one doesn't start. The
// outcome lands in update-status.json, which this module reads back for the Settings page.
//
// Phase 46: on Windows and macOS there is no root helper and no git checkout. "Check for
// updates" reads the latest release from GitHub and compares versions; "Update" answers with the
// download page, whose installer upgrades Sara in place.
import { assertOnline, netFetch } from './net-guard.ts';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type UpdateState = 'idle' | 'checking' | 'available' | 'current' | 'updating' | 'updated' | 'rolledback' | 'failed';

export interface UpdateStatus {
  state: UpdateState;
  message: string;
  at?: string;
  version?: string;
  latest?: string;
  behind?: number;
  changes?: string[];
  /** A request is waiting for the updater to pick it up. */
  pending?: 'check' | 'update';
  /** Windows and macOS: the page with the new installer. */
  downloadUrl?: string;
}

export interface UpdaterOptions {
  dataDir: string;
  /** Where the root updater writes its status (root-owned, readable by sara). */
  statusDir?: string;
  /** Where systemd units live (tests point this elsewhere). */
  unitDir?: string;
  /** Which way updates work: Linux uses the root helper, Windows and macOS the release page. */
  platform?: NodeJS.Platform;
  /** This version (package.json), for comparing with the newest release. */
  version?: string;
  /** The newest-release address (GitHub API). */
  releaseUrl?: string;
  /** Tests stub the network. */
  fetch?: typeof fetch;
}

/** Several Saras on one server: the instance's name (its unit sets SARA_INSTANCE; default "sara"). */
export function instanceName(env: NodeJS.ProcessEnv = process.env): string {
  const n = env.SARA_INSTANCE ?? '';
  return /^[a-z][a-z0-9-]{1,31}$/.test(n) ? n : 'sara';
}

const REQUEST = 'update-request';
const STATUS = 'update-status.json';
/** A request the updater hasn't picked up within this long means it isn't running. */
const STUCK_MS = 90_000;
export const RELEASE_API = 'https://api.github.com/repos/farena-ai/sara/releases/latest';
export const DOWNLOAD_PAGE = 'https://github.com/farena-ai/sara/releases/latest';

/** Compares dotted versions ("v0.46.1" vs "0.46.0"): negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export class Updater {
  readonly #o: UpdaterOptions;
  /** Release mode: the last check (kept in memory; a restart checks again). */
  #last: UpdateStatus = { state: 'idle', message: '' };
  constructor(o: UpdaterOptions) {
    this.#o = o;
  }

  /** 'helper' (Linux: the root updater) or 'release' (Windows, macOS: the download page). */
  get how(): 'helper' | 'release' {
    // A given unit or status folder means the root helper (tests of it run on every system).
    const p = this.#o.platform ?? (this.#o.unitDir || this.#o.statusDir ? 'linux' : process.platform);
    return p === 'win32' || p === 'darwin' ? 'release' : 'helper';
  }

  /** True on a native systemd install with the updater unit (Docker and dev runs: no); always on Windows and macOS. */
  get available(): boolean {
    if (this.how === 'release') return true;
    return existsSync(join(this.#o.unitDir ?? '/etc/systemd/system', `${instanceName()}-updater.path`));
  }

  status(now = new Date()): UpdateStatus {
    if (this.how === 'release') return { ...this.#last };
    let s: UpdateStatus = { state: 'idle', message: '' };
    try {
      const raw = JSON.parse(readFileSync(join(this.#o.statusDir ?? `/var/lib/${instanceName()}-updater`, STATUS), 'utf8')) as Record<string, unknown>;
      s = {
        state: String(raw.state) as UpdateState,
        message: String(raw.message ?? ''),
        ...(raw.at ? { at: String(raw.at) } : {}),
        ...(raw.version ? { version: String(raw.version) } : {}),
        ...(raw.latest ? { latest: String(raw.latest) } : {}),
        ...(raw.behind !== undefined ? { behind: Number(raw.behind) } : {}),
        ...(raw.changes ? { changes: String(raw.changes).split('\n').filter(Boolean).slice(0, 12) } : {}),
      };
    } catch {
      /* no status yet */
    }
    // An updater that died mid-way (power cut) must not block the button forever.
    if ((s.state === 'checking' || s.state === 'updating') && s.at && now.getTime() - Date.parse(s.at) > 20 * 60_000) {
      s.state = 'failed';
      s.message = "The last update didn't finish. On the server run: sudo sara status";
    }
    const req = join(this.#o.dataDir, REQUEST);
    if (existsSync(req)) {
      const what = readFileSync(req, 'utf8').trim() === 'update' ? 'update' : 'check';
      const age = now.getTime() - statSync(req).mtimeMs;
      s.pending = what;
      if (age > STUCK_MS) {
        s.state = 'failed';
        s.message = "The updater didn't pick up the request. On the server run: sudo sara update";
      }
    }
    return s;
  }

  /** Linux: hands the request to the root updater. Windows/macOS: use check() and update() instead. */
  request(what: 'check' | 'update'): void {
    if (this.how === 'release') throw new Error('Use check() or update() here.');
    // Phase 67: the root updater fetches from GitHub: never in private local mode.
    assertOnline('Checking for updates');
    if (!this.available) throw new Error('This server updates from the command line: sudo sara update');
    const s = this.status();
    if (s.pending || s.state === 'checking' || s.state === 'updating') throw new Error('An update check or update is already running.');
    writeFileSync(join(this.#o.dataDir, REQUEST), `${what}\n`, { mode: 0o600 });
  }

  /** Windows/macOS: asks GitHub for the newest release and compares it with this version. */
  check(now = new Date()): Promise<UpdateStatus> {
    // 2.18: every open page checks when it opens; several at once share one request to GitHub.
    if (!this.#inflight) this.#inflight = this.#check(now).finally(() => (this.#inflight = undefined));
    return this.#inflight;
  }
  #inflight: Promise<UpdateStatus> | undefined;

  async #check(now: Date): Promise<UpdateStatus> {
    const version = this.#o.version ?? '0.0.0';
    const at = now.toISOString();
    const f = this.#o.fetch ?? netFetch;
    let rel: { tag_name?: unknown; name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown };
    try {
      const res = await f(this.#o.releaseUrl ?? RELEASE_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `sara/${version}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rel = (await res.json()) as typeof rel;
      if (typeof rel?.tag_name !== 'string' || !rel.tag_name) throw new Error('no version in the answer');
    } catch {
      this.#last = { state: 'failed', message: "Couldn't check for updates. Try again later, or look on the download page.", at, version, downloadUrl: DOWNLOAD_PAGE };
      return { ...this.#last };
    }
    const latest = String(rel.tag_name).replace(/^v/i, '');
    const page = typeof rel.html_url === 'string' && /^https:\/\/github\.com\//.test(rel.html_url) ? rel.html_url : DOWNLOAD_PAGE;
    const changes = typeof rel.body === 'string' ? rel.body.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, '').trim()).filter(Boolean).slice(0, 12) : [];
    if (compareVersions(latest, version) > 0) {
      this.#last = { state: 'available', message: `Sara ${latest} is available. Download it and run the installer: it updates Sara in place and keeps your data.`, at, version, latest, downloadUrl: page, ...(changes.length ? { changes } : {}) };
    } else {
      this.#last = { state: 'current', message: `Sara ${version} is the newest version.`, at, version, latest, downloadUrl: page };
    }
    return { ...this.#last };
  }

  /** Windows/macOS: the installer does the update, so this answers with where to get it. */
  async update(now = new Date()): Promise<UpdateStatus> {
    const s = this.#last.state === 'available' ? this.#last : await this.check(now);
    if (s.state === 'available') return { ...s, message: `Download Sara ${s.latest} from ${s.downloadUrl} and run it: the installer updates Sara in place and keeps your data.` };
    return s;
  }
}
