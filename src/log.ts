// Phase 30: Sara's own log file. Everything she prints still goes to the console (the system
// journal on a server); a copy goes to <data>/logs/sara.log as one JSON object per line, with
// secrets hidden, rotated at 5 MB (5 old files kept). Settings → Data & health shows recent
// problems from it and offers it as a download.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

export const LOG_DIR = 'logs';
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 5;

export interface LogLine {
  t: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

/** Long token-like values (owner token, keys) are never written, whatever printed them. */
export function hideTokens(s: string): string {
  return s.replace(/(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/g, '[hidden]').replace(/\b(sk|xai|ghp|github_pat|gho)[-_][\w-]{12,}/g, '[hidden]');
}

export class Log {
  readonly file: string;
  readonly #redact: (s: string) => string;
  readonly #now: () => Date;
  /** Problems (warn/error) since start, for the health history. */
  problems = 0;

  constructor(dataDir: string, redact: (s: string) => string = (s) => s, now: () => Date = () => new Date()) {
    const dir = join(dataDir, LOG_DIR);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'sara.log');
    this.#redact = redact;
    this.#now = now;
  }

  write(level: LogLine['level'], msg: string): void {
    if (level !== 'info') this.problems++;
    const line: LogLine = { t: this.#now().toISOString(), level, msg: hideTokens(this.#redact(msg)).slice(0, 4000) };
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_BYTES) this.#rotate();
      appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch {
      /* a full disk must not stop Sara */
    }
  }

  #rotate(): void {
    rmSync(`${this.file}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
    renameSync(this.file, `${this.file}.1`);
  }

  /** The newest lines (optionally only warnings and errors), newest first. */
  recent(opts: { problems?: boolean; limit?: number } = {}): LogLine[] {
    const out: LogLine[] = [];
    for (const f of [this.file, `${this.file}.1`]) {
      if (!existsSync(f)) continue;
      const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).reverse();
      for (const l of lines) {
        try {
          const x = JSON.parse(l) as LogLine;
          if (!opts.problems || x.level !== 'info') out.push(x);
        } catch {
          /* a torn line */
        }
        if (out.length >= (opts.limit ?? 50)) return out;
      }
    }
    return out;
  }

  /** The whole current log as plain text, for download. */
  text(): string {
    return this.recent({ limit: 20_000 })
      .reverse()
      .map((l) => `${l.t} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`)
      .join('\n');
  }

  /** Copies console.log/warn/error into the log file (the console output itself is unchanged). */
  captureConsole(): void {
    for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']] as const) {
      const orig = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        orig(...args);
        this.write(level, format(...args));
      };
    }
  }
}

/**
 * Runs one round of a background task (a timer tick) so that a failure is logged and the next
 * round still runs, instead of taking the whole server down (a full disk, a locked database).
 */
export function guard(name: string, fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((err: Error) => console.warn(`${name}: ${err?.message ?? err}`));
  } catch (err) {
    console.warn(`${name}: ${(err as Error)?.message ?? err}`);
  }
}
