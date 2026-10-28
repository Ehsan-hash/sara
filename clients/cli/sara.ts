#!/usr/bin/env node
// sara-chat: Sara in your terminal (Phase 52). The same companion, memory and personality as the
// web app, over the server's own API, signed in with a device code the owner approves.
// Node 24 or newer, no packages. The server's admin command is `sara`; this client is `sara-chat`.
//
//   sara-chat login https://sara.example.com   sign in (shows a code to approve in Settings)
//   sara-chat                                  chat (latest conversation; --new for a new one)
//   sara-chat ask "question" [--dir .]         one question; --dir sends a short folder overview
//   sara-chat send <file> [--library]          share a file in the chat, or keep it in her library
//   sara-chat approve                          answer approvals she is waiting for
//   sara-chat logout                           sign this computer out
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync, lstatSync } from 'node:fs';
import { hostname, homedir, platform } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { createInterface, type Interface } from 'node:readline';

export const VERSION = '0.52.0';

// ---------- output ----------
export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Asks a question and returns the typed line (undefined when there is no terminal). */
  ask?: (q: string) => Promise<string | undefined>;
  color: boolean;
}

const paint = (on: boolean, code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

// ---------- config ----------
export interface Config {
  server?: string;
  token?: string;
  deviceId?: string;
  conversationId?: string;
}

/** Windows: %APPDATA%\sara-chat; Mac: ~/Library/Application Support/sara-chat; else ~/.config/sara-chat. */
export function configDir(env: NodeJS.ProcessEnv = process.env, os = platform()): string {
  if (env.SARA_CHAT_CONFIG_DIR) return env.SARA_CHAT_CONFIG_DIR;
  if (os === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'sara-chat');
  if (os === 'darwin') return join(homedir(), 'Library', 'Application Support', 'sara-chat');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sara-chat');
}

export function loadConfig(dir = configDir()): Config {
  try {
    return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Config;
  } catch {
    return {};
  }
}

/** Saved readable by this user only (0600; on Windows the folder in %APPDATA% is already private). */
export function saveConfig(c: Config, dir = configDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = join(dir, 'config.json');
  writeFileSync(f, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* Windows ignores it */
  }
}

// ---------- HTTP ----------
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeServer(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.|\[::1\])/.test(s) ? 'http' : 'https'}://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export class Client {
  readonly server: string;
  readonly token: string | undefined;
  constructor(server: string, token?: string) {
    this.server = normalizeServer(server);
    this.token = token;
  }

  async raw(path: string, init: { method?: string; body?: unknown; bytes?: Buffer; signal?: AbortSignal } = {}): Promise<Response> {
    const headers: Record<string, string> = { 'user-agent': `sara-chat/${VERSION} (${platform()}) node` };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.bytes) headers['content-type'] = 'application/octet-stream';
    let res: Response;
    try {
      res = await fetch(`${this.server}/api${path}`, { method: init.method ?? (init.body !== undefined || init.bytes ? 'POST' : 'GET'), headers, body: init.bytes ? new Uint8Array(init.bytes) : init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: init.signal, redirect: 'error' });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, `Couldn't reach ${this.server} (${(err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).message}). Is the address right and the server running?`);
    }
    return res;
  }

  async json<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; bytes?: Buffer } = {}): Promise<T> {
    const res = await this.raw(path, init);
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'Not signed in (or this computer was signed out). Run: sara-chat login <server>' : String(data.error ?? `HTTP ${res.status}`));
    return data as T;
  }
}

/** Reads `event:`/`data:` blocks from a server-sent-events body. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (!data) continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* skip */
      }
    }
  }
}

// ---------- folder context (ask --dir) ----------
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.cache', 'coverage', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.terraform', 'secrets', '.secrets']);
/** Never listed or read: env files, keys, certificates, credentials, password stores. */
export const SECRET_FILE = /(^\.env($|\.)|^\.npmrc$|^\.pypirc$|^\.netrc$|^id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn|asc|gpg)$|^credentials(\.\w+)?$|secret|password|token|\.tfstate$|^keystore\.properties$)/i;

export interface FolderContext {
  text: string;
  files: number;
  shownFiles: number;
  readme?: string;
  readmeBytes: number;
}

