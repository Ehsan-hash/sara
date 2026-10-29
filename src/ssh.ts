// Phase 73: work on the owner's other servers over SSH.
//
// Sara does not speak the SSH protocol herself (zero dependencies, and a home-made SSH client would
// be a security liability). She drives the system OpenSSH client (`ssh`, `ssh-keygen`,
// `ssh-keyscan`; present on Linux, macOS and Windows 10/11) as child processes with an ARGUMENT
// ARRAY, never a shell string, and with a fixed set of safe options (sshOptions below):
//
// - Host keys: trust on first use, shown to the owner as a SHA256 fingerprint to approve. The
//   approved key goes into a per-server known_hosts file in the data folder, bound to the server's
//   id (HostKeyAlias), and every connection runs with StrictHostKeyChecking=yes. A changed host key
//   stops her: the new fingerprint waits for the owner's explicit approval.
// - Her own key per server (ed25519, no passphrase, <data>/ssh/keys/<id>_ed25519, 0600), used with
//   IdentitiesOnly=yes and no agent. Nothing forwarded (agent, X11, ports), no control sockets, no
//   local commands, the owner's ~/.ssh/config is ignored (-F none).
// - Passwords: typed by the owner in Settings (a password box, never the chat), used ONCE through
//   SSH_ASKPASS (a tiny helper that prints a 0600 file it deletes as it reads it; never on the
//   command line, never in the environment, never in logs). Right after that first login she makes
//   her own key, installs it in ~/.ssh/authorized_keys on that server (no duplicates, 700/600) and
//   checks that it works; the password is dropped. It is saved (encrypted in the vault) only when the
//   owner ticks "Save the password" AND confirms the warning.
// - Owner-only: never in household members' spaces, the demo, the OpenAI-compatible API, MCP or any
//   other app's turn (src/chat.ts filters ssh_* tools out of those). Private local mode: only
//   servers on this computer (loopback), like every other connection (src/net-guard.ts).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFileAtomic } from './fs-util.ts';
import { isAbsolute, join } from 'node:path';
import { isLoopbackHost, privateLocalOn } from './net-guard.ts';
import { en } from './i18n.ts';
import type { Vault } from './vault.ts';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface RunOptions {
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Stop collecting output past this many bytes per stream (the process keeps running). */
  maxBytes?: number;
}

/** Runs one program with an argument array. Tests inject a fake one. */
export type CommandRunner = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

/** The real runner: spawn without a shell, stdin closed (ssh never reads a password from it). */
export const spawnRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    const max = opts.maxBytes ?? 1_000_000;
    let out = '';
    let err = '';
    let done = false;
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: opts.env });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: (e as Error).message });
      return;
    }
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout: out, stderr: err, ...(timedOut ? { timedOut } : {}) });
    };
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
    };
    const onAbort = () => kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    let grace: NodeJS.Timeout | undefined;
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < max) out += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < max) err += d.toString('utf8');
    });
    child.on('error', (e) => {
      err += e.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    // A grandchild holding the pipes open must not keep the call waiting forever.
    child.on('exit', (code) => {
      grace = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code);
      }, 3000);
    });
  });

export interface SshServer {
  id: string;
  /** The owner's name for it ("web box"). */
  name: string;
  host: string;
  port: number;
  user: string;
  createdAt: string;
  /** The approved host key (SHA256 fingerprint and the known_hosts key type). */
  fingerprint?: string;
  keyType?: string;
  trustedAt?: string;
  /** A host key seen but not approved yet (first use, or a changed key). */
  pending?: { fingerprint: string; keyType: string; line: string; changed: boolean; seenAt: string };
  /** Her key for this server: made by her (installed by her) or one the owner gave her. */
  key?: { path: string; publicLine: string; source: 'made' | 'imported'; createdAt: string; installedAt?: string };
  /** Whether the owner asked her to keep the password (encrypted in the vault). */
  passwordSaved?: boolean;
  /** How the owner said to sign in when adding it. */
  auth: 'password' | 'key';
  /** The owner asked (in chat, after the warning) to keep the password: the form starts ticked. */
  askedToSavePassword?: boolean;
  /** Where to tell the owner about her new key (the conversation that added the server). */
  conversationId?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface ServerView extends Omit<SshServer, 'pending' | 'key'> {
  pendingFingerprint?: string;
  hostKeyChanged?: boolean;
  keyPath?: string;
  publicKey?: string;
  keySource?: 'made' | 'imported';
  keyInstalledAt?: string;
  ready: boolean;
}

export class SshError extends Error {
  readonly code: string;
  constructor(message: string, code = 'SSH') {
    super(message);
    this.name = 'SshError';
    this.code = code;
  }
}

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9A-Fa-f:]+(?:%[\w.-]+)?\]?)$/;
const USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const NAME = /^[^\n\r\t<>]{1,60}$/;
const ID = /^[a-z0-9]{10}$/;
/** A public key line Sara will put between single quotes in a remote command: nothing a shell treats specially. */
// Built from parts so the release scan (scripts/public-export.ts) doesn't take the pattern for a key.
const PK = ['PRIVATE', 'KEY'].join(' ');
const PEM_KEY = new RegExp(`^-----BEGIN (OPENSSH|RSA|EC) ${PK}-----\\n[\\s\\S]+\\n-----END (OPENSSH|RSA|EC) ${PK}-----\\n$`);
const PUBLIC_LINE = /^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa) [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9@._:-]{1,120})?$/;
export const VAULT_PREFIX = 'ssh:password:';
export const vaultKeyOf = (id: string) => `${VAULT_PREFIX}${id}`;

