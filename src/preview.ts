// Phase 49: live previews of the web apps she builds, served through Sara.
//
// Security model (docs/THREAT_MODEL.md, "Previews"): what runs in a preview is code she wrote, so
// it is treated as untrusted and never runs with the owner's Sara session.
// - Address: /preview/<128-bit random token>/… . The token is the only authorisation (never the
//   session cookie); it is bound to one workspace, one port and the background job that opened
//   that port, expires after 12 hours or when the job ends, and can be revoked.
// - Every response carries `Content-Security-Policy: sandbox …` (no allow-same-origin): the page
//   gets an opaque origin, so its scripts can't read Sara's cookies, storage or API, and Sara's
//   SameSite=Strict cookie isn't sent from it. The chat shows it in a sandboxed iframe too.
// - Only 127.0.0.1 / ::1, only a port that a process of her own job in that workspace listens on
//   (checked with the operating system, not taken from her word), never Sara's own port.
// - Requests are rebuilt, not passed through: a fixed list of safe headers (no cookies, no
//   authorization, no forwarding headers), a capped body sent with an exact length, the path
//   checked (no "..", no backslashes, no absolute addresses). Responses lose Set-Cookie and the
//   app's own framing/CORS headers.
// - Apps live under a sub-path, so HTML gets a <base href> and root-relative links rewritten;
//   redirects to the app itself are rewritten. WebSocket upgrades (hot reload) are refused.
import { randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Job } from './jobs.ts';
import { treeListensOn } from './ports.ts';

export const PREVIEW_TTL_MS = 12 * 60 * 60_000;
export const MAX_PREVIEW_BODY = 10 * 1024 * 1024;
const MAX_REWRITE = 5 * 1024 * 1024;
const MAX_RESPONSE = 100 * 1024 * 1024;
const MAX_PREVIEWS = 8;
/** How often a live preview re-checks that her job still owns the port. */
const RECHECK_MS = 30_000;

/** The CSP sandbox every preview response gets: scripts run, but in an opaque origin. */
export const PREVIEW_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

/**
 * Headers on every preview response. Framing: only by Sara's own page (same origin as the URL).
 * CORP is cross-origin on purpose: the page's origin is opaque, so even its own scripts and
 * images are cross-origin loads; the token in the path is what protects the content.
 */
export const PREVIEW_HEADERS: Record<string, string> = {
  'content-security-policy': `${PREVIEW_SANDBOX}; frame-ancestors 'self'`,
  'x-frame-options': 'SAMEORIGIN',
  'cross-origin-resource-policy': 'cross-origin',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=()',
  // Module scripts and fetch() from an opaque origin are CORS requests: allowed without
  // credentials (nothing here uses cookies).
  'access-control-allow-origin': '*',
};

/** Request headers passed on to the app (everything else, cookies included, is dropped). */
const FORWARD = new Set(['accept', 'accept-language', 'content-type', 'if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'range', 'user-agent', 'x-requested-with', 'cache-control', 'pragma']);
/** Response headers passed back from the app. */
const BACK = new Set(['content-type', 'content-length', 'content-encoding', 'content-language', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'vary', 'location', 'retry-after']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export class PreviewError extends Error {}

export interface Preview {
  token: string;
  conversationId: string;
  workspace: string;
  port: number;
  /** Page to open first ("/" or e.g. "/about.html"). */
  path: string;
  jobId: number;
  jobLabel: string;
  createdAt: number;
  expiresAt: number;
}

/** What the manager needs from the background jobs. */
export interface PreviewJobs {
  running(): Job[];
  pidOf(id: number): number | undefined;
}

interface Entry extends Preview {
  jobs: PreviewJobs;
  checkedAt: number;
  checking?: boolean;
}

export interface PreviewOptions {
  now?: () => number;
  ttlMs?: number;
  /** Does the process tree of `pid` listen on `port`? (Tests inject a stand-in.) */
  owns?: (pid: number, port: number) => Promise<boolean>;
  /** Ports Sara herself listens on (never previewed). */
  ownPorts?: () => number[];
}

/** Ports a job's output mentions (e.g. "Local: http://localhost:5173/"), most recent first. */
export function portsInOutput(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::)[:\s]+(\d{2,5})\b|\bport\s+(\d{2,5})\b/gi)) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 1024 && n <= 65535) out.push(n);
  }
  return [...new Set(out.reverse())];
}