/** A compact listing (up to `max` entries, 4 levels) plus the README, for asking about a folder. */
export function folderContext(dir: string, opts: { max?: number; readmeBytes?: number } = {}): FolderContext {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${dir} is not a folder.`);
  const max = opts.max ?? 250;
  const lines: string[] = [];
  let files = 0;
  const walk = (d: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (SECRET_FILE.test(e.name) || (e.isDirectory() && SKIP_DIRS.has(e.name)) || e.isSymbolicLink()) continue;
      const p = join(d, e.name);
      const rel = relative(root, p).split(sep).join('/');
      if (e.isDirectory()) {
        if (lines.length < max) lines.push(`${rel}/`);
        if (depth < 4) walk(p, depth + 1);
      } else if (e.isFile()) {
        files++;
        if (lines.length < max) {
          let size = 0;
          try {
            size = lstatSync(p).size;
          } catch {
            /* gone */
          }
          lines.push(`${rel} (${size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`})`);
        }
      }
    }
  };
  walk(root, 0);
  const cap = opts.readmeBytes ?? 6000;
  const readmeName = readdirSync(root).find((n) => /^readme(\.(md|txt|rst))?$/i.test(n));
  let readme: string | undefined;
  if (readmeName) {
    const raw = readFileSync(join(root, readmeName), 'utf8');
    readme = raw.length > cap ? `${raw.slice(0, cap)}\n… (cut at ${cap} characters)` : raw;
  }
  const text = [`Folder "${basename(root)}" (${files} files${lines.length >= max ? `, first ${max} entries listed` : ''}; secrets, .git and node_modules left out):`, ...lines.map((l) => `- ${l}`), ...(readme ? ['', `${readmeName}:`, '```', readme, '```'] : [])].join('\n');
  return { text, files, shownFiles: lines.length, ...(readme ? { readme: readmeName } : {}), readmeBytes: readme?.length ?? 0 };
}

// ---------- the chat itself ----------
interface Conversation {
  id: string;
  title: string;
  partner?: string | null;
  archivedAt?: string | null;
  offRecord?: boolean;
  channel?: string;
}

async function pickConversation(c: Client, cfg: Config, fresh: boolean, mode?: 'coding'): Promise<string> {
  if (!fresh && cfg.conversationId) {
    try {
      await c.json(`/conversations/${encodeURIComponent(cfg.conversationId)}?limit=20`);
      return cfg.conversationId;
    } catch (err) {
      if ((err as ApiError).status !== 404) throw err;
    }
  }
  if (!fresh) {
    const list = await c.json<Conversation[]>('/conversations');
    const latest = (Array.isArray(list) ? list : []).find((x) => !x.partner && !x.archivedAt && !x.offRecord && (x.channel ?? 'web') === 'web');
    if (latest) return latest.id;
  }
  const made = await c.json<Conversation>('/conversations', { body: mode ? { mode } : {} });
  return made.id;
}

/** Asks for the AI disclosure once, the way the web app does (the server refuses chat before it). */
async function ensureDisclosure(c: Client, io: Io): Promise<void> {
  const me = await c.json<{ disclosureAccepted: boolean; disclosure: string }>('/device/whoami');
  if (me.disclosureAccepted) return;
  io.out(`${me.disclosure}\n`);
  const a = io.ask ? await io.ask('Do you understand and agree? [y/N] ') : undefined;
  if (!/^y(es)?$/i.test(a?.trim() ?? '')) throw new Error('Accept the disclosure to chat (here or in the web app).');
  await c.json('/disclosure/accept', { body: {} });
}

export interface TurnResult {
  text: string;
  error?: string;
  stopped: boolean;
}

/**
 * Sends one message and prints her reply as it streams. Approvals are asked inline (y/n).
 * `stopSignal` (Ctrl+C) stops the reply on the server; what she wrote so far is kept there.
 */
