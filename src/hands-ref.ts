// Phase 87 (computer use CU1, docs/design/COMPUTER_USE.md §10.2): the reference hands device in
// TypeScript. It speaks the hands protocol (src/hands.ts) to a Sara server with a `hands` token and
// drives its own Chromium-family browser (its own profile, DevTools over a pipe, never a port), so
// the server's tests, evals and the conformance script (scripts/hands-conformance.ts) run without a
// desktop, and it is what the Linux hands become later (CU8). The Windows and Mac apps implement the
// same protocol and command set natively; all three run the one page agent
// (desktop/shared/page-agent.js) for reading pages.
//
// What it does on its own, whatever the server asks (§2, §4.1, §7.7):
// - only its own command set (CU1: look, read, navigate, pictures, logs); anything else is refused
//   with `unsupported`;
// - only http(s) addresses; never the Sara server's own origin (except its /preview/<token>/ links),
//   chrome://, edge://, file://, devtools or extension pages, even when a page redirects there;
// - at most 20 tab opens a minute and one live-view picture per 500 ms;
// - password fields never give their value (the page agent), and text that looks like a secret is
//   masked in what goes back.
//
// Run by hand: node src/hands-ref.ts --server http://127.0.0.1:7881 --token-file <file> [--name X] [--visible] [--local-only]
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { findBrowser, pageAgentCall, type BrowserInfo } from './browser.ts';
import { CdpClient, type CdpEvent } from './cdp.ts';
import { CU1_OPS, HANDS_PROTOCOL, packBinary } from './hands.ts';
import { connectWebSocket, type WsConnection } from './ws.ts';

export const REF_VERSION = 'hands-ref 1';
const OPS = new Set<string>(CU1_OPS);
const BACKOFF_S = [1, 2, 5, 10, 30];
const MAX_LOGS = 500;
const SECRET_SHAPES = [/\bsk-[A-Za-z0-9_-]{16,}/g, /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bxai-[A-Za-z0-9]{20,}/g, /\bsara_(?:dev|hands|m)\.[\w-]+\.[\w-]+/g, /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g];
export const maskSecrets = (s: string): string => SECRET_SHAPES.reduce((t, re) => t.replace(re, '[hidden]'), s);

class OpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Whether the Sara browser may load an address (the device's own rule, §4.1). */
export function addressAllowed(raw: string, serverOrigin: string): { ok: true; url: URL } | { ok: false; why: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: 'That is not a web address.' };
  }
  if (u.href === 'about:blank') return { ok: true, url: u };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, why: `The Sara browser doesn't open ${u.protocol} addresses.` };
  if (u.username || u.password) return { ok: false, why: 'Addresses with a user name or password are not opened.' };
  if (serverOrigin && u.origin === serverOrigin && !/^\/preview\/[0-9a-f]{32}(\/|$)/.test(u.pathname)) return { ok: false, why: "Sara's own server is never opened in the Sara browser." };
  return { ok: true, url: u };
}

