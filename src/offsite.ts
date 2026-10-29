// Phase 8: off-server backup copies (owner opt-in). Each backup holds Sara's keys, so the copy that
// leaves the server is encrypted with the owner's passphrase (scrypt + AES-256-GCM). Destinations:
// a folder (e.g. a mounted drive) or S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2,
// Wasabi, MinIO) using a small zero-dependency AWS Signature V4 client. Keeps the newest N copies.
import { netFetch } from './net-guard.ts';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const MAGIC = Buffer.from('SARAENC1');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const OFFSITE_PASS_VAULT = 'backup:passphrase';
export const OFFSITE_S3_VAULT = 'backup:s3secret';

export interface OffsiteSettings {
  kind: 'off' | 'folder' | 's3';
  /** folder: absolute path on the server (must already exist). */
  path?: string;
  /** s3: endpoint like https://s3.us-west-002.backblazeb2.com, bucket, region, access key id. */
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  /** Prefix inside the bucket/folder. */
  prefix?: string;
  keep?: number;
  last?: { at: string; ok: boolean; name?: string; error?: string };
  /** Phase 30: the last test restore of the newest off-server copy. */
  lastTest?: { at: string; ok: boolean; name?: string; madeAt?: string; detail?: string; error?: string };
}

export const DEFAULT_OFFSITE: OffsiteSettings = { kind: 'off', keep: 14, prefix: 'sara/' };

export function isEncrypted(buf: Buffer): boolean {
  return buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBackup(plain: Buffer, passphrase: string): Buffer {
  if (passphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters.');
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function decryptBackup(enc: Buffer, passphrase: string): Buffer {
  if (!isEncrypted(enc)) throw new Error('This is not an encrypted Sara backup.');
  let o = MAGIC.length;
  const salt = enc.subarray(o, (o += 16));
  const iv = enc.subarray(o, (o += 12));
  const tag = enc.subarray(o, (o += 16));
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(enc.subarray(o)), d.final()]);
  } catch {
    throw new Error('Wrong passphrase (or the file is damaged).');
  }
}

// ---- AWS Signature V4 -----------------------------------------------------------------------
const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: URL;
  region: string;
  accessKeyId: string;
  secret: string;
  headers?: Record<string, string>;
  payloadHash: string;
  now: Date;
  service?: string;
}

/** Returns the headers to send (including Authorization) for an S3 request. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const service = i.service ?? 's3';
  const headers: Record<string, string> = { ...i.headers, host: i.url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': i.payloadHash };
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const query = [...i.url.searchParams.entries()].map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join('&');
  const path = i.url.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/');
  const canonical = [i.method, path || '/', query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${i.secret}`, day);
  const kSigning = hmac(hmac(hmac(kDate, i.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Minimal S3 client: put, list (one page, 1000 keys), delete. Path-style URLs. */
export class S3Client {
  readonly #cfg: { endpoint: string; bucket: string; region: string; accessKeyId: string; secret: string };
  readonly #fetch: FetchLike;
  constructor(cfg: { endpoint: string; bucket: string; region: string; accessKeyId: string; secret: string }, fetchImpl: FetchLike = netFetch) {
    this.#cfg = cfg;
    this.#fetch = fetchImpl;
  }

  #url(key = '', query: Record<string, string> = {}): URL {
    const u = new URL(this.#cfg.endpoint.replace(/\/+$/, ''));
    u.pathname = `/${this.#cfg.bucket}${key ? `/${key.split('/').map(enc).join('/')}` : ''}`;
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  }

  async #send(method: string, url: URL, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
    const headers = signV4({ method, url, region: this.#cfg.region, accessKeyId: this.#cfg.accessKeyId, secret: this.#cfg.secret, headers: extra, payloadHash: sha256(body ?? ''), now: new Date() });
    delete headers.host;
    const res = await this.#fetch(url.toString(), { method, headers, ...(body ? { body: new Uint8Array(body) } : {}), signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) {
      const text = (await res.text()).replace(/\s+/g, ' ');
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
      throw new Error(`Storage said ${res.status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`);
    }
    return res;
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.#send('PUT', this.#url(key), body, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) });
  }