export async function runTurn(c: Client, convId: string, content: string, io: Io, opts: { docs?: number[]; stopSignal?: AbortSignal; name?: string } = {}): Promise<TurnResult> {
  const dim = paint(io.color, '2');
  const cyan = paint(io.color, '36');
  const yellow = paint(io.color, '33');
  const red = paint(io.color, '31');
  const ctl = new AbortController();
  let stopped = false;
  const onStop = () => {
    stopped = true;
    void c.raw(`/conversations/${encodeURIComponent(convId)}/stop`, { body: {} }).catch(() => {});
  };
  opts.stopSignal?.addEventListener('abort', onStop, { once: true });
  const res = await c.raw(`/conversations/${encodeURIComponent(convId)}/messages`, { body: { content, ...(opts.docs?.length ? { docs: opts.docs } : {}) }, signal: ctl.signal });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    opts.stopSignal?.removeEventListener('abort', onStop);
    throw new ApiError(res.status, res.status === 401 ? 'Not signed in (or this computer was signed out). Run: sara-chat login <server>' : (data.error ?? `HTTP ${res.status}`));
  }
  let text = '';
  let error: string | undefined;
  let started = false;
  const name = opts.name ?? 'Sara';
  try {
    for await (const ev of sseEvents(res.body)) {
      switch (ev.type) {
        case 'token':
          if (!started) {
            io.out(cyan(`${name}: `));
            started = true;
          }
          text += String(ev.text ?? '');
          io.out(String(ev.text ?? ''));
          break;
        case 'notice':
          io.out(`${started ? '\n' : ''}${dim(`[${String(ev.text ?? '')}]`)}\n`);
          started = false;
          break;
        case 'tool_call':
          io.out(`${started ? '\n' : ''}${dim(`  · ${String(ev.summary ?? ev.name)}`)}\n`);
          started = false;
          break;
        case 'tool_result':
          if (ev.status !== 'ok') io.out(dim(`    ${ev.status === 'denied' ? 'not allowed' : 'failed'}: ${String(ev.output ?? '').split('\n')[0].slice(0, 160)}`) + '\n');
          break;
        case 'approval': {
          io.out(`${started ? '\n' : ''}${yellow(`${name} wants to: ${String(ev.summary ?? ev.name)}`)}\n`);
          started = false;
          const a = io.ask ? await io.ask(yellow('Allow it? [y/N] ')) : undefined;
          const approved = /^y(es)?$/i.test(a?.trim() ?? '');
          if (a === undefined) io.out(dim('  (no terminal to ask: declined; answer it in the app instead with "sara-chat approve")') + '\n');
          await c.json(`/approvals/${encodeURIComponent(String(ev.approvalId))}`, { body: { approved } }).catch((err: Error) => io.err(red(`  ${err.message}`) + '\n'));
          break;
        }
        case 'replace':
          text = String(ev.text ?? '');
          io.out(`\n${dim('[her reply was replaced by a safety check:]')}\n${text}`);
          break;
        case 'claim_check':
          if (Array.isArray(ev.claims) && ev.claims.length) io.out(`\n${dim(`[${ev.claims.length} claim(s) in this reply had no receipt from her tools]`)}`);
          break;
        case 'error':
          error = String(ev.message ?? 'error');
          if (!(stopped && /stopped/i.test(error))) io.out(`${started ? '\n' : ''}${red(error)}`);
          break;
      }
    }
  } finally {
    opts.stopSignal?.removeEventListener('abort', onStop);
  }
  io.out('\n');
  return { text, ...(error ? { error } : {}), stopped };
}

// ---------- commands ----------
export interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  const withValue = new Set(['dir', 'server', 'conversation', 'message', 'name']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (withValue.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else rest.push(a);
  }
  const known = ['login', 'logout', 'chat', 'ask', 'send', 'approve', 'status', 'help'];
  const cmd = rest.length && known.includes(rest[0]) ? rest.shift()! : 'chat';
  return { cmd, rest, flags };
}

