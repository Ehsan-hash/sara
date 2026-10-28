// Phase 59: first sign-in in the browser ("claiming" a new server), so app-store installs (Umbrel,
// CasaOS, TrueNAS, Unraid) don't need anyone to read a long token out of a log.
//
// A brand-new server has an owner token nobody has used yet (OwnerAuth.setupPending). While that
// is so, and only for a while after each start, the browser can claim the server:
//   - mode "code" (the default): the visitor types the short setup code printed in the server log
//     (8 letters/digits, new at every start). The request must come from this machine or a private
//     network address. Ten wrong codes in total (from anywhere) close setup until a restart.
//   - mode "browser" (SARA_SETUP=browser): no code. Only for templates where a login-protected proxy
//     stands in front of /api/claim (Umbrel's app proxy asks for the Umbrel login first). The
//     private-address rule and the time window still apply.
//   - mode "off" (SARA_SETUP=off): only the owner token works, as before Phase 59.
// Claiming makes a NEW owner token (the one in the log stops working), shows it once and signs the
// browser in. Any sign-in with the owner token also ends setup for good. See docs/THREAT_MODEL.md
// ("First sign-in in the browser").
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export type ClaimMode = 'browser' | 'code' | 'off';

/** Minutes after each start during which setup is open (SARA_SETUP_MINUTES, 5–1440). */
export const CLAIM_WINDOW_MINUTES = 60;
/** Wrong setup codes (from every address together) before setup closes until the next start. */
export const CLAIM_MAX_FAILURES = 10;
/** Setup-code letters: no 0/O, 1/I/L or U, so it reads and types without mix-ups (30 symbols). */
export const CLAIM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CLAIM_CODE_LENGTH = 8;

/** The setup mode from the environment (SARA_SETUP); the demo server never has one. */
export function claimModeFrom(env: NodeJS.ProcessEnv): ClaimMode {
  if (env.SARA_DEMO === '1') return 'off';
  const v = (env.SARA_SETUP ?? '').trim().toLowerCase();
  return v === 'browser' ? 'browser' : v === 'off' || v === '0' || v === 'token' ? 'off' : 'code';
}

/** The window from SARA_SETUP_MINUTES, clamped to 5 minutes – 24 hours. */
export function claimWindowMs(env: NodeJS.ProcessEnv): number {
  const n = Number(env.SARA_SETUP_MINUTES);
  const minutes = Number.isFinite(n) && n > 0 ? Math.min(1440, Math.max(5, Math.round(n))) : CLAIM_WINDOW_MINUTES;
  return minutes * 60_000;
}

/** Upper-case, without spaces or dashes: what the owner typed, as compared. */
export function normalizeClaimCode(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** ABCD-EFGH (how it is printed and shown). */
export function formatClaimCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * This machine or a private network: loopback, RFC 1918, link-local, carrier-grade NAT (Tailscale
 * addresses are in 100.64/10), IPv6 unique-local and link-local. Anything else is the internet.
 */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '').replace(/%.*$/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    if ([x, y, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  if (!a.includes(':')) return false;
  if (a === '::1') return true;
  const first = parseInt(a.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

export interface ClaimStatus {
  /** Setup in the browser can be used now. */
  open: boolean;
  mode?: 'browser' | 'code';
  /** Whole minutes left (open only). */
  minutesLeft?: number;
  /** Why it closed while the server still has no owner: the window ran out, or too many wrong codes. */
  closed?: 'expired' | 'locked';
}

export type ClaimCheck = { ok: true } | { ok: false; status: 401 | 403 | 404; message: string; wrongCode?: boolean };

export class FirstClaim {
  readonly mode: ClaimMode;
  /** The plain setup code, for the start-up banner (undefined when there is nothing to claim). */
  readonly code: string | undefined;
  readonly #hash: Buffer | undefined;
  readonly #until: number;
  readonly #pending: () => boolean;
  readonly #now: () => number;
  #failures = 0;
  #done = false;

  constructor(o: { pending: () => boolean; mode: ClaimMode; windowMs?: number; now?: () => number; code?: string }) {
    this.mode = o.mode;
    this.#pending = o.pending;
    this.#now = o.now ?? Date.now;
    this.#until = this.#now() + (o.windowMs ?? CLAIM_WINDOW_MINUTES * 60_000);
    if (o.mode !== 'off' && o.pending()) {
      const code = o.code ?? Array.from({ length: CLAIM_CODE_LENGTH }, () => CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)]).join('');
      this.code = code;
      this.#hash = createHash('sha256').update(code).digest();
    }
  }

  /** What the sign-in page may know. Nothing at all once the server has an owner. */
  status(): ClaimStatus {
    if (this.mode === 'off' || this.#done || !this.#hash || !this.#pending()) return { open: false };
    const mode = this.mode;
    if (this.#failures >= CLAIM_MAX_FAILURES) return { open: false, mode, closed: 'locked' };
    const left = this.#until - this.#now();
    if (left <= 0) return { open: false, mode, closed: 'expired' };
    return { open: true, mode, minutesLeft: Math.max(1, Math.ceil(left / 60_000)) };
  }

  /** May this request claim the server? (Counts nothing; call failed() after a wrong code.) */
  check(ip: string, code: unknown): ClaimCheck {
    const st = this.status();
    if (!st.open) {
      const message =
        st.closed === 'expired'
          ? 'Setup in the browser has timed out. Restart Sara to open it again (with a new setup code), or sign in with the owner token from her log.'
          : st.closed === 'locked'
            ? 'Too many wrong setup codes. Restart Sara for a new code, or sign in with the owner token from her log.'
            : 'This server already has an owner. Sign in with the owner token.';
      return { ok: false, status: 404, message };
    }
    if (!isPrivateAddress(ip)) return { ok: false, status: 403, message: 'Setup in the browser only works from this machine or your home network. Sign in with the owner token from her log instead.' };
    if (this.mode === 'browser' && (code === undefined || code === null || code === '')) return { ok: true };
    const given = normalizeClaimCode(String(code ?? ''));
    const ok = given.length === CLAIM_CODE_LENGTH && timingSafeEqual(createHash('sha256').update(given).digest(), this.#hash!);
    return ok ? { ok: true } : { ok: false, status: 401, message: 'That setup code is wrong. It is in her log, next to the words "setup code".', wrongCode: true };
  }

  /** A wrong code: counts toward the limit for everyone together. */
  failed(): void {
    this.#failures++;
  }

  /** Claimed: closed for this run (the owner file no longer says setupPending either). */
  finish(): void {
    this.#done = true;
  }
}
