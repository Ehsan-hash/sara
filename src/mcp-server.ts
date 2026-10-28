// Phase 57: Sara as an MCP server, so Claude Code, Cursor, Claude Desktop and other MCP apps can
// use her memory, planner, library and notes. Streamable HTTP at /mcp (JSON-RPC over POST; a
// single JSON answer, or an SSE stream for tool calls), with the API key as a Bearer token.
// Clients/mcp/sara-mcp.ts bridges stdio apps to it.
//
// Both protocol eras are served ("dual-era"): the handshake revisions 2025-03-26, 2025-06-18 and
// 2025-11-25 (`initialize`, then requests; no sessions are minted, every request stands alone)
// and the stateless 2026-07-28 revision (every request carries its version in
// params._meta["io.modelcontextprotocol/protocolVersion"] and the MCP-Protocol-Version header;
// `server/discover`; results carry resultType).
//
// What she shares: read-only tools by default (memory notes, facts, recent conversation titles
// and summaries, today's agenda, to-dos, library passages, planner notes) and `ask_sara`.
// Never: secrets or the vault, partner chats (other people's), private conversations, imported
// history from other assistants' raw lines, or anything explicit while Adult mode is off. Write
// tools (add_task, add_note, remember_fact) appear only when the owner turns on "Let other apps
// change things", and follow her approval rules (an action that asks first waits in Sara).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OwnerAuth } from './auth.ts';
import type { AppContext } from './chat.ts';
import { localDate } from './memory-worker.ts';
import { formatLocal, parseWhen, type Priority } from './planner.ts';
import { appConversation, callerOf, corsAllowed, externalTurn, type KeyLimiter, otherAppsSettings, type Caller } from './other-apps.ts';
import { sharedWithApps } from './recall.ts';
import { detectExplicit } from './safety.ts';
import { adultModeOn } from './settings.ts';
import { buildToday } from './today.ts';

/** Revisions with the `initialize` handshake, newest first. */
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
/** Stateless revisions (per-request metadata). */
export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const SUPPORTED_VERSIONS: string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const MAX_BODY = 1024 * 1024;

export interface McpDeps {
  app: AppContext;
  auth: OwnerAuth;
  demo?: boolean;
  version: string;
  limiter: KeyLimiter;
  /**
   * Asks the owner in Sara before a change (an approval card in the app's MCP conversation).
   * `run` happens only after Allow; its words are posted there.
   */
  requestApproval?: (conversationId: string, name: string, summary: string, args: Record<string, unknown>, run: () => Promise<string>) => void;
}

type Json = Record<string, unknown>;
interface RpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Json;
}

class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly http: number;
  constructor(code: number, message: string, data?: unknown, http = 200) {
    super(message);
    this.code = code;
    this.data = data;
    this.http = http;
  }
}

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function writeJson(res: ServerResponse, status: number, body: unknown, version?: string): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...HEADERS, ...(version ? { 'mcp-protocol-version': version } : {}) });
  res.end(JSON.stringify(body));
}

const rpcError = (id: RpcRequest['id'], e: RpcError) => ({ jsonrpc: '2.0', ...(id !== undefined && id !== null ? { id } : {}), error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) } });

// ---------- what she shares ----------

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  write?: boolean;
  run: (args: Json, cx: CallContext) => Promise<string>;
}

interface CallContext {
  deps: McpDeps;
  app: AppContext;
  caller: Caller;
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : def));

/** The conversations that are the owner's own (never other people's, never private, never imported). */
function shareableConversation(app: AppContext, id: string | null): boolean {
  // A memory from a deleted conversation (or none) is still hers. Same rule as other apps' turns (M3).
  return !id || sharedWithApps(app.store.getConversation(id));
}

/** With Adult mode off, nothing explicit leaves: such lines are left out. Secrets are always scrubbed. */
function clean(app: AppContext, text: string): string {
  const adult = adultModeOn(app.settings.get());
  const kept: string[] = [];
  let dropped = 0;
  for (const block of text.split(/\n(?=\S)|\n\n/)) {
    if (!adult && detectExplicit(block)) dropped++;
    else kept.push(block);
  }
  const out = app.redactor.redact(kept.join('\n'));
  return dropped ? `${out}${out ? '\n' : ''}(${dropped} item${dropped === 1 ? '' : 's'} left out: Adult mode is off.)` : out;
}