export class PreviewManager {
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #owns: (pid: number, port: number) => Promise<boolean>;
  readonly #ownPorts: () => number[];

  constructor(opts: PreviewOptions = {}) {
    this.#now = opts.now ?? Date.now;
    this.#ttl = opts.ttlMs ?? PREVIEW_TTL_MS;
    this.#owns = opts.owns ?? ((pid, port) => treeListensOn(pid, port));
    this.#ownPorts = opts.ownPorts ?? (() => []);
  }

  /**
   * Phase 87: does one of her running jobs in `workspace` listen on `port` right now (the same OS
   * check as previews)? The Sara browser opens such a localhost address without asking.
   */
  async jobOwnsPort(port: number, workspace: string, jobs: PreviewJobs | undefined): Promise<boolean> {
    if (!jobs || !Number.isInteger(port) || port < 1 || port > 65535 || this.#ownPorts().includes(port)) return false;
    for (const job of jobs.running().filter((j) => j.workspace === workspace)) {
      const pid = jobs.pidOf(job.id);
      if (pid && (await this.#owns(pid, port).catch(() => false))) return true;
    }
    return false;
  }

  /**
   * Opens a preview of a port that one of her running jobs in `workspace` listens on. Without a
   * port, the newest port her jobs' output mentions is tried.
   */
  async start(spec: { conversationId: string; workspace: string; port?: number; path?: string; jobs: PreviewJobs | undefined }): Promise<Preview> {
    const path = cleanStartPath(spec.path);
    if (!spec.jobs) throw new PreviewError('Background jobs are not available here.');
    const jobs = spec.jobs.running().filter((j) => j.workspace === spec.workspace);
    if (!jobs.length) throw new PreviewError('Nothing is running in this workspace. Start the app first with start_job (for example "npx serve -l 5173" or "python3 -m http.server 5173 --bind 127.0.0.1"), then call preview_start with its port.');
    let ports: number[];
    if (spec.port !== undefined) {
      if (!Number.isInteger(spec.port) || spec.port < 1024 || spec.port > 65535) throw new PreviewError('Pick a port between 1024 and 65535.');
      ports = [spec.port];
    } else {
      ports = [...new Set(jobs.flatMap((j) => portsInOutput(j.tail)))];
      if (!ports.length) throw new PreviewError("I couldn't find a port in your jobs' output yet. Say which port the app listens on.");
    }
    for (const port of ports) {
      if (this.#ownPorts().includes(port)) throw new PreviewError("That's Sara's own port; previews are only for apps you run.");
      for (const job of jobs) {
        const pid = spec.jobs.pidOf(job.id);
        if (!pid || !(await this.#owns(pid, port))) continue;
        // One preview per workspace and port: a new one replaces the old link.
        for (const [t, e] of this.#entries) if (e.workspace === spec.workspace && e.port === port) this.#entries.delete(t);
        this.#sweep();
        if (this.#entries.size >= MAX_PREVIEWS) throw new PreviewError(`Already ${MAX_PREVIEWS} previews open; stop one first (preview_stop).`);
        const now = this.#now();
        const entry: Entry = { token: randomBytes(16).toString('hex'), conversationId: spec.conversationId, workspace: spec.workspace, port, path, jobId: job.id, jobLabel: job.label.slice(0, 120), createdAt: now, expiresAt: now + this.#ttl, jobs: spec.jobs, checkedAt: now };
        this.#entries.set(entry.token, entry);
        return view(entry);
      }
    }
    throw new PreviewError(
      `${spec.port !== undefined ? `Port ${spec.port} isn't` : `None of the ports in your jobs' output (${ports.join(', ')}) is`} opened by one of your running background jobs in this workspace. The app must run as a background job (start_job) and listen on 127.0.0.1${spec.port !== undefined ? `:${spec.port}` : ''}; check it with job_status${process.platform === 'linux' ? ' (and that commands may use the network: previews need it)' : ''}.`,
    );
  }

  /** A live preview, or undefined (unknown, expired, revoked, or its job ended). */
  get(token: string): Preview | undefined {
    const e = this.#live(token);
    return e ? view(e) : undefined;
  }

  #live(token: string): Entry | undefined {
    if (!/^[0-9a-f]{32}$/.test(token)) return undefined;
    const e = this.#entries.get(token);
    if (!e) return undefined;
    if (this.#now() >= e.expiresAt || !e.jobs.pidOf(e.jobId)) {
      this.#entries.delete(token);
      return undefined;
    }
    // Every so often: is her job still the one listening there? (Checked in the background.)
    if (this.#now() - e.checkedAt > RECHECK_MS && !e.checking) {
      e.checking = true;
      const pid = e.jobs.pidOf(e.jobId);
      void (pid ? this.#owns(pid, e.port) : Promise.resolve(false)).then((ok) => {
        e.checking = false;
        e.checkedAt = this.#now();
        if (!ok) this.#entries.delete(e.token);
      });
    }
    return e;
  }

  list(filter: { workspace?: string; conversationId?: string } = {}): Preview[] {
    this.#sweep();
    return [...this.#entries.values()].filter((e) => (!filter.workspace || e.workspace === filter.workspace) && (!filter.conversationId || e.conversationId === filter.conversationId)).map(view);
  }

  stop(token: string): boolean {
    return this.#entries.delete(token);
  }

  /** Closes previews in a workspace (one port, or all). Returns how many. */
  stopWhere(workspace: string, port?: number): number {
    let n = 0;
    for (const [t, e] of this.#entries) {
      if (e.workspace === workspace && (port === undefined || e.port === port)) {
        this.#entries.delete(t);
        n++;
      }
    }
    return n;
  }

  /** A job ended: its previews close with it. */
  jobEnded(jobId: number, jobs?: PreviewJobs): void {
    for (const [t, e] of this.#entries) if (e.jobId === jobId && (!jobs || e.jobs === jobs)) this.#entries.delete(t);
  }

  #sweep(): void {
    for (const t of [...this.#entries.keys()]) this.#live(t);
  }

  /**
   * Serves /preview/<token>/… (Sara's server, and the testing browser's network guard). `rawUrl`
   * is the request target exactly as received (not normalised), starting at "/preview".
   */
  async handle(req: IncomingMessage, res: ServerResponse, rawUrl = req.url ?? '/'): Promise<void> {
    const m = /^\/preview\/([^/?#]*)(\/[^#]*|\?[^#]*)?$/.exec(rawUrl);
    const entry = m ? this.#live(m[1]) : undefined;
    if (!m || !entry) return plain(res, 404, 'This preview link has ended or never existed. Ask her for a new one.');
    // Security review (defence in depth): preview files are served from Sara's own origin, so a
    // script or stylesheet there would count as 'self' for Sara's page. The app inside the preview
    // runs in an opaque (sandboxed) origin, so its own requests arrive as cross-site; a same-origin
    // request is Sara's page itself, which may only open the preview as a page or frame.
    if (!previewFetchAllowed(req.headers)) return plain(res, 403, 'Previews open as a page or in the preview frame, not as part of Sara’s own page.');
    const base = `/preview/${entry.token}/`;
    let rest = m[2] ?? '';
    if (!rest || rest.startsWith('?')) {
      // "/preview/<token>" → the app's start page under the right folder.
      res.writeHead(308, { ...PREVIEW_HEADERS, location: `${base}${entry.path.slice(1)}${rest}`, 'content-length': '0' });
      return void res.end();
    }
    const target = safeTarget(rest);
    if (!target) return plain(res, 400, 'That address is not allowed in a preview.');
    rest = target;
    const method = (req.method ?? 'GET').toUpperCase();
    if (!METHODS.has(method)) return plain(res, 405, 'Method not allowed.');
    // A CORS preflight from the app's own scripts (opaque origin): answered here, never forwarded.
    if (method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.writeHead(204, { ...PREVIEW_HEADERS, 'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': 'content-type, accept, x-requested-with', 'access-control-max-age': '600', 'content-length': '0' });
      return void res.end();
    }
    let body: Buffer;
    try {
      body = await readCapped(req, MAX_PREVIEW_BODY);
    } catch {
      // The rest of that body is never read: this connection can't be used again.
      res.setHeader('connection', 'close');
      res.once('finish', () => req.socket.destroy());
      return plain(res, 413, `Request body too large for a preview (max ${MAX_PREVIEW_BODY / 1024 / 1024} MB).`);
    }
    const headers = forwardHeaders(req.headers, entry.port, body.length);
    await new Promise<void>((done) => {
      const up = httpRequest({ host: '127.0.0.1', port: entry.port, method, path: rest, headers, setHost: false, timeout: 30_000, agent: false }, (r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.headers)) {
          if (!BACK.has(k) || v === undefined) continue;
          out[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        if (out.location) {
          const loc = rewriteLocation(out.location, base, entry.port);
          if (loc === undefined) delete out.location;
          else out.location = loc;
        }
        const type = (out['content-type'] ?? '').toLowerCase();
        const rewrite = !out['content-encoding'] && method !== 'HEAD' && (type.startsWith('text/html') || type.startsWith('text/css'));
        if (!rewrite) {
          res.writeHead(r.statusCode ?? 502, { ...out, ...PREVIEW_HEADERS });
          let size = 0;
          r.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE) {
              r.destroy();
              res.destroy();
              return;
            }
            res.write(c);
          });
          r.on('end', () => {
            res.end();
            done();
          });
          r.on('error', () => {
            res.destroy();
            done();
          });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        r.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_REWRITE) chunks.push(c);
        });
        r.on('end', () => {
          if (size > MAX_REWRITE) {
            plain(res, 502, 'That page is too large to preview.');
            return done();
          }
          const text = Buffer.concat(chunks).toString('utf8');
          const outText = type.startsWith('text/html') ? rewriteHtml(text, base) : rewriteCss(text, base);
          const buf = Buffer.from(outText, 'utf8');
          delete out['content-length'];
          delete out.etag;
          res.writeHead(r.statusCode ?? 502, { ...out, ...PREVIEW_HEADERS, 'content-length': String(buf.length) });
          res.end(buf);
          done();
        });
        r.on('error', () => {
          res.destroy();
          done();
        });
      });
      up.on('timeout', () => up.destroy(new Error('timeout')));
      up.on('error', (err) => {
        if (!res.headersSent) plain(res, (err as Error).message === 'timeout' ? 504 : 502, `The app isn't answering on port ${entry.port}${(err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? ' (nothing listens there on 127.0.0.1; does it bind to 127.0.0.1?)' : ''}.`);
        else res.destroy();
        done();
      });
      up.end(body.length ? body : undefined);
    });
  }
}

const view = (e: Entry): Preview => ({ token: e.token, conversationId: e.conversationId, workspace: e.workspace, port: e.port, path: e.path, jobId: e.jobId, jobLabel: e.jobLabel, createdAt: e.createdAt, expiresAt: e.expiresAt });

/** The address of a preview inside Sara ("/preview/<token>/<path>"). */
export const previewUrl = (p: Preview, path = p.path): string => `/preview/${p.token}/${cleanStartPath(path).slice(1)}`;

/**
 * May this request reach a preview? Same-origin requests (Sara's own page) only as a navigation:
 * a document, a frame, or an empty-destination navigation. Everything else (script, style, image,
 * fetch from Sara's page) is refused. Requests without fetch metadata (older browsers, the
 * testing browser's tools) and cross-site ones (the sandboxed app itself) pass.
 */
export function previewFetchAllowed(h: IncomingHttpHeaders): boolean {
  const site = String(h['sec-fetch-site'] ?? '').toLowerCase();
  if (site !== 'same-origin') return true;
  const dest = String(h['sec-fetch-dest'] ?? '').toLowerCase();
  const mode = String(h['sec-fetch-mode'] ?? '').toLowerCase();
  if (!dest) return true;
  if (dest === 'document' || dest === 'iframe' || dest === 'frame') return true;
  return dest === 'empty' && mode === 'navigate';
}

function plain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { ...PREVIEW_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-length': String(Buffer.byteLength(text)) });
  res.end(text);
}

/** A start page she asks for: a path inside the app ("/", "about.html", "/app/?x=1"). */
export function cleanStartPath(p: string | undefined): string {
  const s = (p ?? '/').trim() || '/';
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  const ok = safeTarget(withSlash);
  if (!ok) throw new PreviewError('The page path must be a plain path inside the app (no "..", no full addresses).');
  return ok;
}

/**
 * The request target to send to the app, or undefined when it isn't a plain path: no "." or ".."
 * segments (also percent-encoded), no backslashes, no "//" at the start (an address), no control
 * characters or spaces.
 */
export function safeTarget(raw: string): string | undefined {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 4096) return undefined;
  if (/[\x00-\x20\x7f\\]/.test(raw) || /%5c/i.test(raw) || /%00/.test(raw)) return undefined;
  const q = raw.indexOf('?');
  const path = q >= 0 ? raw.slice(0, q) : raw;
  for (const seg of path.split('/')) {
    let d: string;
    try {
      d = decodeURIComponent(seg);
    } catch {
      return undefined;
    }
    if (d === '.' || d === '..' || d.includes('/') || d.includes('\\')) return undefined;
  }
  return raw;
}

function forwardHeaders(h: IncomingHttpHeaders, port: number, length: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!FORWARD.has(k) || v === undefined) continue;
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    if (/[\r\n]/.test(value)) continue;
    out[k] = value.slice(0, 2000);
  }
  // The app sees a plain local request: its own host name, no cookies, no compression (pages are
  // rewritten), an exact body length (no chunked framing to disagree about).
  out.host = `127.0.0.1:${port}`;
  out['accept-encoding'] = 'identity';
  out.connection = 'close';
  if (length) out['content-length'] = String(length);
  return out;
}

async function readCapped(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > max) {
    req.resume();
    throw new Error('too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > max) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * Where a redirect from the app should go: paths on the app itself are put under the preview;
 * other web addresses stay (they open outside the app); anything else (javascript:, data:…) is
 * dropped.
 */
export function rewriteLocation(loc: string, base: string, port: number): string | undefined {
  const l = loc.trim();
  if (/^\/(?!\/)/.test(l)) return base + l.slice(1);
  let u: URL;
  try {
    u = new URL(l);
  } catch {
    // Relative ("next.html", "../x"): the browser resolves it against the preview address.
    return /^[a-z][a-z0-9+.-]*:/i.test(l) ? undefined : l;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const local = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(u.hostname);
  if (local && Number(u.port || (u.protocol === 'https:' ? 443 : 80)) === port) return base + `${u.pathname}${u.search}${u.hash}`.slice(1);
  if (local) return undefined; // another local port: never
  return u.toString();
}

const ATTR = /(\s(?:src|href|action|formaction|poster|data|background)\s*=\s*)(["']?)\/(?!\/)/gi;

/**
 * HTML from the app: root-relative links ("/assets/x.js") are put under the preview, and a
 * <base href> pointing at the app's root is added (unless the page has its own), so relative
 * links work from any page. Nothing else is added (no scripts).
 */
export function rewriteHtml(html: string, base: string): string {
  let out = html.replace(ATTR, (_m, attr: string, q: string) => `${attr}${q}${base}`);
  // CSS inside the page (style blocks and attributes).
  out = out.replace(/url\(\s*(['"]?)\/(?!\/)/gi, (_m, q: string) => `url(${q}${base}`);
  if (!/<base\s/i.test(out)) {
    const tag = `<base href="${base}">`;
    if (/<head(\s[^>]*)?>/i.test(out)) out = out.replace(/<head(\s[^>]*)?>/i, (h) => `${h}${tag}`);
    else if (/<html(\s[^>]*)?>/i.test(out)) out = out.replace(/<html(\s[^>]*)?>/i, (h) => `${h}<head>${tag}</head>`);
    else if (/^\s*<!doctype[^>]*>/i.test(out)) out = out.replace(/^\s*<!doctype[^>]*>/i, (d) => `${d}${tag}`);
    else out = tag + out;
  }
  return out;
}

/** CSS from the app: root-relative url(...) and @import put under the preview. */
export function rewriteCss(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)\/(?!\/)/gi, (_m, q: string) => `url(${q}${base}`).replace(/@import\s+(['"])\/(?!\/)/gi, (_m, q: string) => `@import ${q}${base}`);
}
