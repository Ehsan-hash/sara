// Phase 49: a small Chrome DevTools Protocol client over Sara's own WebSocket client (src/ws.ts).
// Commands are JSON messages with an id; replies carry the same id; everything else is an event.
// One connection to the browser; pages are reached through flat sessions (sessionId).
import { connectWebSocket, type WsConnection } from './ws.ts';

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export class CdpError extends Error {}

export class CdpClient {
  readonly #ws: WsConnection;
  #id = 0;
  readonly #pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  readonly #listeners = new Set<(ev: CdpEvent) => void>();
  #closed = false;
  onClose?: () => void;

  constructor(ws: WsConnection) {
    this.#ws = ws;
    ws.onMessage = (data) => this.#message(typeof data === 'string' ? data : data.toString('utf8'));
    ws.onClose = () => {
      this.#closed = true;
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer);
        p.reject(new CdpError('The browser connection closed.'));
      }
      this.#pending.clear();
      this.onClose?.();
    };
  }

  static async connect(url: string): Promise<CdpClient> {
    return new CdpClient(await connectWebSocket(url, { timeoutMs: 10_000 }));
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    if (this.#closed) return Promise.reject(new CdpError('The browser connection is closed.'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`The browser didn't answer ${method} in time.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn: (ev: CdpEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Resolves with the first event that matches (or undefined after the timeout). */
  waitFor(match: (ev: CdpEvent) => boolean, timeoutMs: number): Promise<CdpEvent | undefined> {
    return new Promise((resolve) => {
      const off = this.on((ev) => {
        if (!match(ev)) return;
        clearTimeout(timer);
        off();
        resolve(ev);
      });
      const timer = setTimeout(() => {
        off();
        resolve(undefined);
      }, timeoutMs);
    });
  }

  close(): void {
    this.#ws.close();
  }

  #message(text: string): void {
    let msg: { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(msg.error.message ?? 'The browser refused that.'));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      const ev: CdpEvent = { method: msg.method, params: msg.params ?? {}, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) };
      for (const fn of this.#listeners) {
        try {
          fn(ev);
        } catch {
          /* a listener's problem stays there */
        }
      }
    }
  }
}