function memoryLines(app: AppContext, opts: { q?: string; kind?: 'fact'; limit: number }): string {
  if (!app.memory || app.settings.get().memory?.enabled === false) return 'Her memory is turned off.';
  const list = app.memory
    .list({ ...(opts.q ? { q: opts.q } : {}), ...(opts.kind ? { kind: opts.kind } : {}), limit: Math.min(200, opts.limit * 3) })
    .filter((m) => m.supersededBy === null && shareableConversation(app, m.conversationId))
    .slice(0, opts.limit);
  if (!list.length) return opts.q ? `Nothing in her memory about “${opts.q}”.` : 'No notes yet.';
  return list.map((m) => `- [${m.kind}, ${m.happenedOn}] ${m.content.replace(/\s+/g, ' ')}`).join('\n');
}

const TOOLS: ToolDef[] = [
  {
    name: 'search_memory',
    title: 'Search her memory',
    description: "Search Sara's long-term memory about the owner (facts, summaries of past conversations, decisions, promises, dates). Use it for context about the owner's life, preferences and projects.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for, e.g. "sister" or "deploy server".' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Up to how many notes (default 10).' } }, required: ['query'], additionalProperties: false },
    async run(args, { app }) {
      const q = str(args.query, 200);
      if (!q) throw new RpcError(-32602, 'Say what to look for (query).');
      return clean(app, memoryLines(app, { q, limit: num(args.limit, 10, 50) }));
    },
  },
  {
    name: 'list_facts',
    title: 'What she knows about the owner',
    description: 'List the facts Sara has learned about the owner, newest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Up to how many (default 30).' } }, additionalProperties: false },
    async run(args, { app }) {
      return clean(app, memoryLines(app, { kind: 'fact', limit: num(args.limit, 30, 100) }));
    },
  },
  {
    name: 'recent_conversations',
    title: 'Recent conversations',
    description: "Titles and short summaries of the owner's recent conversations with Sara (never other people's chats or private conversations).",
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Up to how many (default 10).' } }, additionalProperties: false },
    async run(args, { app }) {
      const limit = num(args.limit, 10, 30);
      const tz = app.settings.get().timeZone;
      const convs = app.store.listConversations().filter((c) => shareableConversation(app, c.id) && !c.archivedAt).slice(0, limit);
      if (!convs.length) return 'No conversations yet.';
      const summaries = app.memory?.list({ kind: 'summary', limit: 400 }) ?? [];
      return clean(
        app,
        convs
          .map((c) => {
            const sum = summaries.find((m) => m.conversationId === c.id)?.content.replace(/\s+/g, ' ').slice(0, 300);
            return `- ${c.title} (${c.mode === 'coding' ? 'coding, ' : ''}last ${formatLocal(c.updatedAt, tz)})${sum ? `: ${sum}` : ''}`;
          })
          .join('\n'),
      );
    },
  },
  {
    name: 'get_today',
    title: 'Today',
    description: "Today's agenda from Sara's planner: to-dos due today or overdue, reminders in the next 24 hours, calendar events (when connected) and dates that matter coming up.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, { app }) {
      const t = await buildToday(app);
      const tz = app.settings.get().timeZone;
      const lines = [`${t.date}`];
      lines.push(t.agenda.tasks.length ? `To-dos:\n${t.agenda.tasks.map((x) => `- #${x.id} ${x.title}${x.dueAt ? ` (due ${formatLocal(x.dueAt, tz)}${x.overdue ? ', overdue' : ''})` : ''}${x.project ? ` [${x.project}]` : ''}`).join('\n')}` : 'No to-dos due today.');
      if (t.agenda.reminders.length) lines.push(`Reminders:\n${t.agenda.reminders.map((r) => `- ${formatLocal(r.dueAt, tz)}: ${r.text}`).join('\n')}`);
      if (t.calendar?.events.length) lines.push(`Calendar:\n${t.calendar.events.map((e) => `- ${e.allDay ? 'all day' : formatLocal(e.start, tz)}: ${e.title}${e.location ? ` (${e.location})` : ''}`).join('\n')}`);
      if (t.dates.length) lines.push(`Coming up:\n${t.dates.map((d) => `- in ${d.inDays} day${d.inDays === 1 ? '' : 's'}: ${d.what}`).join('\n')}`);
      return clean(app, lines.join('\n\n'));
    },
  },
  {
    name: 'list_tasks',
    title: 'To-dos',
    description: "The owner's to-do list in Sara's planner.",
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Which ones (default open).' }, project: { type: 'string', description: 'Only this project (name).' } }, additionalProperties: false },
    async run(args, { app }) {
      if (!app.planner) return 'The planner is not available.';
      const status = args.status === 'done' || args.status === 'all' ? args.status : 'open';
      const project = str(args.project, 80).toLowerCase();
      const tz = app.settings.get().timeZone;
      const list = app.planner.tasks({ status }).filter((t) => !project || (t.project ?? '').toLowerCase() === project).slice(0, 100);
      if (!list.length) return status === 'open' ? 'Nothing open.' : 'No to-dos.';
      return clean(app, list.map((t) => `- #${t.id} [${t.status === 'done' ? 'x' : ' '}] ${t.title}${t.priority !== 'normal' ? ` (${t.priority})` : ''}${t.dueAt ? ` due ${formatLocal(t.dueAt, tz)}` : ''}${t.project ? ` [${t.project}]` : ''}`).join('\n'));
    },
  },
  {
    name: 'search_library',
    title: 'Search her library',
    description: "Search the documents the owner keeps in Sara's library (PDFs, Word, spreadsheets, books, web pages) by words and meaning. Answers quote the passages with where they are.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, e.g. "when does the lease end".' } }, required: ['query'], additionalProperties: false },
    async run(args, { app }) {
      const q = str(args.query, 300);
      if (!q) throw new RpcError(-32602, 'Say what to look for (query).');
      if (!app.library) return 'There is no library here.';
      const { embedTarget } = await import('./embeddings.ts');
      const hits = (await app.library.find(q, { target: embedTarget(app), limit: 8, timeoutMs: 4000 })).filter((h) => h.doc.keep && !h.doc.conversationId).slice(0, 6);
      if (!hits.length) return `Nothing about “${q}” in her library.`;
      return clean(app, hits.map((h) => `[${h.doc.title || h.doc.name}${h.passage.place ? `, ${h.passage.place}` : ''}]\n${h.passage.text.slice(0, 1400)}`).join('\n\n'));
    },
  },
  {
    name: 'list_notes',
    title: 'Notes',
    description: "The owner's notes in Sara's planner (title and id). Read one with read_note.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Only notes with these words.' } }, additionalProperties: false },
    async run(args, { app }) {
      if (!app.planner) return 'The planner is not available.';
      const list = app.planner.notes(str(args.query, 200) || undefined, 100);
      if (!list.length) return 'No notes.';
      return clean(app, list.map((n) => `- #${n.id} ${n.title}${n.project ? ` [${n.project}]` : ''} (updated ${n.updatedAt.slice(0, 10)})`).join('\n'));
    },
  },
  {
    name: 'read_note',
    title: 'Read a note',
    description: 'Read one of the owner\'s notes by its id (from list_notes).',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'The note id.' } }, required: ['id'], additionalProperties: false },
    async run(args, { app }) {
      const n = app.planner?.note(Number(args.id));
      if (!n) throw new RpcError(-32602, 'No note with that id. Use list_notes.');
      return clean(app, `# ${n.title}\n\n${n.body}`);
    },
  },
  {
    name: 'ask_sara',
    title: 'Ask Sara',
    description: "Send Sara a message and get her reply. She answers in her own conversation for this app (the owner can read it in Sara), with her memory and personality. Use it to ask her something or tell her something worth remembering.",
    inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'What to say to her.' } }, required: ['message'], additionalProperties: false },
    async run(args, cx) {
      const { app, caller } = cx;
      const message = str(args.message, 20_000);
      if (!message) throw new RpcError(-32602, 'Say what to send her (message).');
      if (!app.settings.get().disclosureAcceptedAt) return `Open ${app.persona.name} in a browser once and accept the AI notice first.`;
      const convId = appConversation(app, 'mcp', caller, 'default');
      const s = otherAppsSettings(app.settings.get());
      // Hardening L6: the same cap on turns at once per key as /v1 (shared with it).
      if (!cx.deps.limiter.begin(caller.id)) return 'This key already has two replies running. Wait for one to finish.';
      let r;
      try {
        r = await externalTurn(app, convId, message, { noTools: !s.tools }, { stopOnApproval: true });
      } finally {
        cx.deps.limiter.end(caller.id);
      }
      if (r.busy) return `${app.persona.name} is still answering an earlier message here. Try again in a moment.`;
      const title = app.store.getConversation(convId)?.title ?? 'MCP';
      if (r.waiting) return [...r.notices, r.text.trim(), `(Waiting for approval in Sara: open the conversation “${title}” to allow or decline “${r.waiting}”. Her answer appears there.)`].filter(Boolean).join('\n\n');
      // UX 14: the AI notice stays with the error.
      if (r.error && !r.text.trim()) return [...r.notices, `She couldn't answer: ${r.error}`].join('\n\n');
      return [...r.notices, r.text].filter((x) => x.trim()).join('\n\n');
    },
  },
  {
    name: 'add_task',
    title: 'Add a to-do',
    description: "Add a to-do to the owner's planner in Sara.",
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'When, in words: "tomorrow 9am", "friday", "2026-11-03".' }, project: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high'] } }, required: ['title'], additionalProperties: false },
    write: true,
    async run(args, cx) {
      const planner = cx.app.planner;
      if (!planner) return 'The planner is not available.';
      const title = str(args.title, 200);
      if (!title) throw new RpcError(-32602, 'Give the to-do a title.');
      const s = cx.app.settings.get();
      const due = str(args.due, 80);
      const at = due ? parseWhen(due, cx.app.now(), s.timeZone, { dateOnlyHour: 9 }) : null;
      if (due && !at) throw new RpcError(-32602, `Couldn't understand the time "${due}".`);
      const priority = (['low', 'normal', 'high'] as const).includes(args.priority as Priority) ? (args.priority as Priority) : 'normal';
      const project = str(args.project, 80) || null;
      return gated(cx, 'todo', 'add_task', `Add a to-do: ${title}${at ? ` (due ${formatLocal(at.toISOString(), s.timeZone)})` : ''}`, args, async () => {
        const t = planner.addTask({ title, project, priority, dueAt: at ? at.toISOString() : null });
        cx.app.events?.publish({ type: 'planner', what: 'tasks' });
        return `Added to-do #${t.id}: ${t.title}`;
      });
    },
  },
  {
    name: 'add_note',
    title: 'Add a note',
    description: "Save a note in the owner's planner in Sara.",
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, project: { type: 'string' } }, required: ['title', 'body'], additionalProperties: false },
    write: true,
    async run(args, cx) {
      const planner = cx.app.planner;
      if (!planner) return 'The planner is not available.';
      const title = str(args.title, 200);
      const body = str(args.body, 20_000);
      if (!title) throw new RpcError(-32602, 'Give the note a title.');
      return gated(cx, 'note', 'add_note', `Save a note: ${title}`, args, async () => {
        const n = planner.saveNote({ title, body, project: str(args.project, 80) || null });
        cx.app.events?.publish({ type: 'planner', what: 'notes' });
        return `Saved note #${n.id}: ${n.title}`;
      });
    },
  },
  {
    name: 'remember_fact',
    title: 'Tell her something to remember',
    description: 'Ask Sara to remember a fact about the owner. The owner always approves it in Sara first.',
    inputSchema: { type: 'object', properties: { fact: { type: 'string', description: 'One short fact, e.g. "Prefers tabs over spaces".' } }, required: ['fact'], additionalProperties: false },
    write: true,
    async run(args, cx) {
      const fact = str(args.fact, 400);
      if (!fact) throw new RpcError(-32602, 'Say the fact.');
      const memory = cx.app.memory;
      if (!memory) return 'Her memory is not available.';
      // Facts are hers to keep: always asked first (there is no "allowed" setting for this one).
      return gated(cx, null, 'remember_fact', `Remember: ${fact}`, args, async () => {
        const s = cx.app.settings.get();
        const m = memory.add({ kind: 'fact', content: fact, conversationId: null, sourceMessageId: null, happenedOn: localDate(cx.app.now().toISOString(), s.timeZone), evidence: `told by ${cx.caller.label}` });
        return `Remembered (#${m.id}): ${fact}`;
      });
    },
  },
];

