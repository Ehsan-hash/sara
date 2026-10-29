// Phase 67: the one way out of the server. Every outgoing request Sara makes goes through
// `netFetch` (HTTP), `openWebSocket` (WebSockets) or, for the few modules that need raw
// node:http(s)/http2/net connections, a `checkOutbound(url)` right before connecting
// (test/private-local.test.ts scans src/ for anything else).
//
// While "Nothing leaves this computer" (private local mode) is on, only loopback addresses are
// allowed: 127.0.0.0/8, ::1 (and ::ffff:127.x.y.z) and the name `localhost`. The decision is made
// from the URL's host *before* any DNS lookup, so a name that happens to resolve to a local
// address (or a DNS answer that changes) can't slip through: only literal loopback hosts pass.
// Everything else fails with a PrivateLocalError naming what was blocked.
//
// A loopback Ollama can still reach the internet on Sara's behalf (downloading a model, an
// Ollama Cloud model, its web search), so those requests are blocked too (`ollamaEgress`).

/** The error every blocked request fails with. `code` lets callers tell it apart. */
export class PrivateLocalError extends Error {
  readonly code = 'PRIVATE_LOCAL';
  readonly target: string;
  constructor(target: string, why?: string) {
    super(why ?? `Blocked by private local mode: ${target} is not on this computer. While "Nothing leaves this computer" is on, Sara only connects to this computer.`);
    this.name = 'PrivateLocalError';
    this.target = target;
  }
}

export const isPrivateLocalError = (err: unknown): err is PrivateLocalError => err instanceof PrivateLocalError || (Boolean(err) && (err as { code?: unknown }).code === 'PRIVATE_LOCAL');

let privateOn = false;
/** The real fetch, captured before anything can wrap the global one. Tests swap it with setNetTransport. */
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);
/** Sends through whatever the global fetch is now (tests may stub it), never through our own wrapper. */
const viaGlobal: typeof fetch = (input, init) => (globalThis.fetch === (guardedGlobal as unknown) ? (savedGlobal ?? realFetch) : globalThis.fetch)(input, init);
/** The global fetch that was there before the mode wrapped it (put back when the mode goes off). */
let savedGlobal: typeof fetch | undefined;
let transport: typeof fetch = viaGlobal;
/** Blocked attempts since start (shown on the settings page). */
const blocked: { at: string; target: string }[] = [];

/** Turns the guard on or off for the whole process (src/private-local.ts keeps the saved state). */
export function setPrivateLocal(on: boolean): void {
  privateOn = on;
  // Belt and braces: code that reaches for the global fetch directly (a future module, a
  // dependency of a script) goes through the same check while the mode is on.
  if (on && globalThis.fetch !== (guardedGlobal as unknown)) {
    savedGlobal = globalThis.fetch;
    globalThis.fetch = guardedGlobal as typeof fetch;
  } else if (!on && globalThis.fetch === (guardedGlobal as unknown)) {
    globalThis.fetch = savedGlobal ?? realFetch;
    savedGlobal = undefined;
  }
}

export const privateLocalOn = (): boolean => privateOn;

/** Tests: the function that really sends (a fake records what would have left). */
export function setNetTransport(f?: typeof fetch): void {
  transport = f ?? viaGlobal;
}

export function blockedRecently(): { at: string; target: string }[] {
  return blocked.slice(-20);
}

function noteBlocked(target: string): void {
  blocked.push({ at: new Date().toISOString(), target });
  if (blocked.length > 50) blocked.splice(0, blocked.length - 50);
}

/**
 * True for a literal loopback host: `localhost`, 127.0.0.0/8, ::1, ::ffff:127.x.y.z. Expects the
 * host as the URL parser gives it (`new URL(u).hostname`, which already turns `2130706433` or
 * `0x7f.1` into `127.0.0.1` and `[::ffff:127.0.0.1]` into `[::ffff:7f00:1]`).
 */
