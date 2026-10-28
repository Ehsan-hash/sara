// Phase 17: instant notifications on the iPhone app through Apple's push service (APNs), sent by
// this server itself: HTTP/2 + a short-lived ES256 token signed with the owner's APNs key (a .p8
// file from the Apple Developer site). No libraries, no relay. Apple only sends notifications to
// an app with the key of the team that published it, so this works with the owner's own build or
// with the published app's key.
import { connect, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Vault } from './vault.ts';

export const APNS_VAULT = 'push:apns';
export const DEFAULT_BUNDLE_ID = 'com.backstagecoding.sara';

export interface ApnsKey {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** The .p8 file's text (PEM, PKCS#8 EC P-256). */
  p8: string;
}

export interface ApnsPayload {
  title: string;
  body: string;
  /** Page to open, e.g. "/#c=<conversation id>". */
  url: string;
  tag?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS apns_devices (
  token TEXT PRIMARY KEY,
  sandbox INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_ok_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);`;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Checks a key before it's saved: the IDs look right and the .p8 is a usable EC key. */
export function validateApnsKey(k: Partial<ApnsKey>): ApnsKey {
  const keyId = String(k.keyId ?? '').trim().toUpperCase();
  const teamId = String(k.teamId ?? '').trim().toUpperCase();
  const bundleId = String(k.bundleId ?? DEFAULT_BUNDLE_ID).trim();
  const p8 = String(k.p8 ?? '').trim();
  if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new Error('The Key ID is 10 letters and digits (shown next to the key on the Apple Developer site).');
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('The Team ID is 10 letters and digits (Apple Developer → Membership).');
  if (!/^[\w.-]+\.[\w.-]+$/.test(bundleId)) throw new Error('That bundle ID looks wrong.');
  try {
    const key = createPrivateKey(p8);
    if (key.asymmetricKeyType !== 'ec') throw new Error();
  } catch {
    throw new Error('Paste the whole .p8 file, including the BEGIN PRIVATE KEY and END PRIVATE KEY lines.');
  }
  return { keyId, teamId, bundleId, p8 };
}

export class ApnsSender {
  readonly #db: DatabaseSync;
  readonly #vault: Vault;
  readonly #now: () => Date;
  readonly #origin: (sandbox: boolean) => string;
  #jwt: { value: string; at: number; keyId: string } | undefined;
  readonly #sessions = new Map<string, ClientHttp2Session>();

  constructor(db: DatabaseSync, vault: Vault, opts: { now?: () => Date; origin?: (sandbox: boolean) => string } = {}) {
    this.#db = db;
    this.#vault = vault;
    this.#now = opts.now ?? (() => new Date());
    this.#origin = opts.origin ?? ((sandbox) => (sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'));
    db.exec(SCHEMA);
    // Which signed-in device registered it, so signing that device out stops its notifications.
    if (!(db.prepare("SELECT name FROM pragma_table_info('apns_devices')").all() as { name: string }[]).some((c) => c.name === 'session')) db.exec('ALTER TABLE apns_devices ADD COLUMN session TEXT');
  }

  /** Drops iPhones whose sign-in is gone (signed out in Settings → Devices, or a new owner token). */
  prune(validSessions: Set<string>): number {
    let n = 0;
    for (const r of this.#db.prepare('SELECT token, session FROM apns_devices WHERE session IS NOT NULL').all() as { token: string; session: string }[]) {
      if (!validSessions.has(r.session)) {
        this.unregister(r.token);
        n++;
      }
    }
    return n;
  }

  key(): ApnsKey | undefined {
    const raw = this.#vault.get(APNS_VAULT);
    return raw ? (JSON.parse(raw) as ApnsKey) : undefined;
  }
  setKey(k: ApnsKey | null): void {
    if (k) this.#vault.set(APNS_VAULT, JSON.stringify(validateApnsKey(k)));
    else this.#vault.delete(APNS_VAULT);
    this.#jwt = undefined;
  }

  devices(): { token: string; sandbox: boolean; label: string; createdAt: string; lastOkAt: string | null }[] {
    return (this.#db.prepare('SELECT * FROM apns_devices ORDER BY created_at').all() as Record<string, string | number | null>[]).map((r) => ({
      token: String(r.token),
      sandbox: Number(r.sandbox) === 1,
      label: String(r.label),
      createdAt: String(r.created_at),
      lastOkAt: (r.last_ok_at as string | null) ?? null,
    }));
  }
  register(token: string, sandbox: boolean, label: string, session?: string): void {
    if (!/^[0-9a-f]{64,200}$/i.test(token)) throw new Error('Not a device token.');
    this.#db
      .prepare('INSERT INTO apns_devices (token, sandbox, label, created_at, session) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET sandbox = excluded.sandbox, label = excluded.label, session = excluded.session, failures = 0')
      .run(token.toLowerCase(), sandbox ? 1 : 0, label.slice(0, 80), this.#now().toISOString(), session ?? null);
  }
  unregister(token: string): void {
    this.#db.prepare('DELETE FROM apns_devices WHERE token = ?').run(token.toLowerCase());
  }

  /** The provider token: ES256 JWT, reused for up to 50 minutes (Apple allows 20–60). */
  #token(k: ApnsKey): string {
    const now = this.#now().getTime();
    if (this.#jwt && this.#jwt.keyId === k.keyId && now - this.#jwt.at < 50 * 60_000) return this.#jwt.value;
    const head = b64u(JSON.stringify({ alg: 'ES256', kid: k.keyId }));
    const claims = b64u(JSON.stringify({ iss: k.teamId, iat: Math.floor(now / 1000) }));
    const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key: createPrivateKey(k.p8), dsaEncoding: 'ieee-p1363' });
    this.#jwt = { value: `${head}.${claims}.${b64u(sig)}`, at: now, keyId: k.keyId };
    return this.#jwt.value;
  }

  #session(origin: string): ClientHttp2Session {
    const s = this.#sessions.get(origin);
    if (s && !s.closed && !s.destroyed) return s;
    const fresh = connect(origin);
    fresh.on('error', () => this.#sessions.delete(origin));
    fresh.on('close', () => this.#sessions.delete(origin));
    fresh.setTimeout(5 * 60_000, () => fresh.close());
    this.#sessions.set(origin, fresh);
    return fresh;
  }

  #post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = this.#session(origin).request({ ':method': 'POST', ':path': path, ...headers });
      let status = 0;
      let out = '';
      req.setTimeout(15_000, () => req.close());
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (d: Buffer) => (out += d.toString()));
      req.on('end', () => resolve({ status, body: out }));
      req.on('error', reject);
      req.end(body);
    });
  }

  /** Sends to every registered iPhone; drops devices Apple says are gone. */
  async sendAll(p: ApnsPayload): Promise<{ sent: number; failed: number; removed: number }> {
    const out = { sent: 0, failed: 0, removed: 0 };
    const k = this.key();
    const devices = this.devices();
    if (!k || !devices.length) return out;
    // A message in a conversation gets the Reply action (category SARA_REPLY in the app).
    const conversationId = /#c=([\w-]+)/.exec(p.url)?.[1];
    const body = JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: 'default', 'thread-id': 'sara', 'mutable-content': 1, ...(conversationId ? { category: 'SARA_REPLY' } : {}) }, url: p.url, ...(conversationId ? { conversationId } : {}) });
    const auth = `bearer ${this.#token(k)}`;
    await Promise.all(
      devices.map(async (d) => {
        try {
          const r = await this.#post(this.#origin(d.sandbox), `/3/device/${d.token}`, { authorization: auth, 'apns-topic': k.bundleId, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json', ...(p.tag ? { 'apns-collapse-id': p.tag.slice(0, 64) } : {}) }, body);
          const reason = (() => {
            try {
              return (JSON.parse(r.body) as { reason?: string }).reason ?? '';
            } catch {
              return '';
            }
          })();
          if (r.status === 200) {
            this.#db.prepare('UPDATE apns_devices SET last_ok_at = ?, failures = 0 WHERE token = ?').run(this.#now().toISOString(), d.token);
            out.sent++;
          } else if (r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') {
            this.unregister(d.token);
            out.removed++;
          } else {
            this.#db.prepare('UPDATE apns_devices SET failures = failures + 1 WHERE token = ?').run(d.token);
            out.failed++;
          }
        } catch {
          out.failed++;
        }
      }),
    );
    return out;
  }

  close(): void {
    for (const s of this.#sessions.values()) s.close();
    this.#sessions.clear();
  }
}