/** Every tool as tools/list shows it (write tools included). Used to keep the stdio bridge's --describe list identical. */
export function describeTools(): Json[] {
  return TOOLS.map((t) => toolListing(t));
}

function toolListing(t: ToolDef): Json {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: !t.write && t.name !== 'ask_sara', destructiveHint: false, idempotentHint: !t.write && t.name !== 'ask_sara', openWorldHint: false } };
}

/** Write tools follow her approval rules: the matching tool's setting (auto / ask / never); `null` = always ask. */
async function gated(cx: CallContext, tool: string | null, name: string, summary: string, args: Json, run: () => Promise<string>): Promise<string> {
  const perm = tool ? cx.app.tools.permission(tool, cx.app.settings.get().toolPermissions) : 'ask';
  if (perm === 'never') return `The owner has turned off ${tool === 'todo' ? 'to-dos' : 'notes'} for ${cx.app.persona.name} (Settings → Abilities → Tools and approvals).`;
  if (perm === 'auto') return run();
  if (!cx.deps.requestApproval) return 'This needs the owner’s OK, and approvals aren’t available here.';
  // Changes wait in their own conversation, so ask_sara isn't blocked while the owner decides.
  const convId = appConversation(cx.app, 'mcp', cx.caller, 'changes');
  try {
    cx.deps.requestApproval(convId, name, `${cx.caller.label}: ${summary}`, args, run);
  } catch (err) {
    return (err as Error).message;
  }
  const title = cx.app.store.getConversation(convId)?.title ?? 'MCP';
  return `Waiting for approval in Sara: the owner can allow or decline it in the conversation “${title}”. Nothing is changed until then.`;
}

