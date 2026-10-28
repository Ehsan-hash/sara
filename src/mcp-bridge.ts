#!/usr/bin/env node
// Phase 57: a stdio bridge to Sara's MCP server, for MCP apps that start a program instead of
// calling an address (Claude Desktop, some editors). This file is standalone (Node built-ins only):
// Settings → Connections → Other apps downloads it as sara-mcp.ts, and clients/mcp/sara-mcp.ts in
// the repo runs it. It reads JSON-RPC lines on stdin, sends each
// one to <server>/mcp with the API key, and writes the answers (JSON or SSE) back as lines on
// stdout. Zero dependencies; Node 24 runs it as is.
//
//   node sara-mcp.ts --server https://sara.example.ts.net      (key in SARA_API_KEY)
//   node sara-mcp.ts --server http://127.0.0.1:7860 --key-file ~/.sara-api-key
//
// The key never goes on the command line (other programs on the computer can read that).
// Logs go to stderr only (stdout is the protocol).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

interface Options {
  server: string;
  key: string;
}

function usage(msg: string): never {
  process.stderr.write(`sara-mcp: ${msg}\nUse: node sara-mcp.ts --server https://<her address> [--key-file <file>]  (or set SARA_URL and SARA_API_KEY)\n`);
  process.exit(2);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Options {
  let server = env.SARA_URL ?? '';
  let keyFile = env.SARA_API_KEY_FILE ?? '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server' || a === '--url') server = argv[++i] ?? '';
    else if (a === '--key-file') keyFile = argv[++i] ?? '';
    else if (a === '--key') usage("don't put the key on the command line: use SARA_API_KEY or --key-file.");
    else if (a === '--help' || a === '-h') usage('a bridge from stdio to Sara’s MCP server.');
    else usage(`unknown option ${a}`);
  }
  let key = (env.SARA_API_KEY ?? '').trim();
  if (!key && keyFile) {
    try {
      key = readFileSync(keyFile.replace(/^~(?=$|[\\/])/, homedir()), 'utf8').trim();
    } catch (err) {
      usage(`can't read the key file: ${(err as Error).message}`);
    }
  }
  if (!server) usage('say which server (--server or SARA_URL).');
  if (!key) usage('no API key (SARA_API_KEY or --key-file). Make one in Sara: Settings → Connections → Other apps.');
  let u: URL;
  try {
    u = new URL(server);
  } catch {
    usage(`"${server}" isn't a web address.`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') usage('the server address must start with https:// (or http:// on your own network).');
  const endpoint = u.pathname.replace(/\/+$/, '').endsWith('/mcp') ? u.href.replace(/\/+$/, '') : `${u.origin}${u.pathname.replace(/\/+$/, '')}/mcp`;
  return { server: endpoint, key };
}

/** The JSON-RPC messages in an SSE body (each `data:` event). */
export function sseMessages(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data.trim()) out.push(data);
  }
  return out;
}

export function startBridge(opts: Options, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout, fetchFn: typeof fetch = fetch): Promise<void> {
  let version = ''; // from the initialize answer (handshake revisions)
  const pending = new Set<Promise<void>>();
  const send = (obj: unknown) => output.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
  const fail = (id: unknown, message: string, code = -32603) => {
    if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } });
  };
  const forward = async (line: string) => {
    let msg: { id?: unknown; method?: unknown; params?: Record<string, unknown>; result?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
    }
    const meta = msg.params?._meta as Record<string, unknown> | undefined;
    const pv = typeof meta?.['io.modelcontextprotocol/protocolVersion'] === 'string' ? String(meta['io.modelcontextprotocol/protocolVersion']) : msg.method === 'initialize' ? '' : version;
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${opts.key}`, 'user-agent': 'sara-mcp-bridge/1' };
    if (pv) headers['mcp-protocol-version'] = pv;
    if (typeof msg.method === 'string') headers['mcp-method'] = msg.method;
    const nm = msg.params?.name ?? msg.params?.uri;
    if (typeof nm === 'string' && /^[\x20-\x7e]*$/.test(nm)) headers['mcp-name'] = nm;
    let res: Response;
    try {
      res = await fetchFn(opts.server, { method: 'POST', headers, body: line });
    } catch (err) {
      return fail(msg.id, `Can't reach Sara at ${opts.server}: ${(err as Error).message}`);
    }
    if (res.status === 202) return;
    const type = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const messages = type.includes('text/event-stream') ? sseMessages(body) : body.trim() ? [body.trim()] : [];
    if (!messages.length) return fail(msg.id, `Sara answered ${res.status} with nothing.`);
    for (const m of messages) {
      try {
        const parsed = JSON.parse(m) as { id?: unknown; result?: { protocolVersion?: unknown }; error?: unknown };
        if (msg.method === 'initialize' && typeof parsed.result?.protocolVersion === 'string') version = parsed.result.protocolVersion;
        // An error without the request's id (401, 403…): give it the id so the app can show it.
        send(parsed.error && parsed.id === undefined && msg.id !== undefined ? { ...parsed, id: msg.id } : parsed);
      } catch {
        fail(msg.id, `Sara answered ${res.status}: ${m.slice(0, 200)}`);
      }
    }
  };
  return new Promise((resolve) => {
    const rl = createInterface({ input, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const p: Promise<void> = forward(line).then(
        () => undefined,
        (err: Error) => void process.stderr.write(`sara-mcp: ${err.message}\n`),
      );
      pending.add(p);
      void p.finally(() => pending.delete(p));
    });
    rl.on('close', () => void Promise.allSettled([...pending]).then(() => resolve()));
  });
}

if (process.argv[1] && /(sara-mcp|mcp-bridge)\.(ts|js|mjs)$/.test(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2), process.env);
  void startBridge(opts).then(() => process.exit(0));
}