export const HELP = `sara-chat ${VERSION}: Sara in your terminal

  sara-chat login <server>          sign in with a code you approve in Settings
  sara-chat                         chat (her latest conversation; --new for a new one)
  sara-chat ask "question"          one question and her answer
       --dir <folder>               also send a short overview of a folder (file list + README;
                                    .env files, keys, .git and node_modules are never sent)
  sara-chat send <file>             share a file in the chat (--library: keep it in her library;
       --message "text"             say something with it)
  sara-chat approve                 answer approvals she's waiting for (y/n)
  sara-chat status                  who you're signed in as, and where
  sara-chat logout                  sign this computer out

Options: --new (a new conversation)  --conversation <id>  --server <url>  --no-color
While she replies, Ctrl+C stops her reply. At the prompt, Ctrl+C or /quit leaves.
In chat: /new starts a new conversation, /quit leaves.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function login(serverArg: string | undefined, io: Io, dir = configDir(), opts: { name?: string; maxWaitMs?: number } = {}): Promise<number> {
  const cfg = loadConfig(dir);
  const server = serverArg ?? cfg.server;
  if (!server) {
    io.err('Which server? Run: sara-chat login https://your-sara-address\n');
    return 2;
  }
  const c = new Client(server);
  const bold = paint(io.color, '1');
  const name = opts.name ?? `sara-chat on ${platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'Mac' : 'Linux'} (${hostname().slice(0, 30)})`;
  const r = await c.json<{ code: string; pollToken: string; verifyUrl: string; interval: number; expiresAt: string; approveIn: string }>('/device/start', { body: { name } });
  io.out(`To sign in "${name}", approve this code on ${c.server}:\n\n    ${bold(r.code)}\n\nOpen ${r.verifyUrl} where you're signed in and type the code, or go to ${r.approveIn}.\nWaiting (up to 10 minutes; Ctrl+C to give up)…\n`);
  const until = Math.min(Date.parse(r.expiresAt), Date.now() + (opts.maxWaitMs ?? 10 * 60_000));
  while (Date.now() < until) {
    await sleep(Math.max(1, r.interval) * 1000);
    const res = await c.raw('/device/poll', { body: { pollToken: r.pollToken } });
    const body = (await res.json().catch(() => ({}))) as { status?: string; token?: string; deviceId?: string; error?: string };
    if (body.status === 'approved' && body.token) {
      saveConfig({ server: c.server, token: body.token, deviceId: body.deviceId }, dir);
      io.out(`Signed in. Saved in ${join(dir, 'config.json')} (only your user can read it).\n`);
      return 0;
    }
    if (body.status === 'denied') {
      io.err('The sign-in was denied.\n');
      return 1;
    }
    if (res.status === 410 || body.status === 'expired') {
      io.err('The code expired. Run sara-chat login again.\n');
      return 1;
    }
    if (res.status === 429) {
      io.err(`${body.error ?? 'Too many attempts.'}\n`);
      return 1;
    }
  }
  io.err('Gave up waiting. Run sara-chat login again.\n');
  return 1;
}

function signedIn(io: Io, dir: string, flags: Record<string, string | boolean>): { c: Client; cfg: Config } | undefined {
  const cfg = loadConfig(dir);
  if (!cfg.token || !(cfg.server || flags.server)) {
    io.err('Not signed in yet. Run: sara-chat login https://your-sara-address\n');
    return undefined;
  }
  // The saved token only ever goes to the server it was issued by (--server can't redirect it).
  if (flags.server && cfg.server) {
    let same = false;
    try {
      same = normalizeServer(String(flags.server)) === normalizeServer(cfg.server);
    } catch {
      same = false;
    }
    if (!same) {
      io.err(`This computer is signed in to ${cfg.server}, not ${String(flags.server)}. Your sign-in is only sent to the server it came from. To use the other one, run: sara-chat login ${String(flags.server)}\n`);
      return undefined;
    }
  }
  if (!cfg.server) {
    io.err('Not signed in yet. Run: sara-chat login https://your-sara-address\n');
    return undefined;
  }
  return { c: new Client(cfg.server, cfg.token), cfg };
}

async function companionName(c: Client): Promise<string> {
  try {
    return (await c.json<{ companion: string }>('/device/whoami')).companion || 'Sara';
  } catch {
    return 'Sara';
  }
}

/** Ctrl+C while she replies: stop the reply. At the prompt: leave. */
async function interactive(io: Io, rl: Interface, run: (line: string, stop: AbortSignal) => Promise<'quit' | void>, prompt: string): Promise<void> {
  const ask = lineAsker(rl);
  let busy: AbortController | undefined;
  let closed = false;
  rl.on('SIGINT', () => {
    if (busy) {
      busy.abort();
      io.out(paint(io.color, '2')('\n[stopping her reply…]\n'));
    } else rl.close();
  });
  rl.on('close', () => (closed = true));
  while (!closed) {
    const line = await ask(prompt);
    if (line === undefined) break;
    busy = new AbortController();
    try {
      if ((await run(line, busy.signal)) === 'quit') break;
    } catch (err) {
      io.err(paint(io.color, '31')((err as Error).message) + '\n');
    } finally {
      busy = undefined;
    }
  }
  rl.close();
}