/** The warning she gives before keeping a password (also shown next to the checkbox). */
export const SAVE_PASSWORD_WARNING = en(
  'Keeping the password is a security risk: anyone who gets into Sara (or a copy of her data and master key) could sign in to that server with it, everywhere that password works. A key is safer: it only opens this one server for her and you can revoke it any time. Save the password only if you really need it.',
);

export function cleanHost(input: unknown): string {
  const h = String(input ?? '').trim();
  if (!h || h.startsWith('-') || !HOST.test(h)) throw new SshError('Give the server’s name or IP address, like server.example.com or 192.168.1.20.', 'BAD_HOST');
  return h.replace(/^\[|\]$/g, '');
}
export function cleanUser(input: unknown): string {
  const u = String(input ?? '').trim();
  if (!USER.test(u)) throw new SshError('Give the user name to sign in as (letters, digits, . _ -), like deploy or root.', 'BAD_USER');
  return u;
}
export function cleanPort(input: unknown): number {
  const p = input === undefined || input === null || input === '' ? 22 : Number(input);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new SshError('The port is a number from 1 to 65535 (usually 22).', 'BAD_PORT');
  return p;
}

/** The known_hosts key type → the host key algorithms ssh may accept for it (only that key). */
export function hostKeyAlgorithms(keyType: string): string {
  if (keyType === 'ssh-rsa') return 'rsa-sha2-512,rsa-sha2-256';
  if (/^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521))$/.test(keyType)) return keyType;
  throw new SshError(`Unsupported host key type ${keyType}.`, 'BAD_HOSTKEY');
}

