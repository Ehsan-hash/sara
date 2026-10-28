// Phase 44: how she uses her library in a conversation. A short "Your library" section in her
// instructions (what she has, what was shared in this chat, passages found for this message), and
// a tool to search it or read a part of a document. Never in chats with other people.
import type { AppContext } from '../chat.ts';
import { embedTarget } from '../embeddings.ts';
import type { Conversation } from '../store.ts';
import type { Tool } from '../tools/types.ts';
import { ToolError } from '../tools/types.ts';
import { isWorkChannel } from '../safety.ts';
import { type LibraryDoc, type LibraryStore, type PassageHit, sourceLabel } from './store.ts';

/** Shared-in-this-chat documents up to this size go into her instructions whole. */
export const WHOLE_DOC_CHARS = 24_000;
/** Budget for passages found automatically for one message. */
const FOUND_CHARS = 3200;
const LIST_DOCS = 12;

/** Words that point at documents ("what does my lease say", "according to the manual"). */
const DOC_CUE = /\b(document|doc|file|pdf|attachment|upload(ed)?|lease|contract|manual|policy|invoice|receipt|statement|report|spreadsheet|slides?|deck|book|chapter|page \d+|section|clause|says?|according to|in (the|my) (notes|library))\b/i;

/** Her library for this companion (a shared one lives with the first companion). */
export const libraryOf = (app: AppContext): LibraryStore | undefined => app.library;

const fmtHit = (h: PassageHit) => `[${sourceLabel(h.doc, h.passage.place)}]${h.passage.heading ? ` (${h.passage.heading})` : ''}\n${h.passage.text}`;

function docLine(d: LibraryDoc): string {
  const what = d.summary ? `: ${d.summary}` : '';
  const state = d.status === 'ready' ? '' : d.status === 'failed' ? ' (couldn\'t be read)' : ' (still being read)';
  return `- ${d.title && d.title.length < 80 ? `${d.title} (${d.name})` : d.name}${what}${state}`;
}

/**
 * The "Your library" section for this turn, or undefined when there's nothing to say. `text` is
 * the owner's message (used to look passages up).
 */