  async list(prefix: string): Promise<{ key: string; lastModified: string }[]> {
    const res = await this.#send('GET', this.#url('', { 'list-type': '2', prefix }));
    const xml = await res.text();
    return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
      key: (/<Key>([^<]+)<\/Key>/.exec(m[1])?.[1] ?? '').replace(/&amp;/g, '&'),
      lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? '',
    }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.#send('GET', this.#url(key));
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.#send('DELETE', this.#url(key));
  }
}

/** Encrypts one local backup and copies it off the server; prunes old copies. Returns the stored name. */
export async function uploadOffsite(file: string, cfg: OffsiteSettings, secrets: { passphrase?: string; s3Secret?: string }, fetchImpl: FetchLike = netFetch): Promise<string> {
  if (cfg.kind === 'off') throw new Error('Off-server copies are turned off.');
  if (!secrets.passphrase) throw new Error('Set a backup passphrase first.');
  const name = `${basename(file)}.enc`;
  const keep = Math.max(1, cfg.keep ?? 14);
  const prefix = (cfg.prefix ?? 'sara/').replace(/^\/+/, '');
  if (cfg.kind === 'folder' && (!cfg.path || !existsSync(cfg.path) || !statSync(cfg.path).isDirectory())) throw new Error(`Folder ${cfg.path ?? '(none)'} doesn't exist on the server.`);
  if (cfg.kind === 's3' && (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !secrets.s3Secret)) throw new Error('Fill in the storage endpoint, bucket, key ID and secret.');
  const data = encryptBackup(readFileSync(file), secrets.passphrase);
  if (cfg.kind === 'folder' && cfg.path) {
    writeFileSync(join(cfg.path, name), data, { mode: 0o600 });
    const mine = readdirSync(cfg.path)
      .filter((n) => /^sara-[\w-]+\.tar\.gz\.enc$/.test(n))
      .sort()
      .reverse();
    for (const old of mine.slice(keep)) rmSync(join(cfg.path, old), { force: true });
    return name;
  }
  const s3 = new S3Client({ endpoint: cfg.endpoint!, bucket: cfg.bucket!, region: cfg.region || 'us-east-1', accessKeyId: cfg.accessKeyId!, secret: secrets.s3Secret! }, fetchImpl);
  await s3.put(`${prefix}${name}`, data);
  const mine = (await s3.list(prefix)).filter((o) => /sara-[\w-]+\.tar\.gz\.enc$/.test(o.key)).sort((a, b) => b.key.localeCompare(a.key));
  for (const old of mine.slice(keep)) await s3.delete(old.key);
  return name;
}

/** Phase 30: the newest off-server copy (still encrypted) and its name. */
export async function downloadNewestOffsite(cfg: OffsiteSettings, secrets: { s3Secret?: string }, fetchImpl: FetchLike = netFetch): Promise<{ name: string; data: Buffer }> {
  const prefix = (cfg.prefix ?? 'sara/').replace(/^\/+/, '');
  if (cfg.kind === 'folder') {
    if (!cfg.path || !existsSync(cfg.path)) throw new Error(`Folder ${cfg.path ?? '(none)'} doesn't exist on the server.`);
    const newest = readdirSync(cfg.path)
      .filter((n) => /^sara-[\w-]+\.tar\.gz\.enc$/.test(n))
      .sort()
      .reverse()[0];
    if (!newest) throw new Error('There is no off-server copy yet.');
    return { name: newest, data: readFileSync(join(cfg.path, newest)) };
  }
  if (cfg.kind !== 's3' || !cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !secrets.s3Secret) throw new Error('Off-server copies are not set up.');
  const s3 = new S3Client({ endpoint: cfg.endpoint, bucket: cfg.bucket, region: cfg.region || 'us-east-1', accessKeyId: cfg.accessKeyId, secret: secrets.s3Secret }, fetchImpl);
  const newest = (await s3.list(prefix)).filter((o) => /sara-[\w-]+\.tar\.gz\.enc$/.test(o.key)).sort((a, b) => b.key.localeCompare(a.key))[0];
  if (!newest) throw new Error('There is no off-server copy yet.');
  return { name: basename(newest.key), data: await s3.get(newest.key) };
}