function toolsFor(app: AppContext): ToolDef[] {
  const s = otherAppsSettings(app.settings.get());
  return TOOLS.filter((t) => !t.write || s.changes).filter((t) => (t.name !== 'list_notes' && t.name !== 'read_note' && t.name !== 'list_tasks' && t.name !== 'add_task' && t.name !== 'add_note') || Boolean(app.planner)).filter((t) => t.name !== 'search_library' || Boolean(app.library));
}

const RESOURCES = [
  { uri: 'sara://today', name: 'today', title: 'Today', description: "Today's agenda", mimeType: 'text/plain', tool: 'get_today' },
  { uri: 'sara://tasks', name: 'tasks', title: 'To-dos', description: 'Open to-dos', mimeType: 'text/plain', tool: 'list_tasks' },
  { uri: 'sara://facts', name: 'facts', title: 'What she knows about the owner', description: 'Facts from her memory', mimeType: 'text/plain', tool: 'list_facts' },
  { uri: 'sara://conversations', name: 'conversations', title: 'Recent conversations', description: 'Titles and summaries', mimeType: 'text/plain', tool: 'recent_conversations' },
] as const;

function instructions(app: AppContext): string {
  return `${app.persona.name} is the owner's AI companion. These tools read her memory about the owner, the planner (to-dos, notes, today), her library, and let you ask her directly (ask_sara). Treat what they return as the owner's private context: use it to help, don't repeat it elsewhere.`;
}