export async function main(argv: string[], io: Io, dir = configDir(), rl?: Interface): Promise<number> {
  const { cmd, rest, flags } = parseArgs(argv);
  if (flags['no-color']) io.color = false;
  if (flags.version) return (io.out(`${VERSION}\n`), 0);
  if (flags.help || cmd === 'help') return (io.out(`${HELP}\n`), 0);
  try {
    if (cmd === 'login') return await login(rest[0] ?? (flags.server ? String(flags.server) : undefined), io, dir);
    if (cmd === 'logout') {
      const cfg = loadConfig(dir);
      if (cfg.token && cfg.server) await new Client(cfg.server, cfg.token).json('/device/logout', { body: {} }).catch(() => undefined);
      if (existsSync(join(dir, 'config.json'))) rmSync(join(dir, 'config.json'));
      io.out('Signed out. This computer no longer has a token for Sara.\n');
      return 0;
    }
    const s = signedIn(io, dir, flags);
    if (!s) return 1;
    const { c, cfg } = s;
    if (cmd === 'status') {
      const me = await c.json<{ companion: string; device: { label: string } | null }>('/device/whoami');
      io.out(`Signed in to ${c.server} as "${me.device?.label ?? 'this computer'}". Talking with ${me.companion}.${cfg.conversationId ? ` Conversation: ${cfg.conversationId}` : ''}\n`);
      return 0;
    }
    const name = await companionName(c);
    if (cmd === 'approve') {
      const convId = String(flags.conversation || cfg.conversationId || (await pickConversation(c, cfg, false)));
      const conv = await c.json<{ activity: { approvals: { approvalId: string; summary: string; name: string }[] } | null }>(`/conversations/${encodeURIComponent(convId)}?limit=20`);
      const waiting = conv.activity?.approvals ?? [];
      if (!waiting.length) return (io.out('Nothing is waiting for your OK in this conversation.\n'), 0);
      for (const a of waiting) {
        const ans = io.ask ? await io.ask(`${name} wants to: ${a.summary}. Allow it? [y/N] `) : undefined;
        await c.json(`/approvals/${encodeURIComponent(a.approvalId)}`, { body: { approved: /^y(es)?$/i.test(ans?.trim() ?? '') } });
      }
      return 0;
    }
    await ensureDisclosure(c, io);
    if (cmd === 'ask') {
      const question = rest.join(' ').trim();
      if (!question) return (io.err('What should I ask? sara-chat ask "your question"\n'), 2);
      let content = question;
      if (flags.dir) {
        const ctx = folderContext(String(flags.dir === true ? '.' : flags.dir));
        io.err(paint(io.color, '2')(`Sending: a list of ${ctx.shownFiles} entries (${ctx.files} files)${ctx.readme ? ` and ${ctx.readme} (${Math.round(ctx.readmeBytes / 1024)} KB)` : ''} from ${resolve(String(flags.dir === true ? '.' : flags.dir))}`) + '\n');
        content = `${question}\n\n[From the terminal: the owner shared this folder overview with the question.]\n${ctx.text}`;
      }
      const convId = flags.conversation ? String(flags.conversation) : await pickConversation(c, cfg, !flags.continue, flags.dir ? 'coding' : undefined);
      saveConfig({ ...cfg, conversationId: convId }, dir);
      const stop = new AbortController();
      const onInt = () => stop.abort();
      process.once('SIGINT', onInt);
      try {
        const r = await runTurn(c, convId, content, io, { stopSignal: stop.signal, name });
        return r.error && !r.stopped ? 1 : 0;
      } finally {
        process.off('SIGINT', onInt);
      }
    }
    if (cmd === 'send') {
      const file = rest[0];
      if (!file || !existsSync(file) || !statSync(file).isFile()) return (io.err('Which file? sara-chat send <file> [--library]\n'), 2);
      if (SECRET_FILE.test(basename(file))) return (io.err(`${basename(file)} looks like a secret (keys, .env, passwords): not sent.\n`), 2);
      const bytes = readFileSync(file);
      const library = Boolean(flags.library);
      const convId = library ? undefined : flags.conversation ? String(flags.conversation) : await pickConversation(c, cfg, Boolean(flags.new));
      const q = new URLSearchParams({ name: basename(file), keep: library ? '1' : '0', ...(convId ? { conversation: convId } : {}) });
      const r = await c.json<{ doc: { id: number; name: string }; already?: boolean }>(`/library?${q}`, { bytes });
      if (library) {
        io.out(`${r.already ? 'Already in' : 'Added to'} ${name}'s library: ${r.doc.name}. She reads it in the background.\n`);
        return 0;
      }
      saveConfig({ ...cfg, conversationId: convId }, dir);
      const res = await runTurn(c, convId!, String(flags.message || '(document)'), io, { docs: [r.doc.id], name });
      return res.error ? 1 : 0;
    }
    // Interactive chat.
    let convId = flags.conversation ? String(flags.conversation) : await pickConversation(c, cfg, Boolean(flags.new));
    saveConfig({ ...cfg, conversationId: convId }, dir);
    const line = rl ?? createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    io.ask = lineAsker(line);
    io.out(paint(io.color, '2')(`Talking with ${name} (conversation ${convId}). /new for a new conversation, /quit to leave. Ctrl+C stops her reply.`) + '\n');
    await interactive(io, line, async (text, stop) => {
      const t = text.trim();
      if (!t) return;
      if (t === '/quit' || t === '/exit') return 'quit';
      if (t === '/new') {
        convId = await pickConversation(c, cfg, true);
        saveConfig({ ...cfg, conversationId: convId }, dir);
        io.out(paint(io.color, '2')(`New conversation ${convId}.`) + '\n');
        return;
      }
      await runTurn(c, convId, t, io, { stopSignal: stop, name });
    }, paint(io.color, '1')('you: '));
    return 0;
  } catch (err) {
    io.err(paint(io.color, '31')((err as Error).message) + '\n');
    return 1;
  }
}

