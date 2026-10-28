// Live calls on the demo server, for app review only (SARA_DEMO_CALL_CODE). Calls stay off in the
// demo unless a reviewer code is set; a visitor unlocks calls once per demo session by entering it.
// Every call is capped (5 minutes) and all demo calls together share a daily budget of minutes
// (SARA_DEMO_CALL_MINUTES_PER_DAY, default 30), so the voice bill stays small.
import { timingSafeEqual } from 'node:crypto';

export const DEMO_CALL_MAX_MS = 5 * 60_000;
export const DEMO_CALL_MINUTES_PER_DAY = 30;
/** Hardening L3: shorter reviewer codes are refused at startup (calls stay off). */
export const DEMO_CALL_CODE_MIN = 12;
/** Hardening L3: wrong codes allowed per day from all addresses together (then no unlocks until tomorrow). */
export const DEMO_CALL_FAILS_PER_DAY = 100;

export interface DemoCallGateOpts {
  /** The reviewer code; empty or unset = no calls in the demo. */
  code?: string;
  minutesPerDay?: number;
  perCallMs?: number;
  now?: () => number;
}

export type DemoCallStart = { ok: true; maxMs: number; byBudget: boolean; done: () => void } | { ok: false; status: number; reason: string };

export class DemoCallGate {
  readonly #code: string;
  readonly #dailyMs: number;
  readonly #perCallMs: number;
  readonly #now: () => number;
  readonly #unlocked = new Set<string>();
  #day = '';
  #usedMs = 0;
  #failedToday = 0;
  /** Why calls are off although a code was given (too short); undefined otherwise. */
  readonly refused: string | undefined;
  /** The call going on now (one at a time in the demo): who, and when it started. */
  #current: { visitor: string; startedAt: number } | undefined;

  constructor(opts: DemoCallGateOpts = {}) {
    const code = (opts.code ?? '').trim();
    // A short code could be guessed from many addresses: refuse it, and say why (in the log).
    this.refused = code && code.length < DEMO_CALL_CODE_MIN ? `SARA_DEMO_CALL_CODE is shorter than ${DEMO_CALL_CODE_MIN} characters, so live calls stay off in the demo. Use a longer random code.` : undefined;
    this.#code = this.refused ? '' : code;
    const minutes = Number.isFinite(opts.minutesPerDay) && (opts.minutesPerDay as number) >= 0 ? (opts.minutesPerDay as number) : DEMO_CALL_MINUTES_PER_DAY;
    this.#dailyMs = minutes * 60_000;
    this.#perCallMs = opts.perCallMs ?? DEMO_CALL_MAX_MS;
    this.#now = opts.now ?? Date.now;
  }

  /** Calls can be offered in the demo at all (a reviewer code is set). */
  get enabled(): boolean {
    return this.#code.length > 0;
  }

  #roll(): void {
    const day = new Date(this.#now()).toISOString().slice(0, 10);
    if (day !== this.#day) {
      this.#day = day;
      this.#usedMs = 0;
      this.#failedToday = 0;
    }
  }

  /** Minutes of calling left today for all demo visitors together (a call going on counts). */
  remainingMs(): number {
    this.#roll();
    const running = this.#current ? this.#now() - this.#current.startedAt : 0;
    return Math.max(0, this.#dailyMs - this.#usedMs - running);
  }

  /** Too many wrong codes today (from all addresses together): no unlocks until tomorrow. */
  get lockedToday(): boolean {
    this.#roll();
    return this.#failedToday >= DEMO_CALL_FAILS_PER_DAY;
  }

  /** Checks the reviewer code; right = calls unlocked for this visitor (demo session). */
  unlock(visitor: string, code: unknown): boolean {
    if (!this.enabled || this.lockedToday) return false;
    const a = Buffer.from(String(code ?? '').trim());
    const b = Buffer.from(this.#code);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok) this.#unlocked.add(visitor);
    else this.#failedToday++;
    return ok;
  }

  unlocked(visitor: string): boolean {
    return this.enabled && this.#unlocked.has(visitor);
  }

  /** A visitor signed out or their demo session expired. */
  forget(visitor: string): void {
    this.#unlocked.delete(visitor);
  }

  /** What the call button needs to know. */
  view(visitor: string): { enabled: boolean; unlocked: boolean; minutesLeft: number; perCallMinutes: number } {
    return { enabled: this.enabled, unlocked: this.unlocked(visitor), minutesLeft: Math.floor(this.remainingMs() / 60_000), perCallMinutes: Math.round(this.#perCallMs / 60_000) };
  }

  /**
   * A demo call is starting. Refused without the code, when today's minutes are used up, or while
   * another demo call is going on. `done()` (call it once, when the call ends) books the minutes.
   */
  begin(visitor: string): DemoCallStart {
    if (!this.enabled) return { ok: false, status: 403, reason: 'Live calls are off in the demo.' };
    if (!this.#unlocked.has(visitor)) return { ok: false, status: 403, reason: 'Enter the reviewer code to call in the demo.' };
    if (this.#current) return { ok: false, status: 409, reason: 'Another demo call is going on. Try again in a few minutes.' };
    const left = this.remainingMs();
    if (left < 1000) return { ok: false, status: 429, reason: 'That’s all the demo calling for today. Try again tomorrow.' };
    const startedAt = this.#now();
    const current = { visitor, startedAt };
    this.#current = current;
    let finished = false;
    return {
      ok: true,
      maxMs: Math.min(this.#perCallMs, left),
      byBudget: left < this.#perCallMs,
      done: () => {
        if (finished) return;
        finished = true;
        this.#roll();
        this.#usedMs += Math.max(0, this.#now() - startedAt);
        if (this.#current === current) this.#current = undefined;
      },
    };
  }
}