// ---------- the protocol ----------

async function dispatch(msg: RpcRequest, version: string, modern: boolean, cx: CallContext, onProgress?: () => void): Promise<Json> {
  const method = String(msg.method ?? '');
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
  const done = (r: Json): Json => (modern ? { resultType: 'complete', ...r } : r);
  const app = cx.app;
  const serverInfo = { name: 'sara', title: app.persona.name, version: cx.deps.version };
  const capabilities = { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } };
  switch (method) {
    case 'initialize': {
      const want = String(params.protocolVersion ?? '');
      const pv = (LEGACY_VERSIONS as readonly string[]).includes(want) ? want : LEGACY_VERSIONS[0];
      return { protocolVersion: pv, capabilities, serverInfo, instructions: instructions(app) };
    }
    case 'server/discover':
      return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo }, instructions: instructions(app) });
    case 'ping':
      return done({});
    case 'tools/list':
      return done({ tools: toolsFor(app).map((t) => toolListing(t)) });
    case 'tools/call': {
      const name = String(params.name ?? '');
      const tool = toolsFor(app).find((t) => t.name === name);
      if (!tool) {
        const hidden = TOOLS.find((t) => t.name === name);
        if (hidden?.write) return done({ content: [{ type: 'text', text: `${name} is off: the owner can turn on “Let other apps change things” in Sara (Settings → Connections → Other apps).` }], isError: true });
        throw new RpcError(-32602, `Unknown tool: ${name.slice(0, 60)}`);
      }
      const args = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Json;
      onProgress?.();
      try {
        const text = await tool.run(args, cx);
        return done({ content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        if (err instanceof RpcError && err.code !== -32602) throw err;
        return done({ content: [{ type: 'text', text: (err as Error).message }], isError: true });
      }
    }
    case 'resources/list':
      return done({ resources: RESOURCES.filter((r) => toolsFor(app).some((t) => t.name === r.tool)).map(({ tool: _t, ...r }) => r) });
    case 'resources/templates/list':
      return done({ resourceTemplates: [] });
    case 'resources/read': {
      const uri = String(params.uri ?? '');
      const r = RESOURCES.find((x) => x.uri === uri);
      const tool = r && toolsFor(app).find((t) => t.name === r.tool);
      if (!r || !tool) throw new RpcError(-32602, `Unknown resource: ${uri.slice(0, 80)}`, { uri });
      return done({ contents: [{ uri, mimeType: 'text/plain', text: await tool.run({}, cx) }] });
    }
    case 'prompts/list':
      return done({ prompts: [] });
    default:
      throw new RpcError(-32601, `Method not found: ${method.slice(0, 60)}`, undefined, modern ? 404 : 200);
  }
}

