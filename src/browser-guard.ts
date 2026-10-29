// Phase 49: the testing browser's only way out. The browser is started with this as its proxy
// for every address (loopback included), so it can reach:
// - previews: http://sara-preview.test/preview/<token>/… is answered here by the preview proxy
//   (the same checks as in Sara's server: token, job-owned port, sanitised headers);
// - the public web, only when web access is allowed for this conversation: public addresses
//   only (resolved once and pinned, so DNS can't rebind to a local service), ports 80/443.
// Everything else (Sara's own API, other local services, the private network) is refused.
import { lookup } from 'node:dns/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, isIP, type AddressInfo, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { isPrivateAddress } from './tools/builtin.ts';
import { outboundAllowed } from './net-guard.ts';

/** The host name previews have inside the testing browser. */
export const PREVIEW_HOST = 'sara-preview.test';

export interface GuardOptions {
  /** Serves a preview request (`raw` starts at "/preview/…"). */
  preview: (req: IncomingMessage, res: ServerResponse, raw: string) => Promise<void>;
  /** May this browser reach the public web right now? */
  webAllowed: () => boolean;
}

const DROP = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host']);

async function publicAddress(host: string): Promise<string | undefined> {
  const h = host.replace(/^\[|\]$/g, '');
  const addrs = isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) return undefined;
  return addrs[0];
}

function refuse(res: ServerResponse, status: number, text: string): void {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(Buffer.byteLength(text)), connection: 'close' });
  res.end(text);
}

export class BrowserGuard {
  readonly #server: Server;
  readonly #opts: GuardOptions;
  readonly #sockets = new Set<Socket | Duplex>();
  /** Addresses refused (for the tool output: "the page tried to reach …"). */
  readonly refused: string[] = [];

  constructor(opts: GuardOptions) {
    this.#opts = opts;
    this.#server = createServer((req, res) => void this.#request(req, res).catch(() => refuse(res, 502, 'Proxy error.')));
    // Sockets handed over raw (CONNECT, upgrades) have no error handler of the server's any more:
    // a browser resetting one must never take Sara down.
    this.#server.on('connect', (req, socket: Duplex, head) => {
      socket.on('error', () => socket.destroy());
      void this.#connect(req, socket, head).catch(() => socket.destroy());
    });
    this.#server.on('upgrade', (_req, socket: Duplex) => {
      socket.on('error', () => socket.destroy());
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    });
    this.#server.on('clientError', (_err, socket: Duplex) => socket.destroy());
    this.#server.on('connection', (s) => {
      this.#sockets.add(s);
      s.on('error', () => s.destroy());
      s.on('close', () => this.#sockets.delete(s));
    });
  }

  async listen(): Promise<number> {
    await new Promise<void>((r) => this.#server.listen(0, '127.0.0.1', r));
    return (this.#server.address() as AddressInfo).port;
  }

  close(): void {
    this.#server.close();
    for (const s of this.#sockets) s.destroy();
  }

  #note(what: string): void {
    if (this.refused.length < 20 && !this.refused.includes(what)) this.refused.push(what);
  }

  async #request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? '';
    const m = /^http:\/\/([^/?#]+)(\/[^#]*)?$/i.exec(raw);
    if (!m) return refuse(res, 400, 'Only http:// addresses go through here.');
    const authority = m[1].toLowerCase();
    const path = m[2] ?? '/';
    if (authority === PREVIEW_HOST || authority === `${PREVIEW_HOST}:80`) {
      if (!path.startsWith('/preview/')) return refuse(res, 404, 'Not a preview.');
      return this.#opts.preview(req, res, path);
    }
    // Phase 67: private local mode keeps the testing browser on her previews too.
    if (!this.#opts.webAllowed() || !outboundAllowed(raw)) {
      this.#note(authority);
      return refuse(res, 403, 'This testing browser only opens previews of your apps (web access is off).');
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return refuse(res, 400, 'Bad address.');
    }
    const port = Number(url.port || 80);
    const addr = port === 80 || port === 443 ? await publicAddress(url.hostname) : undefined;
    if (!addr) {
      this.#note(authority);
      return refuse(res, 403, 'Only public web addresses (ports 80 and 443) can be opened.');
    }
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !DROP.has(k)) headers[k] = v;
    headers.host = url.host;
    const up = httpRequest({ host: addr, port, method: req.method, path: `${url.pathname}${url.search}`, headers, setHost: false, timeout: 30_000, agent: false }, (r) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !DROP.has(k)) out[k] = v;
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => refuse(res, 502, 'Could not reach that site.'));
    req.pipe(up);
  }

  async #connect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const target = req.url ?? '';
    const m = /^([^:]+|\[[^\]]+\]):(\d+)$/.exec(target);
    const port = m ? Number(m[2]) : 0;
    const addr = m && this.#opts.webAllowed() && outboundAllowed(`https://${m[1]}`) && (port === 443 || port === 80) ? await publicAddress(m[1]) : undefined;
    if (!addr) {
      this.#note(target);
      return void socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    }
    const up = connect(port, addr, () => {
      if (socket.destroyed) return void up.destroy();
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    this.#sockets.add(up);
    up.on('close', () => this.#sockets.delete(up));
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }
}