// ---- DevTools over a pipe (--remote-debugging-pipe: the browser reads fd 3, writes fd 4, NUL-separated) ----
class PipeConnection implements WsConnection {
  onMessage?: (data: string | Buffer) => void;
  onClose?: (code: number) => void;
  #open = true;
  #buf = '';
  readonly #out: Writable;
  constructor(out: Writable, inp: Readable) {
    this.#out = out;
    inp.setEncoding('utf8');
    inp.on('data', (chunk: string) => {
      this.#buf += chunk;
      let i: number;
      while ((i = this.#buf.indexOf('\0')) >= 0) {
        const msg = this.#buf.slice(0, i);
        this.#buf = this.#buf.slice(i + 1);
        this.onMessage?.(msg);
      }
    });
    const end = () => {
      if (!this.#open) return;
      this.#open = false;
      this.onClose?.(1006);
    };
    inp.on('end', end);
    inp.on('error', end);
    out.on('error', end);
  }
  get open(): boolean {
    return this.#open;
  }
  send(data: string | Buffer): void {
    if (this.#open) this.#out.write(`${String(data)}\0`);
  }
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#out.end();
    this.onClose?.(1000);
  }
}

interface Tab {
  id: string;
  targetId: string;
  sessionId: string;
  frameId: string;
  logs: Record<string, unknown>[];
  consoleErrors: number;
  failedRequests: number;
  status: number;
  methods: Map<string, { method: string; url: string }>;
}

/** The Sara browser on this computer: own profile, launched on first use, driven over a pipe. */
export class SaraBrowser {
  readonly info: BrowserInfo;
  readonly headless: boolean;
  readonly serverOrigin: string;
  #profile: string;
  readonly #tempProfile: boolean;
  #child?: ChildProcess;
  cdp?: CdpClient;
  readonly tabs = new Map<string, Tab>();
  #active = '';
  #tabN = 0;
  #seq = 0;
  readonly #opens: number[] = [];

  constructor(opts: { info?: BrowserInfo; headless?: boolean; profileDir?: string; serverOrigin: string }) {
    this.info = opts.info ?? findBrowser();
    this.headless = opts.headless !== false;
    this.serverOrigin = opts.serverOrigin;
    this.#tempProfile = !opts.profileDir;
    this.#profile = opts.profileDir ?? mkdtempSync(join(tmpdir(), 'sara-hands-'));
  }

  get running(): boolean {
    return Boolean(this.cdp && !this.cdp.closed);
  }

  args(): string[] {
    return [
      ...(this.headless ? ['--headless=new'] : []),
      `--user-data-dir=${this.#profile}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-breakpad',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      // Never the browser account: no implicit sign-in to the computer's Microsoft/Google account, no sync.
      '--disable-features=Translate,MediaRouter,OptimizationHints,msEdgeSync,msImplicitSignin,msSignInFRE,EdgeCollections,msShopping,msEdgeShoppingUI',
      '--window-size=1280,800',
      ...(this.headless && this.info.kind === 'edge' ? ['--inprivate'] : []),
      // Edge's launcher may start a second copy of itself and exit (its "compat layer" relaunch),
      // which would drop the DevTools pipe: ask it not to.
      ...(this.info.kind === 'edge' ? ['--edge-skip-compat-layer-relaunch'] : []),
      'about:blank',
    ];
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.info.found || !this.info.path) throw new OpError('perm_missing', `No Chromium-family browser on this computer. ${this.info.how}`);
    const child = spawn(this.info.path, this.args(), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: this.headless });
    this.#child = child;
    child.on('error', () => {});
    const conn = new PipeConnection(child.stdio[3] as Writable, child.stdio[4] as Readable);
    this.cdp = new CdpClient(conn);
    this.cdp.on((ev) => this.#event(ev));
    // The first page may take a moment to appear.
    let pages: { targetId: string; type: string; url: string }[] = [];
    for (let i = 0; i < 40 && !pages.length; i++) {
      const r = (await this.cdp.send('Target.getTargets', {}, undefined, 10_000)) as { targetInfos: { targetId: string; type: string; url: string }[] };
      pages = r.targetInfos.filter((t) => t.type === 'page');
      if (!pages.length) await new Promise((r2) => setTimeout(r2, 150));
    }
    for (const p of pages) await this.#attach(p.targetId);
    if (!this.tabs.size) await this.newTab();
  }

  async #attach(targetId: string): Promise<Tab> {
    const cdp = this.cdp!;
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    const tab: Tab = { id: `t${++this.#tabN}`, targetId, sessionId, frameId: '', logs: [], consoleErrors: 0, failedRequests: 0, status: 0, methods: new Map() };
    this.tabs.set(tab.id, tab);
    for (const d of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await cdp.send(d, {}, sessionId);
    // §4.1: the server's own origin is refused even when a page sends the browser there.
    if (this.serverOrigin) await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${this.serverOrigin}/*` }] }, sessionId);
    const tree = (await cdp.send('Page.getFrameTree', {}, sessionId)) as { frameTree: { frame: { id: string } } };
    tab.frameId = tree.frameTree.frame.id;
    this.#active = tab.id;
    return tab;
  }

  async newTab(): Promise<Tab> {
    const { targetId } = (await this.cdp!.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    return this.#attach(targetId);
  }

  tab(id?: unknown): Tab {
    const want = String(id ?? '');
    // The current tab, or (after it was closed) the newest one left.
    const t = this.tabs.get(want || this.#active) ?? (want ? undefined : [...this.tabs.values()].at(-1));
    if (!t) throw new OpError('not_found', id ? `No tab ${String(id)} (pc_browser_tabs lists them).` : 'No tab is open.');
    return t;
  }

  activate(t: Tab): void {
    this.#active = t.id;
  }

  /** §7.7: at most 20 tab opens or page loads a minute. */
  countOpen(): void {
    const now = Date.now();
    while (this.#opens.length && now - this.#opens[0] > 60_000) this.#opens.shift();
    if (this.#opens.length >= 20) throw new OpError('rate_limited', 'At most 20 pages a minute in the Sara browser.');
    this.#opens.push(now);
  }

  #tabOf(sessionId?: string): Tab | undefined {
    for (const t of this.tabs.values()) if (t.sessionId === sessionId) return t;
    return undefined;
  }

  #log(t: Tab, e: Record<string, unknown>): void {
    t.logs.push({ seq: ++this.#seq, at: new Date().toISOString(), ...e });
    if (t.logs.length > MAX_LOGS) t.logs.splice(0, t.logs.length - MAX_LOGS);
  }

  #event(ev: CdpEvent): void {
    if (ev.method === 'Target.detachedFromTarget') {
      for (const [id, t] of this.tabs) if (t.sessionId === ev.params.sessionId) this.tabs.delete(id);
      return;
    }
    const t = this.#tabOf(ev.sessionId);
    if (!t) return;
    const p = ev.params;
    const short = (s: unknown) => maskSecrets(String(s ?? '')).replace(/\s+/g, ' ').slice(0, 500);
    switch (ev.method) {
      case 'Fetch.requestPaused': {
        const url = String((p.request as { url?: string })?.url ?? '');
        const ok = addressAllowed(url, this.serverOrigin).ok;
        void this.cdp!.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' }, t.sessionId).catch(() => {});
        if (!ok) this.#log(t, { kind: 'network', method: 'GET', url: short(url), error: 'blocked by the Sara browser (Sara\u2019s own server)', type: String((p as { resourceType?: string }).resourceType ?? '') });
        return;
      }
      case 'Runtime.consoleAPICalled': {
        const type = String(p.type);
        if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
        const args = (p.args as { value?: unknown; description?: string }[]) ?? [];
        const frame = ((p.stackTrace as { callFrames?: { url?: string; lineNumber?: number }[] })?.callFrames ?? [])[0];
        if (type !== 'warning') t.consoleErrors++;
        this.#log(t, { kind: 'console', level: type === 'warning' ? 'warning' : 'error', text: short(args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ''))).join(' ')), ...(frame?.url ? { url: short(frame.url), line: Number(frame.lineNumber ?? 0) + 1 } : {}) });
        return;
      }
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails as { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } } | undefined;
        t.consoleErrors++;
        this.#log(t, { kind: 'exception', text: short(d?.exception?.description?.split('\n')[0] ?? d?.text ?? 'error'), ...(d?.url ? { url: short(d.url), line: Number(d.lineNumber ?? 0) + 1 } : {}) });
        return;
      }
      case 'Log.entryAdded': {
        const e = p.entry as { level?: string; text?: string; url?: string; source?: string } | undefined;
        if (!e || (e.level !== 'error' && e.level !== 'warning') || /\/favicon\.ico$/.test(e.url ?? '')) return;
        // Failed requests are reported once, from the network events.
        if (e.source === 'network') return;
        if (e.level === 'error') t.consoleErrors++;
        this.#log(t, { kind: 'console', level: e.level, text: short(e.text), ...(e.url ? { url: short(e.url) } : {}) });
        return;
      }
      case 'Network.requestWillBeSent': {
        const rq = p.request as { method?: string; url?: string } | undefined;
        t.methods.set(String(p.requestId), { method: String(rq?.method ?? 'GET'), url: short(rq?.url) });
        if (t.methods.size > 2000) t.methods.delete(t.methods.keys().next().value!);
        return;
      }
      case 'Network.responseReceived': {
        const r = p.response as { status?: number; url?: string } | undefined;
        const status = Number(r?.status ?? 0);
        if (p.type === 'Document' && p.frameId === t.frameId) t.status = status;
        if (status >= 400 && !/\/favicon\.ico$/.test(r?.url ?? '')) {
          t.failedRequests++;
          this.#log(t, { kind: 'network', method: t.methods.get(String(p.requestId))?.method ?? 'GET', url: short(r?.url), status, type: String(p.type ?? ''), requestId: String(p.requestId) });
        }
        return;
      }
      case 'Network.loadingFailed': {
        if (p.canceled || p.blockedReason === 'inspector') return;
        t.failedRequests++;
        const was = t.methods.get(String(p.requestId));
        this.#log(t, { kind: 'network', method: was?.method ?? 'GET', url: was?.url ?? '', error: short(p.errorText), type: String(p.type ?? ''), requestId: String(p.requestId) });
        return;
      }
    }
  }

  /** Runs one page-agent function in an isolated world (the page's own scripts can't touch it). */
  async agent<T>(t: Tab, fn: 'snapshot' | 'text', args: Record<string, unknown>): Promise<T> {
    const tree = (await this.cdp!.send('Page.getFrameTree', {}, t.sessionId)) as { frameTree: { frame: { id: string } } };
    t.frameId = tree.frameTree.frame.id;
    const w = (await this.cdp!.send('Page.createIsolatedWorld', { frameId: t.frameId, worldName: 'sara-page-agent' }, t.sessionId)) as { executionContextId: number };
    const r = (await this.cdp!.send('Runtime.evaluate', { expression: pageAgentCall(fn, args), contextId: w.executionContextId, returnByValue: true }, t.sessionId)) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (r.exceptionDetails) throw new OpError('error', `The page couldn't be read: ${r.exceptionDetails.text ?? 'script error'}`);
    return r.result?.value as T;
  }

  async info2(t: Tab): Promise<{ url: string; title: string }> {
    const r = (await this.cdp!.send('Target.getTargetInfo', { targetId: t.targetId })) as { targetInfo: { url: string; title: string } };
    return { url: r.targetInfo.url, title: maskSecrets(r.targetInfo.title) };
  }

  /** A JPEG of the visible page, scaled to at most `maxWidth` pixels wide. */
  async shot(t: Tab, maxWidth: number, quality: number): Promise<{ data: Buffer; w: number; h: number }> {
    const m = (await this.cdp!.send('Page.getLayoutMetrics', {}, t.sessionId)) as { cssVisualViewport?: { clientWidth: number; clientHeight: number } };
    const vw = Math.max(1, Math.round(m.cssVisualViewport?.clientWidth ?? 1280));
    const vh = Math.max(1, Math.round(m.cssVisualViewport?.clientHeight ?? 800));
    const scale = Math.min(1, maxWidth / vw);
    const r = (await this.cdp!.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: vw, height: vh, scale } }, t.sessionId, 30_000)) as { data: string };
    return { data: Buffer.from(r.data, 'base64'), w: Math.round(vw * scale), h: Math.round(vh * scale) };
  }

  async waitLoad(t: Tab, start: () => Promise<unknown>, ms = 30_000): Promise<void> {
    const loaded = this.cdp!.waitFor((ev) => ev.sessionId === t.sessionId && ev.method === 'Page.loadEventFired', ms);
    await start();
    await loaded;
    await new Promise((r) => setTimeout(r, 250));
  }

  nextSeq(): number {
    return this.#seq;
  }

  async close(): Promise<void> {
    try {
      await this.cdp?.send('Browser.close', {}, undefined, 3000);
    } catch {
      /* gone */
    }
    this.cdp?.close();
    const child = this.#child;
    if (child?.pid && child.exitCode === null) {
      await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 3000))]);
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }
    this.tabs.clear();
    if (this.#tempProfile) setTimeout(() => rmSync(this.#profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }), 800).unref();
  }
}