/** The comment on her keys: sara@<instance>-<date>. */
export function keyComment(instance: string, now: Date): string {
  const safe = instance.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'sara';
  return `sara@${safe}-${now.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

/** Single-quoted for a POSIX shell (only used for public key lines that PUBLIC_LINE allows). */
function q(line: string): string {
  if (!PUBLIC_LINE.test(line)) throw new SshError('That public key line has unexpected characters.', 'BAD_KEY');
  return `'${line}'`;
}

/** The remote command that adds her public key to ~/.ssh/authorized_keys: once, with 700/600. */
export function installScript(line: string): string {
  const L = q(line);
  return [
    'umask 077',
    'd="$HOME/.ssh"; f="$d/authorized_keys"',
    'mkdir -p "$d" && chmod 700 "$d" && touch "$f" && chmod 600 "$f" || { echo sara-key-failed; exit 3; }',
    `if grep -qxF ${L} "$f"; then echo sara-key-present; else if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then echo >> "$f"; fi; echo ${L} >> "$f" && echo sara-key-added; fi`,
  ].join('; ');
}

/** The remote command that removes exactly her line (and nothing else) from authorized_keys. */
export function revokeScript(line: string): string {
  const L = q(line);
  return [
    'umask 077',
    'f="$HOME/.ssh/authorized_keys"',
    '[ -f "$f" ] || { echo sara-key-gone; exit 0; }',
    `if grep -qxF ${L} "$f"; then t="$f.sara-$$"; grep -vxF ${L} "$f" > "$t"; cat "$t" > "$f" && rm -f "$t" && echo sara-key-removed; else echo sara-key-gone; fi`,
  ].join('; ');
}

/** Parses `ssh-keygen -lf` output: "256 SHA256:abc… host (ED25519)". */
export function parseFingerprint(out: string): string | undefined {
  return /\bSHA256:[A-Za-z0-9+/]{43}=?/.exec(out)?.[0];
}

/** Picks the best host key line from `ssh-keyscan` output (ed25519, then ecdsa, then rsa). */
export function pickHostKey(out: string): { keyType: string; key: string } | undefined {
  const keys = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 3 && /^[A-Za-z0-9+/]+={0,3}$/.test(p[2]))
    .map((p) => ({ keyType: p[1], key: p[2] }));
  const rank = (t: string) => (t === 'ssh-ed25519' ? 0 : t.startsWith('ecdsa-') ? 1 : t === 'ssh-rsa' ? 2 : 9);
  return keys.filter((k) => rank(k.keyType) < 9).sort((a, b) => rank(a.keyType) - rank(b.keyType))[0];
}

const HOSTKEY_FAIL = /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key for .* has changed|No (?:ED25519|ECDSA|RSA)? ?host key is known/i;
const AUTH_FAIL = /Permission denied|Too many authentication failures|no supported authentication methods/i;

export interface SshDeps {
  /** The owner's space folder (<data>); everything lives in <data>/ssh. */
  dir: string;
  vault: Vault;
  run?: CommandRunner;
  now?: () => Date;
  /** Instance name for key comments (SARA_INSTANCE, default "sara"). */
  instance?: string;
  /** Program names or paths (default: ssh, ssh-keygen, ssh-keyscan from PATH). */
  bins?: { ssh?: string; keygen?: string; keyscan?: string };
  platform?: NodeJS.Platform;
  /** Private local mode (defaults to the process-wide switch). */
  privateLocal?: () => boolean;
}

/** The owner's SSH servers, her keys and host keys. One per owner space. */
export class SshManager {
  readonly #dir: string;
  readonly #vault: Vault;
  readonly #run: CommandRunner;
  readonly #now: () => Date;
  readonly #instance: string;
  readonly #bins: { ssh: string; keygen: string; keyscan: string };
  readonly #platform: NodeJS.Platform;
  readonly #privateLocal: () => boolean;
  #servers: SshServer[];

  constructor(deps: SshDeps) {
    this.#dir = join(deps.dir, 'ssh');
    this.#vault = deps.vault;
    this.#run = deps.run ?? spawnRunner;
    this.#now = deps.now ?? (() => new Date());
    this.#instance = deps.instance ?? (process.env.SARA_INSTANCE?.trim() || 'sara');
    this.#bins = { ssh: deps.bins?.ssh ?? 'ssh', keygen: deps.bins?.keygen ?? 'ssh-keygen', keyscan: deps.bins?.keyscan ?? 'ssh-keyscan' };
    this.#platform = deps.platform ?? process.platform;
    this.#privateLocal = deps.privateLocal ?? privateLocalOn;
    this.#servers = this.#load();
  }

  get dir(): string {
    return this.#dir;
  }

  #file(): string {
    return join(this.#dir, 'servers.json');
  }
  #load(): SshServer[] {
    try {
      const raw = JSON.parse(readFileSync(this.#file(), 'utf8')) as { servers?: SshServer[] };
      return Array.isArray(raw.servers) ? raw.servers.filter((s) => s && ID.test(s.id)) : [];
    } catch {
      return [];
    }
  }
  #mk(sub = ''): string {
    const d = sub ? join(this.#dir, sub) : this.#dir;
    mkdirSync(d, { recursive: true, mode: 0o700 });
    try {
      chmodSync(d, 0o700);
    } catch {
      /* best effort */
    }
    return d;
  }
  #save(): void {
    this.#mk();
    writeFileAtomic(this.#file(), JSON.stringify({ servers: this.#servers }, null, 2), 0o600);
  }
  knownHostsFile(id: string): string {
    return join(this.#dir, 'known_hosts', id);
  }
  keyFile(id: string, source: 'made' | 'imported' = 'made'): string {
    return join(this.#dir, 'keys', source === 'made' ? `${id}_ed25519` : `${id}_imported`);
  }

  list(): SshServer[] {
    return this.#servers.map((s) => ({ ...s }));
  }
  view(s: SshServer): ServerView {
    const { pending, key, ...rest } = s;
    return {
      ...rest,
      passwordSaved: this.#vault.has(vaultKeyOf(s.id)),
      ...(pending ? { pendingFingerprint: pending.fingerprint, hostKeyChanged: pending.changed } : {}),
      ...(key ? { keyPath: key.path, publicKey: key.publicLine, keySource: key.source, ...(key.installedAt ? { keyInstalledAt: key.installedAt } : {}) } : {}),
      ready: Boolean(s.fingerprint && !pending && (key || this.#vault.has(vaultKeyOf(s.id)))),
    };
  }
  views(): ServerView[] {
    return this.#servers.map((s) => this.view(s));
  }

  /** A server by id or by the owner's name for it (case-insensitive), or host / user@host. */
  find(ref: string): SshServer | undefined {
    const r = String(ref ?? '').trim().toLowerCase();
    if (!r) return undefined;
    return (
      this.#servers.find((s) => s.id === r) ??
      this.#servers.find((s) => s.name.toLowerCase() === r) ??
      this.#servers.find((s) => `${s.user}@${s.host}`.toLowerCase() === r || `${s.user}@${s.host}:${s.port}`.toLowerCase() === r) ??
      (this.#servers.filter((s) => s.host.toLowerCase() === r).length === 1 ? this.#servers.find((s) => s.host.toLowerCase() === r) : undefined)
    );
  }
  get(id: string): SshServer {
    const s = this.#servers.find((x) => x.id === id);
    if (!s) throw new SshError('There is no such server.', 'NOT_FOUND');
    return s;
  }
  #update(id: string, patch: Partial<SshServer>): SshServer {
    const s = this.get(id);
    Object.assign(s, patch);
    for (const k of Object.keys(patch) as (keyof SshServer)[]) if (patch[k] === undefined) delete s[k];
    this.#save();
    return s;
  }

  /** Private local mode lets her reach only this computer. */
  #checkReach(host: string): void {
    if (this.#privateLocal() && !isLoopbackHost(host)) {
      throw new SshError(`Blocked by private local mode: ${host} is not on this computer. While "Nothing leaves this computer" is on, Sara only connects to this computer.`, 'PRIVATE_LOCAL');
    }
  }

  #baseEnv(extra: Record<string, string> = {}): Record<string, string> {
    // A small, known environment: no SSH_AUTH_SOCK (no agent), no DISPLAY tricks, nothing secret.
    const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USER', 'LOGNAME', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'ProgramData', 'ALLUSERSPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'ComSpec', 'PATHEXT'];
    const env: Record<string, string> = {};
    for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k] as string;
    return { ...env, ...extra };
  }

  /** The options every ssh call gets (see the top of this file). */
  sshOptions(s: SshServer, mode: 'key' | 'password', keyPath?: string): string[] {
    if (!s.fingerprint || !s.keyType) throw new SshError('Approve this server’s host key first.', 'NO_HOSTKEY');
    const o = (k: string, v: string) => ['-o', `${k}=${v}`];
    return [
      '-F', 'none',
      '-T',
      ...o('BatchMode', mode === 'key' ? 'yes' : 'no'),
      ...o('StrictHostKeyChecking', 'yes'),
      ...o('UserKnownHostsFile', this.knownHostsFile(s.id)),
      ...o('GlobalKnownHostsFile', this.knownHostsFile(s.id)),
      ...o('HostKeyAlias', `sara-${s.id}`),
      ...o('HostKeyAlgorithms', hostKeyAlgorithms(s.keyType)),
      ...o('UpdateHostKeys', 'no'),
      ...o('CheckHostIP', 'no'),
      ...o('IdentitiesOnly', 'yes'),
      ...o('IdentityAgent', 'none'),
      ...(mode === 'key' && keyPath
        ? ['-i', keyPath, ...o('PubkeyAuthentication', 'yes'), ...o('PasswordAuthentication', 'no'), ...o('KbdInteractiveAuthentication', 'no'), ...o('PreferredAuthentications', 'publickey')]
        : [...o('IdentityFile', 'none'), ...o('PubkeyAuthentication', 'no'), ...o('PasswordAuthentication', 'yes'), ...o('KbdInteractiveAuthentication', 'yes'), ...o('PreferredAuthentications', 'password,keyboard-interactive'), ...o('NumberOfPasswordPrompts', '1')]),
      ...o('ConnectTimeout', '15'),
      ...o('ServerAliveInterval', '15'),
      ...o('ServerAliveCountMax', '3'),
      ...o('ForwardAgent', 'no'),
      ...o('ForwardX11', 'no'),
      ...o('ClearAllForwardings', 'yes'),
      ...o('ControlMaster', 'no'),
      ...o('ControlPath', 'none'),
      ...o('PermitLocalCommand', 'no'),
      ...o('LogLevel', 'ERROR'),
      '-p', String(s.port),
      '-l', s.user,
      '--',
      s.host,
    ];
  }

  /** Adds a server (or returns the same one again) and reads its host key for the owner to approve. */
  async add(input: { name?: unknown; host: unknown; port?: unknown; user: unknown; auth?: unknown; conversationId?: string; askedToSavePassword?: boolean }): Promise<SshServer> {
    const host = cleanHost(input.host);
    const user = cleanUser(input.user);
    const port = cleanPort(input.port);
    const name = String(input.name ?? '').trim() || host;
    if (!NAME.test(name)) throw new SshError('Give the server a short name (up to 60 characters).', 'BAD_NAME');
    this.#checkReach(host);
    const same = this.#servers.find((s) => s.host.toLowerCase() === host.toLowerCase() && s.port === port && s.user === user);
    if (same) {
      if (input.conversationId) same.conversationId = input.conversationId;
      if (input.askedToSavePassword) same.askedToSavePassword = true;
      this.#save();
      if (!same.fingerprint || same.pending) await this.scan(same.id);
      return this.get(same.id);
    }
    if (this.#servers.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new SshError(`There is already a server called "${name}". Pick another name.`, 'DUPLICATE');
    if (this.#servers.length >= 50) throw new SshError('That is a lot of servers: remove one first (up to 50).', 'TOO_MANY');
    const s: SshServer = {
      id: randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '0'),
      name,
      host,
      port,
      user,
      auth: input.auth === 'key' ? 'key' : 'password',
      createdAt: this.#now().toISOString(),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.askedToSavePassword ? { askedToSavePassword: true } : {}),
    };
    this.#servers.push(s);
    this.#save();
    try {
      await this.scan(s.id);
    } catch (err) {
      this.#update(s.id, { lastError: (err as Error).message });
    }
    return this.get(s.id);
  }

  /** Reads the server's host key now (ssh-keyscan), with its SHA256 fingerprint (ssh-keygen -lf). */
  async scan(id: string): Promise<SshServer> {
    const s = this.get(id);
    this.#checkReach(s.host);
    const r = await this.#run(this.#bins.keyscan, ['-T', '10', '-p', String(s.port), '-t', 'ed25519,ecdsa,rsa', '--', s.host], { env: this.#baseEnv(), timeoutMs: 20_000 });
    const picked = pickHostKey(r.stdout);
    if (!picked) throw new SshError(`Couldn’t read the host key of ${s.host}:${s.port}. Is the server on, and is SSH running on that port?${r.stderr.trim() ? ` (${r.stderr.trim().split(/\r?\n/).at(-1)?.slice(0, 200)})` : ''}`, 'SCAN_FAILED');
    const fp = await this.fingerprintOf(`sara-${s.id} ${picked.keyType} ${picked.key}`);
    if (s.fingerprint && s.fingerprint === fp && s.keyType === picked.keyType) {
      return this.#update(id, { pending: undefined, lastError: undefined });
    }
    return this.#update(id, { pending: { fingerprint: fp, keyType: picked.keyType, line: `sara-${s.id} ${picked.keyType} ${picked.key}`, changed: Boolean(s.fingerprint), seenAt: this.#now().toISOString() }, lastError: undefined });
  }

  async fingerprintOf(knownHostsLine: string): Promise<string> {
    const tmp = this.#tempDir();
    try {
      const f = join(tmp, 'k');
      writeFileSync(f, `${knownHostsLine}\n`, { mode: 0o600 });
      const r = await this.#run(this.#bins.keygen, ['-l', '-E', 'sha256', '-f', f], { env: this.#baseEnv(), timeoutMs: 15_000 });
      const fp = parseFingerprint(r.stdout);
      if (!fp) throw new SshError('Couldn’t work out the host key’s fingerprint (is ssh-keygen installed?).', 'NO_KEYGEN');
      return fp;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** The owner approved the fingerprint he saw: remember exactly that key. */
  trust(id: string, fingerprint: string): SshServer {
    const s = this.get(id);
    if (!s.pending) throw new SshError('There is no new host key waiting for approval. Check it again first.', 'NO_PENDING');
    if (String(fingerprint ?? '').trim() !== s.pending.fingerprint) throw new SshError('That fingerprint doesn’t match the one waiting for approval. Check the host key again.', 'FP_MISMATCH');
    this.#mk('known_hosts');
    writeFileSync(this.knownHostsFile(id), `${s.pending.line}\n`, { mode: 0o600 });
    return this.#update(id, { fingerprint: s.pending.fingerprint, keyType: s.pending.keyType, trustedAt: this.#now().toISOString(), pending: undefined, lastError: undefined });
  }

  #tempDir(): string {
    const base = this.#mk('tmp');
    const d = mkdtempSync(join(base, 'r-'));
    try {
      chmodSync(d, 0o700);
    } catch {
      /* best effort */
    }
    return d;
  }

  /** Windows: ssh refuses private keys others can read; take the inherited permissions away. */
  async #lockDown(file: string): Promise<void> {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
    if (this.#platform !== 'win32') return;
    const who = process.env.USERNAME;
    if (!who) return;
    await this.#run('icacls', [file, '/inheritance:r', '/grant:r', `${who}:F`], { env: this.#baseEnv(), timeoutMs: 15_000 }).catch(() => undefined);
  }

  /**
   * Makes the SSH_ASKPASS helper for one login: a 0700 folder holding the password in a 0600 file
   * and a script that prints it and deletes it. Returns the env for ssh and a cleanup.
   */
  #askpass(password: Buffer): { env: Record<string, string>; cleanup: () => void } {
    const d = this.#tempDir();
    const pw = join(d, 'p');
    writeFileSync(pw, password, { mode: 0o600 });
    let helper: string;
    if (this.#platform === 'win32') {
      helper = join(d, 'askpass.cmd');
      writeFileSync(helper, `@type "${pw}"\r\n@del /q "${pw}" >nul 2>&1\r\n`, { mode: 0o700 });
    } else {
      helper = join(d, 'askpass.sh');
      writeFileSync(helper, `#!/bin/sh\ncat '${pw.replace(/'/g, `'\\''`)}'\nrm -f '${pw.replace(/'/g, `'\\''`)}'\n`, { mode: 0o700 });
      chmodSync(helper, 0o700);
    }
    return {
      env: { SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY || 'sara:0' },
      cleanup: () => rmSync(d, { recursive: true, force: true, maxRetries: 3 }),
    };
  }

  #explain(s: SshServer, r: RunResult, scrub: string[] = []): string {
    let text = `${r.stderr}`.trim();
    for (const x of scrub) if (x) text = text.split(x).join('[REDACTED]');
    if (HOSTKEY_FAIL.test(text)) return `The host key of ${s.name} (${s.host}) is not the one you approved. I stopped and didn’t sign in. Check it in Settings → Abilities → Servers over SSH before trusting a new one.`;
    if (AUTH_FAIL.test(text)) return `${s.name} refused the sign-in for ${s.user}.`;
    if (r.timedOut) return `${s.name} didn’t answer in time.`;
    return text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 400) || `ssh ended with exit code ${r.code ?? 'none'}.`;
  }

  async #hostKeyChanged(s: SshServer): Promise<void> {
    // Read what the server shows now, for the owner to compare; never trust it on her own.
    await this.scan(s.id).catch(() => undefined);
    this.#update(s.id, { lastError: 'The host key changed.' });
  }

  /**
   * The first sign-in with a password: makes her own key, installs it on the server, checks that it
   * works, and keeps the password only when the owner asked AND confirmed the warning.
   */
  async loginWithPassword(id: string, password: string | Buffer, opts: { savePassword?: boolean; confirmRisk?: boolean } = {}): Promise<{ server: SshServer; announcement: string; keyPath: string; publicLine: string; passwordSaved: boolean }> {
    const s = this.get(id);
    this.#checkReach(s.host);
    const pwBuf = Buffer.isBuffer(password) ? Buffer.from(password) : Buffer.from(String(password ?? ''), 'utf8');
    try {
      if (!pwBuf.length || pwBuf.length > 1024 || pwBuf.includes(0x0a) || pwBuf.includes(0x0d) || pwBuf.includes(0)) throw new SshError('Type the password (one line).', 'BAD_PASSWORD');
      if (opts.savePassword && !opts.confirmRisk) throw new SshError('To keep the password, confirm that you understand the risk.', 'CONFIRM_RISK');
      // Her own key for this server (a fresh one each time she signs in with a password).
      const { path, publicLine } = await this.#makeKey(s);
      const ask = this.#askpass(pwBuf);
      let r: RunResult;
      const pwText = pwBuf.toString('utf8');
      try {
        r = await this.#run(this.#bins.ssh, [...this.sshOptions(s, 'password'), installScript(publicLine)], { env: this.#baseEnv(ask.env), timeoutMs: 60_000 });
      } finally {
        ask.cleanup();
      }
      if (r.code !== 0 || !/sara-key-(added|present)/.test(r.stdout)) {
        const why = this.#explain(s, r, [pwText]);
        if (HOSTKEY_FAIL.test(r.stderr)) await this.#hostKeyChanged(s);
        this.#dropKeyFiles(path);
        this.#update(id, { lastError: why });
        throw new SshError(/sara-key-failed/.test(r.stdout) ? `I signed in but couldn’t write ~/.ssh/authorized_keys on ${s.name}.` : why, HOSTKEY_FAIL.test(r.stderr) ? 'HOSTKEY_CHANGED' : AUTH_FAIL.test(r.stderr) ? 'AUTH' : 'LOGIN_FAILED');
      }
      const now = this.#now().toISOString();
      this.#update(id, { key: { path, publicLine, source: 'made', createdAt: now, installedAt: now }, lastError: undefined, lastUsedAt: now, askedToSavePassword: undefined });
      // From now on: the key. Check it really works before saying so.
      const check = await this.#run(this.#bins.ssh, [...this.sshOptions(this.get(id), 'key', path), 'echo sara-key-ok'], { env: this.#baseEnv(), timeoutMs: 30_000 });
      const works = check.code === 0 && /sara-key-ok/.test(check.stdout);
      let saved = false;
      if (opts.savePassword && opts.confirmRisk) {
        this.#vault.set(vaultKeyOf(id), pwText);
        saved = true;
      } else {
        this.#vault.delete(vaultKeyOf(id));
      }
      this.#update(id, { passwordSaved: saved || undefined, ...(works ? {} : { lastError: `The key was installed, but signing in with it failed: ${this.#explain(s, check)}` }) });
      const announcement = keyAnnouncement({ name: s.name, host: s.host, user: s.user, keyPath: path, publicLine, works, passwordSaved: saved });
      return { server: this.get(id), announcement, keyPath: path, publicLine, passwordSaved: saved };
    } finally {
      pwBuf.fill(0);
    }
  }

  async #makeKey(s: SshServer): Promise<{ path: string; publicLine: string }> {
    this.#mk('keys');
    const path = this.keyFile(s.id, 'made');
    this.#dropKeyFiles(path);
    const r = await this.#run(this.#bins.keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', keyComment(this.#instance, this.#now()), '-f', path], { env: this.#baseEnv(), timeoutMs: 30_000 });
    if (r.code !== 0 || !existsSync(path) || !existsSync(`${path}.pub`)) throw new SshError(`Couldn’t make a key (is ssh-keygen installed?). ${r.stderr.trim().slice(0, 200)}`, 'KEYGEN_FAILED');
    await this.#lockDown(path);
    const publicLine = readFileSync(`${path}.pub`, 'utf8').trim();
    if (!PUBLIC_LINE.test(publicLine)) throw new SshError('The new public key looks wrong.', 'KEYGEN_FAILED');
    return { path, publicLine };
  }

  #dropKeyFiles(path: string): void {
    for (const f of [path, `${path}.pub`]) rmSync(f, { force: true });
  }

  /** The owner gives her a key: pasted text, or the path of a key file on this server (copied). */
  async importKey(id: string, input: { privateKey?: string; keyPath?: string }): Promise<SshServer> {
    const s = this.get(id);
    this.#checkReach(s.host);
    let text = '';
    if (input.privateKey?.trim()) text = input.privateKey.replace(/\r\n/g, '\n').trim() + '\n';
    else if (input.keyPath?.trim()) {
      const p = input.keyPath.trim();
      if (!isAbsolute(p)) throw new SshError('Give the full path of the key file on the Sara server, like /home/alex/.ssh/id_ed25519.', 'BAD_PATH');
      let st;
      try {
        st = statSync(p);
      } catch {
        throw new SshError('There is no file at that path on the Sara server.', 'BAD_PATH');
      }
      if (!st.isFile() || st.size > 20_000) throw new SshError('That isn’t a private key file.', 'BAD_KEY');
      text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim() + '\n';
    } else throw new SshError('Paste the private key, or give the path of the key file on the Sara server.', 'BAD_KEY');
    if (!PEM_KEY.test(text) || text.length > 20_000) throw new SshError('That doesn’t look like an SSH private key (it starts with -----BEGIN OPENSSH and a few more words).', 'BAD_KEY');
    this.#mk('keys');
    const path = this.keyFile(id, 'imported');
    this.#dropKeyFiles(path);
    writeFileSync(path, text, { mode: 0o600 });
    await this.#lockDown(path);
    // The public half (also proves it isn't protected by a passphrase she can't type).
    const pub = await this.#run(this.#bins.keygen, ['-y', '-P', '', '-f', path], { env: this.#baseEnv(), timeoutMs: 15_000 });
    const publicLine = pub.stdout.trim().split(/\r?\n/)[0] ?? '';
    if (pub.code !== 0 || !PUBLIC_LINE.test(publicLine)) {
      this.#dropKeyFiles(path);
      throw new SshError('I can’t use that key: it is protected by a passphrase, or it isn’t a key ssh understands. Use a key without a passphrase, or sign in with the password once so I make my own.', 'BAD_KEY');
    }
    writeFileSync(`${path}.pub`, `${publicLine}\n`, { mode: 0o600 });
    const now = this.#now().toISOString();
    this.#update(id, { key: { path, publicLine, source: 'imported', createdAt: now }, lastError: undefined });
    const t = await this.test(id);
    if (!t.ok) throw new SshError(`I saved the key, but ${s.name} didn’t accept it: ${t.message}`, 'AUTH');
    return this.get(id);
  }

  /** Signs in and runs `true`: does everything work? */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.exec(id, 'echo sara-ok', { timeoutMs: 30_000 });
      return r.code === 0 && /sara-ok/.test(r.stdout) ? { ok: true, message: 'Signed in.' } : { ok: false, message: r.stderr.trim().slice(0, 300) || `exit code ${r.code}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** Runs one command on a server with her key (or the saved password). */
  async exec(id: string, command: string, opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number } = {}): Promise<RunResult> {
    const s = this.get(id);
    this.#checkReach(s.host);
    if (s.pending?.changed) throw new SshError(`The host key of ${s.name} changed since you approved it (now ${s.pending.fingerprint}). I won’t sign in until you check it: Settings → Abilities → Servers over SSH.`, 'HOSTKEY_CHANGED');
    if (!s.fingerprint) throw new SshError(`Approve the host key of ${s.name} first (Settings → Abilities → Servers over SSH).`, 'NO_HOSTKEY');
    if (!command.trim() || command.length > 20_000) throw new SshError('Give the command to run (up to 20,000 characters).', 'BAD_COMMAND');
    const timeoutMs = opts.timeoutMs ?? 120_000;
    let r: RunResult;
    if (s.key && existsSync(s.key.path)) {
      r = await this.#run(this.#bins.ssh, [...this.sshOptions(s, 'key', s.key.path), command], { env: this.#baseEnv(), timeoutMs, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}) });
    } else {
      const pw = this.#vault.get(vaultKeyOf(id));
      if (!pw) throw new SshError(`I have no key for ${s.name} yet. Sign in once with the password in Settings → Abilities → Servers over SSH (I’ll make my own key), or give me a key there.`, 'NO_KEY');
      const buf = Buffer.from(pw, 'utf8');
      const ask = this.#askpass(buf);
      try {
        r = await this.#run(this.#bins.ssh, [...this.sshOptions(s, 'password'), command], { env: this.#baseEnv(ask.env), timeoutMs, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}) });
      } finally {
        ask.cleanup();
        buf.fill(0);
      }
      r = { ...r, stderr: r.stderr.split(pw).join('[REDACTED]') };
    }
    if (r.code === 255 && HOSTKEY_FAIL.test(r.stderr)) {
      await this.#hostKeyChanged(s);
      throw new SshError(this.#explain(s, r), 'HOSTKEY_CHANGED');
    }
    this.#update(id, { lastUsedAt: this.#now().toISOString(), ...(r.code === 255 ? { lastError: this.#explain(s, r) } : { lastError: undefined }) });
    return r;
  }

  /** Forgets a saved password (one click in Settings). */
  forgetPassword(id: string): SshServer {
    this.get(id);
    this.#vault.delete(vaultKeyOf(id));
    return this.#update(id, { passwordSaved: undefined, askedToSavePassword: undefined });
  }

  /**
   * Revokes her key: removes exactly her line from authorized_keys on the server (signing in with
   * that key one last time), then deletes the key files here. Keys the owner gave her are only
   * deleted here (they're his to remove from the server).
   */
  async revokeKey(id: string, opts: { localOnly?: boolean } = {}): Promise<{ server: SshServer; removedFromServer: boolean; message: string }> {
    const s = this.get(id);
    if (!s.key) throw new SshError(`I have no key for ${s.name}.`, 'NO_KEY');
    const key = s.key;
    let removed = false;
    let message = '';
    if (key.source === 'made' && !opts.localOnly) {
      const r = await this.exec(id, revokeScript(key.publicLine), { timeoutMs: 60_000 });
      if (r.code !== 0 || !/sara-key-(removed|gone)/.test(r.stdout)) throw new SshError(`I couldn’t remove my key from ${s.name}: ${this.#explain(s, r)} Nothing was deleted here. Try again, or choose to delete it here only.`, 'REVOKE_FAILED');
      removed = true;
      message = /sara-key-removed/.test(r.stdout) ? `Removed my key from ~/.ssh/authorized_keys on ${s.name} and deleted it here.` : `My key wasn’t in ~/.ssh/authorized_keys on ${s.name} any more; deleted it here.`;
    } else {
      message = key.source === 'imported' ? `Deleted my copy of the key you gave me for ${s.name}. It is still on the server: remove it from ~/.ssh/authorized_keys there if you want it gone.` : `Deleted my key for ${s.name} here only. Its line is still in ~/.ssh/authorized_keys on the server: ${key.publicLine}`;
    }
    this.#dropKeyFiles(key.path);
    return { server: this.#update(id, { key: undefined }), removedFromServer: removed, message };
  }

  /** Removes a server: its key files, known host key and any saved password. */
  remove(id: string): void {
    const s = this.get(id);
    if (s.key) this.#dropKeyFiles(s.key.path);
    rmSync(this.knownHostsFile(id), { force: true });
    this.#vault.delete(vaultKeyOf(id));
    this.#servers = this.#servers.filter((x) => x.id !== id);
    this.#save();
  }

  /** Whether the ssh programs are here (for the settings page). */
  async available(): Promise<boolean> {
    const r = await this.#run(this.#bins.ssh, ['-V'], { env: this.#baseEnv(), timeoutMs: 10_000 }).catch(() => ({ code: null, stdout: '', stderr: '' }) as RunResult);
    return r.code === 0 || /OpenSSH/i.test(r.stderr + r.stdout);
  }
}