export function isLoopbackHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === 'localhost') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return Number(v4[1]) === 127 && v4.slice(2).every((x) => Number(x) <= 255);
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped loopback, in the forms the URL parser and people write.
  const mapped = /^(?:0:0:0:0:0:|::)ffff:(.+)$/.exec(h);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return isLoopbackHost(rest);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex) return parseInt(hex[1], 16) >> 8 === 127;
  }
  return false;
}

/** Schemes that never touch the network. */
const OFFLINE = new Set(['data:', 'blob:']);

function toUrl(target: string | URL): URL | undefined {
  try {
    return target instanceof URL ? target : new URL(String(target));
  } catch {
    return undefined;
  }
}

/** May a request to this address leave right now? (Always yes while the mode is off.) */
export function outboundAllowed(target: string | URL): boolean {
  if (!privateOn) return true;
  const u = toUrl(target);
  if (!u) return false;
  if (OFFLINE.has(u.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  return isLoopbackHost(u.hostname);
}

/** Throws PrivateLocalError unless the address is allowed. Call it right before connecting. */
export function checkOutbound(target: string | URL, what?: string): void {
  if (outboundAllowed(target)) return;
  const u = toUrl(target);
  const host = u ? u.host || u.protocol : String(target).slice(0, 80);
  noteBlocked(what ? `${what} (${host})` : host);
  throw new PrivateLocalError(what ? `${what} (${host})` : host);
}

/**
 * For things that reach the internet without a URL Sara could check (a program that talks to its
 * vendor: Claude Code, the Grok CLI, winget, the updater): refused while the mode is on.
 */
export function assertOnline(what: string): void {
  if (!privateOn) return;
  noteBlocked(what);
  throw new PrivateLocalError(what, `Paused in private local mode: ${what} needs the internet. Turn "Nothing leaves this computer" off to use it.`);
}

/** Ollama model names that run on Ollama's servers ("gpt-oss:120b-cloud", "beam:cloud"). */
const CLOUD_MODEL = /(:|-)cloud\b/i;

/**
 * Loopback requests that make a local model server reach the internet for us: downloading or
 * uploading a model, Ollama's web search/fetch, and any request naming an Ollama Cloud model.
 * Returns why it's blocked, or undefined.
 */
export function ollamaEgress(url: URL, body: unknown): string | undefined {
  const path = url.pathname.toLowerCase();
  if (/\/api\/(pull|push)\b/.test(path)) return 'Downloading a model needs the internet. Turn "Nothing leaves this computer" off for the download, then on again.';
  if (/web_(search|fetch)/.test(path)) return "Ollama's web search goes to ollama.com, which private local mode blocks.";
  if (typeof body === 'string' && body.length < 2_000_000 && /"model"\s*:/.test(body)) {
    const m = /"model"\s*:\s*"([^"]{1,200})"/.exec(body);
    if (m && CLOUD_MODEL.test(m[1])) return `${m[1]} is an Ollama Cloud model: it runs on Ollama's servers, not this computer.`;
  }
  return undefined;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** fetch() with the private-local-mode check. Use it everywhere instead of the global fetch. */
export async function netFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (privateOn) {
    const href = requestUrl(input);
    checkOutbound(href);
    const u = toUrl(href);
    const why = u && !OFFLINE.has(u.protocol) ? ollamaEgress(u, init?.body) : undefined;
    if (why) {
      noteBlocked(`${u!.host}${u!.pathname}`);
      throw new PrivateLocalError(`${u!.host}${u!.pathname}`, `Blocked by private local mode: ${why}`);
    }
  }
  return transport(input, init);
}

const guardedGlobal = (input: string | URL | Request, init?: RequestInit): Promise<Response> => netFetch(input, init);

/** A WebSocket (Node's built-in client) after the same check. */
export function openWebSocket(url: string, opts?: unknown): WebSocket {
  checkOutbound(url);
  return new WebSocket(url, opts as string[] | undefined);
}