export interface HandsRefOptions {
  /** The Sara server, e.g. http://127.0.0.1:7881. */
  server: string;
  token: string;
  name?: string;
  info?: BrowserInfo;
  headless?: boolean;
  profileDir?: string;
  localOnly?: boolean;
  optIn?: { browser: boolean };
  /** Tests: reconnect after a dropped connection (default true). */
  reconnect?: boolean;
  log?: (line: string) => void;
}

/** The reference hands device: connects, says hello, runs ops, reconnects. */
export class HandsRef {
  readonly opts: HandsRefOptions;
  readonly browser: SaraBrowser;
  ws?: WsConnection;
  #stopped = false;
  #attempt = 0;
  #timer?: NodeJS.Timeout;
  readonly #answers = new Map<string, string>();
  readonly #running = new Map<string, AbortController>();
  readonly #lastFrameAt = { at: 0, hash: '' };
  #frameN = 0;
  /** Every op the server asked for (tests read it). */
  readonly seen: string[] = [];
  connects = 0;

  constructor(opts: HandsRefOptions) {
    this.opts = opts;
    this.browser = new SaraBrowser({ ...(opts.info ? { info: opts.info } : {}), headless: opts.headless !== false, ...(opts.profileDir ? { profileDir: opts.profileDir } : {}), serverOrigin: new URL(opts.server).origin });
  }