/** What she tells the owner after making a key (tool results and the settings card use it). */
export function keyAnnouncement(a: { name: string; host: string; user: string; keyPath: string; publicLine: string; works: boolean; passwordSaved: boolean }): string {
  return [
    `I made my own SSH key for ${a.name} (${a.user}@${a.host}) and added it to ~/.ssh/authorized_keys there.`,
    `The private key is on the Sara server at ${a.keyPath} (the public half next to it, ${a.keyPath}.pub). The line I installed is: ${a.publicLine}`,
    a.works ? 'I checked it: signing in with the key works, so I’ll use the key from now on.' : 'But signing in with the key didn’t work when I checked, so look at the server’s SSH settings (PubkeyAuthentication).',
    a.passwordSaved ? 'You asked me to keep the password, so it is saved encrypted with my other secrets; you can forget it with one click in Settings → Abilities → Servers over SSH.' : 'I did NOT keep the password.',
  ].join(' ');
}

/**
 * A password typed into the chat by mistake ("the password is Hunter2!x"): the value is replaced
 * before the message is stored or sent to a model. Only values that look like passwords (6+
 * characters with a digit or symbol) after a password word, so "the password is too long" stays.
 */
const PW_WORDS = 'password|passwd|passphrase|passcode|pass|pw|pwd|contraseña|clave|mot de passe|passwort|kennwort|senha|parola d[’\']ordine';
const PW_RE = new RegExp(`\\b((?:${PW_WORDS})\\b(?:\\s+(?:for|of|on|para|pour|für|per|de|di|do|da|en|auf|su)(?:\\s+[\\w.@-]{1,60}){1,3}?)?\\s*(?:is|=|:|es|est|ist|é|è|was|será)?\\s*[:=]?\\s*)(["'\`]?)(\\S{6,128})\\2`, 'giu');
export function redactTypedPassword(text: string): { text: string; changed: boolean } {
  let changed = false;
  const out = text.replace(PW_RE, (m: string, lead: string, quote: string, value: string) => {
    const v = value.replace(/[.,;!?)]+$/, '');
    if (v.length < 6 || !/[\d\W_]/u.test(v) || /^\[REDACTED/.test(v)) return m;
    changed = true;
    return `${lead}${quote}[REDACTED]${quote}${value.slice(v.length)}`;
  });
  return { text: out, changed };
}