/**
 * Line questions on the terminal (or piped stdin). Lines that arrive before a question is asked
 * wait in a queue (piped input isn't lost); resolves undefined once input has ended.
 */
export function lineAsker(rl: Interface): (q: string) => Promise<string | undefined> {
  const known = (rl as Interface & { _saraAsker?: (q: string) => Promise<string | undefined> })._saraAsker;
  if (known) return known;
  let closed = false;
  const lines: string[] = [];
  const waiting: ((a: string | undefined) => void)[] = [];
  rl.on('line', (l) => {
    const w = waiting.shift();
    if (w) w(l);
    else lines.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(undefined);
  });
  const ask = (q: string) =>
    new Promise<string | undefined>((r) => {
      if (lines.length) {
        process.stdout.write(q);
        return r(lines.shift());
      }
      if (closed) return r(undefined);
      rl.setPrompt(q);
      rl.prompt();
      waiting.push(r);
    });
  (rl as Interface & { _saraAsker?: typeof ask })._saraAsker = ask;
  return ask;
}

const isMain = process.argv[1] && /sara(-chat)?(\.ts|\.mjs|\.js)?$/.test(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '') && import.meta.url.endsWith('/sara.ts');
if (isMain) {
  const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  const chat = parsed.cmd === 'chat' && !parsed.flags.help && !parsed.flags.version;
  // One reader for stdin: the chat prompt and the y/n questions (approvals, the disclosure). With
  // nothing to read (input closed), questions get no answer and nothing is allowed.
  let rl: Interface | undefined;
  const reader = () => {
    if (!rl) {
      rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
      lineAsker(rl); // start queueing lines at once
      // Outside the chat prompt, Ctrl+C on the terminal stops her reply (ask, send) or leaves.
      if (!chat) rl.on('SIGINT', () => (process.listenerCount('SIGINT') ? process.emit('SIGINT', 'SIGINT') : process.exit(130)));
    }
    return rl;
  };
  let asker: ((q: string) => Promise<string | undefined>) | undefined;
  const io: Io = {
    out: (s) => void process.stdout.write(s),
    err: (s) => void process.stderr.write(s),
    color: tty,
    ask: (q) => (asker ??= lineAsker(reader()))(q),
  };
  main(args, io, configDir(), chat ? reader() : undefined).then((code) => {
    rl?.close();
    process.exitCode = code;
    setTimeout(() => process.exit(code), 50).unref();
  });
}