  get connected(): boolean {
    return Boolean(this.ws?.open);
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
  }

  async #connect(): Promise<void> {
    const u = new URL('/api/hands', this.opts.server);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      const ws = await connectWebSocket(u.toString(), { headers: { Authorization: `Bearer ${this.opts.token}` }, timeoutMs: 10_000 });
      this.ws = ws;
      this.connects++;
      this.#attempt = 0;
      ws.onMessage = (d) => {
        if (typeof d === 'string') void this.#message(ws, d);
      };
      ws.onClose = () => {
        if (this.ws === ws) this.ws = undefined;
        for (const ac of this.#running.values()) ac.abort();
        this.#later();
      };
      ws.send(JSON.stringify(this.hello()));
      this.opts.log?.(`connected to ${this.opts.server}`);
    } catch (err) {
      this.opts.log?.(`couldn't connect: ${(err as Error).message}`);
      this.#later();
      if (this.#attempt === 1) throw err;
    }
  }

  #later(): void {
    if (this.#stopped || this.opts.reconnect === false) return;
    const s = BACKOFF_S[Math.min(this.#attempt++, BACKOFF_S.length - 1)];
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#connect().catch(() => {}), s * 1000);
    this.#timer.unref?.();
  }

  hello(): Record<string, unknown> {
    return {
      t: 'hello',
      v: HANDS_PROTOCOL,
      app: REF_VERSION,
      os: `${process.platform} ${process.arch}`,
      computer: this.opts.name ?? hostname(),
      screens: [],
      browser: { found: this.browser.info.found, ...(this.browser.info.kind ? { kind: this.browser.info.kind } : {}), ...(this.browser.info.name ? { name: this.browser.info.name } : {}) },
      perms: { capture: false, input: false, ax: false },
      optIn: { browser: this.opts.optIn?.browser !== false, desktop: false },
      approvalsHere: false,
      logins: [],
      busy: false,
      localOnly: this.opts.localOnly === true,
      ops: [...OPS],
    };
  }

  /** Stop pressed on the computer: everything running is cancelled and the server is told. */
  pressStop(): void {
    for (const ac of this.#running.values()) ac.abort();
    this.ws?.send(JSON.stringify({ t: 'ev', kind: 'stopped', by: 'user' }));
  }

  /** Tests: the connection drops (the device reconnects by itself). */
  dropConnection(): void {
    this.ws?.close(1001, 'test');
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.ws?.close(1000, 'bye');
    await this.browser.close();
  }

  async #message(ws: WsConnection, raw: string): Promise<void> {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (m.t === 'cancel') {
      if (m.all) for (const ac of this.#running.values()) ac.abort();
      else this.#running.get(String(m.id))?.abort();
      return;
    }
    if (m.t !== 'req') return;
    const id = String(m.id ?? '');
    if (!id) return;
    // Idempotent by id: a retried request gets the first answer.
    const done = this.#answers.get(id);
    if (done) return ws.send(done);
    if (this.#running.has(id)) return;
    const op = String(m.op ?? '');
    this.seen.push(op);
    const ac = new AbortController();
    this.#running.set(id, ac);
    const deadline = Math.min(Math.max(1000, Number(m.deadlineMs) || 30_000), 120_000);
    const timer = setTimeout(() => ac.abort(new OpError('timeout', `Took longer than ${Math.round(deadline / 1000)} s.`)), deadline);
    let reply: Record<string, unknown>;
    try {
      if (!OPS.has(op)) throw new OpError('unsupported', `This computer doesn't do "${op.slice(0, 40)}" (not in its command set).`);
      if (op.startsWith('b.') && this.opts.optIn?.browser === false) throw new OpError('denied_local', '"Let Sara use this computer" is off here.');
      const args = (m.args && typeof m.args === 'object' ? m.args : {}) as Record<string, unknown>;
      const result = await Promise.race([
        this.#run(ws, id, op, args),
        new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(ac.signal.reason instanceof OpError ? ac.signal.reason : new OpError('stopped', 'Stopped.')), { once: true })),
      ]);
      reply = { t: 'res', id, ok: true, result };
    } catch (err) {
      const e = err instanceof OpError ? err : new OpError('error', (err as Error).message);
      reply = { t: 'res', id, ok: false, error: { code: e.code, message: maskSecrets(e.message).slice(0, 500) } };
    } finally {
      clearTimeout(timer);
      this.#running.delete(id);
    }
    const text = JSON.stringify(reply);
    this.#answers.set(id, text);
    if (this.#answers.size > 100) this.#answers.delete(this.#answers.keys().next().value!);
    if (ws.open) ws.send(text);
  }

  #image(ws: WsConnection, header: Record<string, unknown>, data: Buffer): void {
    if (ws.open) ws.send(packBinary(header, data));
  }

  /** §3.5: a live-view frame after a change (at most one per 500 ms, only when the picture changed). */
  async #frame(ws: WsConnection, tab: Tab): Promise<void> {
    if (Date.now() - this.#lastFrameAt.at < 500) return;
    try {
      const s = await this.browser.shot(tab, 960, 60);
      const hash = createHash('sha1').update(s.data).digest('hex');
      if (hash === this.#lastFrameAt.hash) return;
      this.#lastFrameAt.at = Date.now();
      this.#lastFrameAt.hash = hash;
      this.#image(ws, { frame: ++this.#frameN, mime: 'image/jpeg', w: s.w, h: s.h }, s.data);
    } catch {
      /* a frame is best effort */
    }
  }

  async #thumb(ws: WsConnection, id: string, tab: Tab, args: Record<string, unknown>): Promise<void> {
    const w = Number(args.thumb);
    if (!(w >= 64 && w <= 640)) return;
    try {
      const s = await this.browser.shot(tab, w, 55);
      this.#image(ws, { id, kind: 'thumb', mime: 'image/jpeg', w: s.w, h: s.h }, s.data);
    } catch {
      /* best effort */
    }
  }

  async #run(ws: WsConnection, id: string, op: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const b = this.browser;
    if (op === 'c.ping') return { pong: true, at: new Date().toISOString() };
    if (op !== 'b.tabs' || b.running) await b.start();
    const tabsView = async () => Promise.all([...b.tabs.values()].map(async (t) => ({ tab: t.id, ...(await b.info2(t)), active: t === b.tab() })));
    switch (op) {
      case 'b.start':
        return { browser: { kind: b.info.kind ?? null, name: b.info.name ?? null }, tabs: await tabsView() };
      case 'b.tabs':
        return { tabs: b.running ? await tabsView() : [] };
      case 'b.open': {
        const check = addressAllowed(String(args.url ?? ''), b.serverOrigin);
        if (!check.ok) throw new OpError('denied_local', check.why);
        b.countOpen();
        const t = args.newTab === true || !b.tabs.size ? await b.newTab() : b.tab();
        b.activate(t);
        t.consoleErrors = 0;
        t.failedRequests = 0;
        t.status = 0;
        // A newly opened page starts with its own logs (the numbers keep counting up).
        t.logs.length = 0;
        let navError = '';
        await b.waitLoad(t, async () => {
          const r = (await b.cdp!.send('Page.navigate', { url: check.url.href }, t.sessionId)) as { errorText?: string };
          navError = r.errorText ?? '';
        });
        if (navError) throw new OpError('not_found', `The page didn't open: ${navError}`);
        const info = await b.info2(t);
        await this.#thumb(ws, id, t, args);
        void this.#frame(ws, t);
        return { tab: t.id, url: info.url, title: info.title, status: t.status, consoleErrors: t.consoleErrors, failedRequests: t.failedRequests };
      }
      case 'b.navigate': {
        const t = b.tab(args.tab);
        b.activate(t);
        const action = String(args.action ?? 'reload');
        if (action === 'reload') {
          t.consoleErrors = 0;
          t.failedRequests = 0;
          await b.waitLoad(t, () => b.cdp!.send('Page.reload', {}, t.sessionId));
        } else if (action === 'back' || action === 'forward') {
          const h = (await b.cdp!.send('Page.getNavigationHistory', {}, t.sessionId)) as { currentIndex: number; entries: { id: number; url: string }[] };
          const e = h.entries[h.currentIndex + (action === 'back' ? -1 : 1)];
          if (!e) throw new OpError('not_found', `There is no page to go ${action} to.`);
          if (!addressAllowed(e.url, b.serverOrigin).ok) throw new OpError('denied_local', "That page isn't opened in the Sara browser.");
          await b.waitLoad(t, () => b.cdp!.send('Page.navigateToHistoryEntry', { entryId: e.id }, t.sessionId), 15_000);
        } else throw new OpError('unsupported', 'action: back, forward or reload.');
        const info = await b.info2(t);
        await this.#thumb(ws, id, t, args);
        void this.#frame(ws, t);
        return { tab: t.id, url: info.url, title: info.title, consoleErrors: t.consoleErrors, failedRequests: t.failedRequests };
      }
      case 'b.snapshot': {
        const t = b.tab(args.tab);
        const r = await b.agent<Record<string, unknown>>(t, 'snapshot', { from: Number(args.from) || 0, limit: 400 });
        await this.#thumb(ws, id, t, args);
        return { tab: t.id, viewId: `v${Date.now().toString(36)}`, ...r, consoleErrors: t.consoleErrors, failedRequests: t.failedRequests };
      }
      case 'b.read': {
        const t = b.tab(args.tab);
        const r = await b.agent<Record<string, unknown>>(t, 'text', { ...(args.ref ? { ref: String(args.ref) } : {}), max: Number(args.max) || 8000 });
        if (r.error) throw new OpError('not_found', String(r.error));
        return { tab: t.id, ...r };
      }
      case 'b.screenshot': {
        const t = b.tab(args.tab);
        const s = await b.shot(t, Math.min(1920, Math.max(160, Number(args.maxWidth) || 1280)), Math.min(90, Math.max(30, Number(args.quality) || 70)));
        const viewId = `v${Date.now().toString(36)}`;
        this.#image(ws, { id, kind: 'shot', mime: 'image/jpeg', w: s.w, h: s.h, viewId }, s.data);
        return { tab: t.id, w: s.w, h: s.h, viewId };
      }
      case 'b.logs': {
        const t = b.tab(args.tab);
        const since = Number(args.since) || 0;
        const entries = t.logs.filter((e) => Number(e.seq) > since).slice(-200);
        return { tab: t.id, url: (await b.info2(t)).url, entries, last: b.nextSeq() };
      }
      case 'b.request': {
        const t = b.tab(args.tab);
        let r: { body: string; base64Encoded: boolean };
        try {
          r = (await b.cdp!.send('Network.getResponseBody', { requestId: String(args.requestId ?? '') }, t.sessionId)) as { body: string; base64Encoded: boolean };
        } catch {
          throw new OpError('not_found', 'That response is no longer kept by the browser (reload and look again).');
        }
        const entry = t.logs.find((e) => e.requestId === String(args.requestId));
        if (r.base64Encoded) return { status: entry?.status ?? null, mime: 'binary', body: '(not text)', truncated: false };
        const body = maskSecrets(r.body);
        return { status: entry?.status ?? null, mime: 'text', body: body.slice(0, 64 * 1024), truncated: body.length > 64 * 1024 };
      }
      case 'b.close': {
        const t = b.tab(args.tab);
        await b.cdp!.send('Target.closeTarget', { targetId: t.targetId });
        b.tabs.delete(t.id);
        return { closed: t.id };
      }
    }
    throw new OpError('unsupported', `This computer doesn't do "${op}".`);
  }
}

// ---- Run by hand (the Linux hands later; testing now) ----
if (process.argv[1] && /hands-ref\.ts$/.test(process.argv[1])) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const server = arg('--server');
  const tokenFile = arg('--token-file');
  if (!server || !tokenFile) {
    console.error('Usage: node src/hands-ref.ts --server http://127.0.0.1:7881 --token-file <file with the hands token> [--name NAME] [--visible] [--local-only]');
    process.exit(2);
  }
  const ref = new HandsRef({ server, token: readFileSync(tokenFile, 'utf8').trim(), ...(arg('--name') ? { name: arg('--name')! } : {}), headless: !process.argv.includes('--visible'), localOnly: process.argv.includes('--local-only'), log: (l) => console.log(`[hands-ref] ${l}`) });
  void ref.start().catch((err: Error) => console.error(`[hands-ref] ${err.message}`));
  const bye = () => void ref.stop().then(() => process.exit(0));
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