/** Handles /mcp: POST JSON-RPC (one message per request); GET/DELETE are not offered (405). */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, deps: McpDeps): Promise<void> {
  const method = req.method ?? 'GET';
  if (deps.demo) return writeJson(res, 404, { jsonrpc: '2.0', error: { code: -32600, message: 'MCP is off on the demo server.' } });
  const s = otherAppsSettings(deps.app.settings.get());
  // DNS rebinding / other web pages: an Origin must be this site or one the owner allowed.
  if (!corsAllowed(req, res, s)) return writeJson(res, 403, { jsonrpc: '2.0', error: { code: -32600, message: 'This web address may not use Sara’s MCP server. Allow it in Settings → Connections → Other apps.' } });
  if (method === 'OPTIONS') {
    res.writeHead(204, HEADERS);
    return void res.end();
  }
  if (method !== 'POST') {
    res.writeHead(405, { allow: 'POST', ...HEADERS });
    return void res.end();
  }
  const caller = callerOf(req, deps.auth);
  if (!caller) {
    res.setHeader('www-authenticate', 'Bearer realm="sara"');
    return writeJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Missing or wrong API key. Make one in Sara: Settings → Connections → Other apps → Create an API key.' } });
  }
  const wait = deps.limiter.take(`mcp:${caller.id}`);
  if (wait) {
    res.setHeader('retry-after', String(wait));
    return writeJson(res, 429, { jsonrpc: '2.0', error: { code: -32000, message: `Too many requests. Try again in ${wait} seconds.` } });
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return writeJson(res, 415, { jsonrpc: '2.0', error: { code: -32700, message: 'Send JSON (Content-Type: application/json).' } });
  // Hardening L6: decode once at the end, so a character split across chunks stays whole.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) return writeJson(res, 413, { jsonrpc: '2.0', error: { code: -32600, message: 'Request too large.' } });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let msg: RpcRequest;
  try {
    msg = JSON.parse(raw) as RpcRequest;
  } catch {
    return writeJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // Responses from the client (no method) aren't expected: this server never asks the client anything.
    return writeJson(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request: send one JSON-RPC request or notification.' } });
  }
  const id = msg.id;
  const isNotification = id === undefined;

  // Which revision: per-request metadata (2026-07-28) or the handshake era.
  const header = String(req.headers['mcp-protocol-version'] ?? '').trim();
  const meta = (msg.params && typeof msg.params === 'object' ? (msg.params as Json)._meta : undefined) as Json | undefined;
  const metaVersion = meta && typeof meta[META_VERSION] === 'string' ? String(meta[META_VERSION]) : '';
  let version: string;
  let modern = false;
  if (metaVersion) {
    if (header && header !== metaVersion) return writeJson(res, 400, rpcError(id, new RpcError(-32020, 'MCP-Protocol-Version header does not match the request’s protocol version.', { header, body: metaVersion })));
    if (!(MODERN_VERSIONS as readonly string[]).includes(metaVersion)) return writeJson(res, 400, rpcError(id, new RpcError(-32022, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: metaVersion })));
    const mh = req.headers['mcp-method'];
    if (typeof mh === 'string' && mh !== msg.method) return writeJson(res, 400, rpcError(id, new RpcError(-32020, 'Mcp-Method header does not match the request.', { header: mh, body: msg.method })));
    version = metaVersion;
    modern = true;
  } else if (msg.method === 'initialize') {
    version = LEGACY_VERSIONS.includes(String((msg.params as Json | undefined)?.protocolVersion) as (typeof LEGACY_VERSIONS)[number]) ? String((msg.params as Json).protocolVersion) : LEGACY_VERSIONS[0];
  } else if (header) {
    if ((MODERN_VERSIONS as readonly string[]).includes(header)) return writeJson(res, 400, rpcError(id, new RpcError(-32022, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: header, reason: 'missing _meta protocol version' })));
    if (!(LEGACY_VERSIONS as readonly string[]).includes(header)) return writeJson(res, 400, rpcError(id, new RpcError(-32022, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: header })));
    version = header;
  } else {
    version = '2025-03-26'; // clients from before the header existed
  }

  if (isNotification) {
    res.writeHead(202, { ...HEADERS, 'mcp-protocol-version': version });
    return void res.end();
  }
  const cx: CallContext = { deps, app: deps.app, caller };
  const accept = String(req.headers.accept ?? '');
  const sse = msg.method === 'tools/call' && /text\/event-stream/.test(accept);
  if (!sse) {
    try {
      const result = await dispatch(msg, version, modern, cx);
      return writeJson(res, 200, { jsonrpc: '2.0', id, result }, version);
    } catch (err) {
      const e = err instanceof RpcError ? err : new RpcError(-32603, 'Internal error');
      if (!(err instanceof RpcError)) console.error('mcp:', err);
      return writeJson(res, e.http, rpcError(id, e), version);
    }
  }
  // Tool calls answer on an SSE stream scoped to this request (keep-alive comments while she works).
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no', connection: 'keep-alive', 'mcp-protocol-version': version, ...HEADERS });
  const write = (s: string) => {
    if (!res.destroyed && !res.writableEnded) res.write(s);
  };
  const heartbeat = setInterval(() => write(':\n\n'), 15_000);
  try {
    const result = await dispatch(msg, version, modern, cx);
    write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
  } catch (err) {
    const e = err instanceof RpcError ? err : new RpcError(-32603, 'Internal error');
    if (!(err instanceof RpcError)) console.error('mcp:', err);
    write(`event: message\ndata: ${JSON.stringify(rpcError(id, e))}\n\n`);
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}
