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
//   node sara-mcp.ts --describe      (no server: answers initialize and tools/list with her tools,
//                                     for MCP directories that check a server by starting it)
//
// The key never goes on the command line (other programs on the computer can read that).
// Logs go to stderr only (stdout is the protocol).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

interface Options {
  server: string;
  key: string;
  /** No server: answer the handshake and tools/list locally; tool calls explain how to connect. */
  describe?: boolean;
}

function usage(msg: string): never {
  process.stderr.write(`sara-mcp: ${msg}\nUse: node sara-mcp.ts --server https://<her address> [--key-file <file>]  (or set SARA_URL and SARA_API_KEY)\n`);
  process.exit(2);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Options {
  if (argv.includes('--describe')) return { server: '', key: '', describe: true };
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

/**
 * Her MCP tools, as Sara's server lists them (all of them; a real server hides write tools unless the
 * owner allows changes). Kept identical to describeTools() in src/mcp-server.ts by a test.
 */
export const DESCRIBE_TOOLS = [
  {
    "name": "search_memory",
    "title": "Search her memory",
    "description": "Search Sara's long-term memory about the owner (facts, summaries of past conversations, decisions, promises, dates). Use it for context about the owner's life, preferences and projects.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Words to look for, e.g. \"sister\" or \"deploy server\"."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Up to how many notes (default 10)."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Search her memory",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "list_facts",
    "title": "What she knows about the owner",
    "description": "List the facts Sara has learned about the owner, newest first.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "description": "Up to how many (default 30)."
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "title": "What she knows about the owner",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "recent_conversations",
    "title": "Recent conversations",
    "description": "Titles and short summaries of the owner's recent conversations with Sara (never other people's chats or private conversations).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30,
          "description": "Up to how many (default 10)."
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "title": "Recent conversations",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "get_today",
    "title": "Today",
    "description": "Today's agenda from Sara's planner: to-dos due today or overdue, reminders in the next 24 hours, calendar events (when connected) and dates that matter coming up.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "annotations": {
      "title": "Today",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "list_tasks",
    "title": "To-dos",
    "description": "The owner's to-do list in Sara's planner.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "open",
            "done",
            "all"
          ],
          "description": "Which ones (default open)."
        },
        "project": {
          "type": "string",
          "description": "Only this project (name)."
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "title": "To-dos",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "search_library",
    "title": "Search her library",
    "description": "Search the documents the owner keeps in Sara's library (PDFs, Word, spreadsheets, books, web pages) by words and meaning. Answers quote the passages with where they are.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "What to look for, e.g. \"when does the lease end\"."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Search her library",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "list_notes",
    "title": "Notes",
    "description": "The owner's notes in Sara's planner (title and id). Read one with read_note.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Only notes with these words."
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "title": "Notes",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "read_note",
    "title": "Read a note",
    "description": "Read one of the owner's notes by its id (from list_notes).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "description": "The note id."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Read a note",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "ask_sara",
    "title": "Ask Sara",
    "description": "Send Sara a message and get her reply. She answers in her own conversation for this app (the owner can read it in Sara), with her memory and personality. Use it to ask her something or tell her something worth remembering.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "message": {
          "type": "string",
          "description": "What to say to her."
        }
      },
      "required": [
        "message"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Ask Sara",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "add_task",
    "title": "Add a to-do",
    "description": "Add a to-do to the owner's planner in Sara.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "due": {
          "type": "string",
          "description": "When, in words: \"tomorrow 9am\", \"friday\", \"2026-11-03\"."
        },
        "project": {
          "type": "string"
        },
        "priority": {
          "type": "string",
          "enum": [
            "low",
            "normal",
            "high"
          ]
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Add a to-do",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "add_note",
    "title": "Add a note",
    "description": "Save a note in the owner's planner in Sara.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "project": {
          "type": "string"
        }
      },
      "required": [
        "title",
        "body"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Add a note",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "remember_fact",
    "title": "Tell her something to remember",
    "description": "Ask Sara to remember a fact about the owner. The owner always approves it in Sara first.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "fact": {
          "type": "string",
          "description": "One short fact, e.g. \"Prefers tabs over spaces\"."
        }
      },
      "required": [
        "fact"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "title": "Tell her something to remember",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": false
    }
  }
];

const DESCRIBE_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const CONNECT_HINT = 'This is the Sara MCP bridge in --describe mode, with no Sara server behind it. Run your own Sara (https://github.com/farena-ai/sara), make an API key in Settings → Connections → Other apps, and start the bridge with --server https://<her address> and SARA_API_KEY.';

/** --describe: answers locally, never contacts anything. */
export function describeAnswer(msg: { id?: unknown; method?: unknown; params?: Record<string, unknown> }): unknown {
  if (msg.id === undefined || msg.id === null) return undefined; // notifications need no answer
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const want = String(msg.params?.protocolVersion ?? '');
      return ok({ protocolVersion: DESCRIBE_VERSIONS.includes(want) ? want : DESCRIBE_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sara', title: 'Sara', version: 'describe' }, instructions: CONNECT_HINT });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: DESCRIBE_TOOLS });
    case 'tools/call':
      return ok({ content: [{ type: 'text', text: CONNECT_HINT }], isError: true });
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${String(msg.method).slice(0, 60)}` } };
  }
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
    if (opts.describe) {
      const answer = describeAnswer(msg);
      if (answer !== undefined) send(answer);
      return;
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
  if (opts.describe) process.stderr.write('sara-mcp: --describe mode (no server): listing her tools only.\n');
  void startBridge(opts).then(() => process.exit(0));
}