export async function librarySection(app: AppContext, conv: Conversation, text: string): Promise<string | undefined> {
  const lib = libraryOf(app);
  if (!lib || conv.partner) return undefined;
  const owner = app.settings.get().ownerName?.trim() || 'the owner';
  const shared = lib.list({ conversationId: conv.id });
  const kept = lib.list().slice(0, 200);
  if (!shared.length && !kept.length) return undefined;
  const blocks: string[] = [];
  // Shared in this conversation ("just read this once"): small ones whole, big ones by passages.
  if (shared.length) {
    const lines: string[] = [];
    let used = 0;
    for (const d of shared.slice(0, 6)) {
      if (d.status !== 'ready') {
        lines.push(`- ${d.name}: ${d.status === 'failed' ? `couldn't be read (${d.error ?? 'unknown reason'})` : 'still being read; say you are reading it'}`);
        continue;
      }
      if (d.chars <= WHOLE_DOC_CHARS && used + d.chars <= WHOLE_DOC_CHARS * 2) {
        lines.push(`#### ${d.name}\n${lib.text(d.id, WHOLE_DOC_CHARS)}`);
        used += d.chars;
      } else lines.push(`- ${d.name}: long (${Math.round(d.chars / 1000)}k characters); search it with the library tool (document "${d.name}") to read the parts you need.`);
    }
    blocks.push(`### Shared with you in this conversation\n${owner} shared ${shared.length === 1 ? 'this document' : 'these documents'} here to read now (not kept in your library):\n${lines.join('\n\n')}`);
  }
  if (kept.length) {
    const more = kept.length > LIST_DOCS ? `\n- …and ${kept.length - LIST_DOCS} more (search them with the library tool)` : '';
    blocks.push(`### In your library\nDocuments ${owner} gave you to keep:\n${kept.slice(0, LIST_DOCS).map(docLine).join('\n')}${more}`);
  }
  // Passages for this message: by meaning when that's set up, or when the message points at a document.
  const target = embedTarget(app);
  if (text.trim() && !isWorkChannel(conv.channel) && (target || DOC_CUE.test(text) || shared.some((d) => d.chars > WHOLE_DOC_CHARS))) {
    const hits = (await lib.find(text, { target, conversationId: conv.id, limit: 4, timeoutMs: 2000 }).catch(() => [])).filter((h) => target ? h.by !== 'words' || DOC_CUE.test(text) : true);
    const out: string[] = [];
    let size = 0;
    for (const h of hits) {
      // Small shared documents are already in whole.
      if (!h.doc.keep && h.doc.chars <= WHOLE_DOC_CHARS) continue;
      const piece = fmtHit(h);
      if (size + piece.length > FOUND_CHARS && out.length) break;
      out.push(piece);
      size += piece.length;
    }
    if (out.length) blocks.push(`### Found just now in your library\n${out.join('\n\n')}`);
  }
  return blocks.join('\n');
}

/** The library tool: search her documents, list them, or read a part of one. */
export function createLibraryTool(app: () => AppContext): Tool {
  return {
    spec: {
      name: 'library',
      description:
        "Your library: documents the owner gave you (PDFs, Word, spreadsheets, slides, books, web pages, notes). Use it to answer from them instead of guessing, and say where the answer came from (e.g. 'your lease, page 4'). action 'search' finds passages by words and meaning; 'read' reads a document from a place onward; 'list' shows what's there.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['search', 'read', 'list'] },
          query: { type: 'string', description: "For search: what to look for, e.g. 'when does the lease end' or 'filter cleaning'." },
          document: { type: 'string', description: 'Optional: the document name (or part of it) to search or read.' },
          place: { type: 'string', description: "For read: where to start, e.g. 'page 4', 'sheet Budget', 'slide 3'. Default: the start." },
        },
        required: ['action'],
      },
    },
    defaultPermission: 'auto',
    summarize: (a) => (a.action === 'list' ? 'Looking at her library' : a.action === 'read' ? `Reading ${String(a.document ?? 'a document').slice(0, 60)}${a.place ? `, ${String(a.place).slice(0, 30)}` : ''}` : `Looking in her library for “${String(a.query ?? '').slice(0, 60)}”`),
    async run(args, ctx) {
      const a = app();
      const lib = libraryOf(a);
      if (!lib) throw new ToolError('There is no library here.');
      const conv = ctx.conversationId ? a.store.getConversation(ctx.conversationId) : undefined;
      if (conv?.partner) throw new ToolError('The library is private to the owner.');
      const all = [...(conv ? lib.list({ conversationId: conv.id }) : []), ...lib.list()];
      const action = String(args.action ?? 'search');
      if (action === 'list') {
        if (!all.length) return 'Your library is empty. The owner can add documents on the Library page or with 📎 in a chat.';
        return all.slice(0, 60).map((d) => `${docLine(d)}${d.keep ? '' : ' [shared in this chat only]'} · ${d.passages} passages`).join('\n');
      }
      const name = typeof args.document === 'string' ? args.document.trim().toLowerCase() : '';
      const docs = name ? all.filter((d) => d.name.toLowerCase().includes(name) || (d.title ?? '').toLowerCase().includes(name)) : [];
      if (name && !docs.length) throw new ToolError(`No document matching “${args.document}”. Use action 'list' to see what's there.`);
      if (action === 'read') {
        const doc = docs[0] ?? (all.length === 1 ? all[0] : undefined);
        if (!doc) throw new ToolError("Say which document to read (its name).");
        if (doc.status !== 'ready') return `${doc.name} is ${doc.status === 'failed' ? `not readable: ${doc.error}` : 'still being read; try again in a minute'}.`;
        const place = typeof args.place === 'string' ? args.place.trim().toLowerCase() : '';
        const ps = lib.passages(doc.id, { limit: 100_000 });
        let from = place ? ps.findIndex((p) => p.place.toLowerCase() === place || p.place.toLowerCase().startsWith(`${place} `) || (p.heading ?? '').toLowerCase().includes(place)) : 0;
        if (from < 0) from = 0;
        const out: string[] = [];
        let size = 0;
        for (const p of ps.slice(from)) {
          if (size + p.text.length > 8000 && out.length) break;
          out.push(`[${p.place || doc.name}]\n${p.text}`);
          size += p.text.length;
        }
        const rest = ps.length - from - out.length;
        return `${sourceLabel(doc, '')}${doc.summary ? ` (${doc.summary})` : ''}\n\n${out.join('\n\n')}${rest > 0 ? `\n\n(${rest} more passages after this; read on with place "${ps[from + out.length]?.place || ''}")` : ''}`;
      }
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new ToolError('Say what to look for.');
      const hits = await lib.find(query, { target: embedTarget(a), conversationId: conv?.id, docIds: docs.length ? docs.map((d) => d.id) : undefined, limit: 6, timeoutMs: 4000 });
      if (!hits.length) return `Nothing about “${query}” in ${docs.length ? docs.map((d) => d.name).join(', ') : 'your library'}. Try other words, or read the document. Don't guess what it says.`;
      return hits.map(fmtHit).join('\n\n');
    },
  };
}
