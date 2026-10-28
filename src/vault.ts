// Encrypted secret storage (API keys, future OAuth tokens). AES-256-GCM with a per-install
// master key kept in the data directory (mode 0600) or supplied via SARA_MASTER_KEY.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'secrets.enc';
const KEY_FILE = 'master.key';

export class Vault {
  readonly #dir: string;
  readonly #key: Buffer;
  #data: Record<string, string>;

  constructor(dataDir: string, masterKeyEnv?: string) {
    this.#dir = dataDir;
    this.#key = Vault.#loadKey(dataDir, masterKeyEnv);
    this.#data = this.#read();
  }

  static #loadKey(dir: string, env?: string): Buffer {
    if (env) {
      const k = Buffer.from(env, 'base64');
      if (k.length !== 32) throw new Error('SARA_MASTER_KEY must be 32 bytes, base64-encoded');
      return k;
    }
    const path = join(dir, KEY_FILE);
    if (existsSync(path)) {
      const k = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
      if (k.length !== 32) throw new Error(`${path} is not a valid 32-byte base64 key`);
      return k;
    }
    const k = randomBytes(32);
    writeFileSync(path, k.toString('base64') + '\n', { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // best effort on non-POSIX filesystems
    }
    return k;
  }

  #read(): Record<string, string> {
    const path = join(this.#dir, FILE);
    if (!existsSync(path)) return {};
    const raw = readFileSync(path);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.#key, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(enc), d.final()]);
    return JSON.parse(plain.toString('utf8')) as Record<string, string>;
  }

  #write(): void {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(this.#data), 'utf8'), c.final()]);
    const out = Buffer.concat([iv, c.getAuthTag(), enc]);
    const path = join(this.#dir, FILE);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, out, { mode: 0o600 });
    renameSync(tmp, path);
  }

  get(name: string): string | undefined {
    return this.#data[name];
  }

  /** Every stored secret value (for redaction). */
  values(): string[] {
    return Object.values(this.#data);
  }

  has(name: string): boolean {
    return name in this.#data;
  }

  set(name: string, value: string): void {
    this.#data[name] = value;
    this.#write();
  }

  delete(name: string): void {
    if (!(name in this.#data)) return;
    delete this.#data[name];
    this.#write();
  }
}
