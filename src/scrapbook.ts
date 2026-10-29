// Phase 9: a shared scrapbook of moments, photos and inside jokes. The owner pins messages (📌);
// photos either of them shared appear automatically; Sara can add a moment or an inside joke with
// her `scrapbook` tool and look back at it. Entries never come from partner (other people's) chats.
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.ts';
import type { Tool } from './tools/types.ts';
import { str, ToolError } from './tools/types.ts';

export type ScrapKind = 'moment' | 'joke' | 'photo';

/** A stored photo's file name (content hash + type), as uploads name them. */
export const PHOTO_NAME = /^[0-9a-f]{32}\.(jpg|png|webp|gif)$/;

export interface ScrapEntry {
  id: number;
  kind: ScrapKind;
  text: string;
  note: string;
  conversationId: string | null;
  messageId: number | null;
  image: string | null;
  addedBy: 'owner' | 'sara';
  createdAt: string;
}

type Row = Record<string, unknown>;
const toEntry = (r: Row): ScrapEntry => ({
  id: Number(r.id),
  kind: String(r.kind) as ScrapKind,
  text: String(r.text),
  note: String(r.note ?? ''),
  conversationId: (r.conversation_id as string | null) ?? null,
  messageId: r.message_id === null || r.message_id === undefined ? null : Number(r.message_id),
  image: (r.image as string | null) ?? null,
  addedBy: r.added_by === 'sara' ? 'sara' : 'owner',
  createdAt: String(r.created_at),
});

export class Scrapbook {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS scrapbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      conversation_id TEXT,
      message_id INTEGER,
      image TEXT,
      added_by TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL
    )`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS scrapbook_msg ON scrapbook(message_id, kind) WHERE message_id IS NOT NULL');
    // Photos taken out of the scrapbook only ("Remove from scrapbook"): the messages keep them.
    db.exec('CREATE TABLE IF NOT EXISTS scrapbook_hidden (image TEXT PRIMARY KEY, hidden_at TEXT NOT NULL)');
  }

  add(e: { kind: ScrapKind; text: string; note?: string; conversationId?: string | null; messageId?: number | null; image?: string | null; addedBy?: 'owner' | 'sara' }): ScrapEntry {
    const text = e.text.trim().slice(0, 2000);
    if (!text && !e.image) throw new Error('Nothing to save.');
    const r = this.#db
      .prepare('INSERT INTO scrapbook (kind, text, note, conversation_id, message_id, image, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(e.kind, text, (e.note ?? '').slice(0, 500), e.conversationId ?? null, e.messageId ?? null, e.image ?? null, e.addedBy ?? 'owner', this.#now().toISOString());
    if (!Number(r.changes)) return this.list().find((x) => x.messageId === e.messageId && x.kind === e.kind)!;
    return this.get(Number(r.lastInsertRowid))!;
  }

  get(id: number): ScrapEntry | undefined {
    const r = this.#db.prepare('SELECT * FROM scrapbook WHERE id = ?').get(id) as Row | undefined;
    return r ? toEntry(r) : undefined;
  }

  list(opts: { kind?: ScrapKind; limit?: number } = {}): ScrapEntry[] {
    const rows = opts.kind
      ? this.#db.prepare('SELECT * FROM scrapbook WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(opts.kind, opts.limit ?? 500)
      : this.#db.prepare('SELECT * FROM scrapbook ORDER BY created_at DESC, id DESC LIMIT ?').all(opts.limit ?? 500);
    return (rows as Row[]).map(toEntry);
  }

  update(id: number, patch: { note?: string; text?: string }): ScrapEntry | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    this.#db.prepare('UPDATE scrapbook SET note = ?, text = ? WHERE id = ?').run((patch.note ?? cur.note).slice(0, 500), (patch.text ?? cur.text).slice(0, 2000), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    return Number(this.#db.prepare('DELETE FROM scrapbook WHERE id = ?').run(id).changes) > 0;
  }

  /** Whether a name looks like a stored photo (checked before any lookup). */
  isPhotoName(image: string): boolean {
    return PHOTO_NAME.test(image);
  }

  /** Takes a photo out of the scrapbook only (its message keeps it). False if it was already out. */
  hidePhoto(image: string): boolean {
    if (!PHOTO_NAME.test(image)) throw new Error('Not a photo');
    return Number(this.#db.prepare('INSERT INTO scrapbook_hidden (image, hidden_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(image, this.#now().toISOString()).changes) > 0;
  }

  /** Brings a removed photo back into the scrapbook. */
  unhidePhoto(image: string): boolean {
    return Number(this.#db.prepare('DELETE FROM scrapbook_hidden WHERE image = ?').run(image).changes) > 0;
  }

  /** The photos taken out of the scrapbook. */
  hiddenImages(): Set<string> {
    return new Set((this.#db.prepare('SELECT image FROM scrapbook_hidden').all() as Row[]).map((r) => String(r.image)));
  }

  /**
   * Photos shared in owner conversations (theirs and hers), newest first. Photos taken out of the
   * scrapbook are left out unless `hidden` asks for them ('only' lists just those).
   */
  photos(store: Store, limit = 200, hidden: 'skip' | 'only' | 'all' = 'skip'): { image: string; conversationId: string; messageId: number; from: 'owner' | 'sara'; text: string; createdAt: string }[] {
    const out = this.#allPhotos(store, limit + (hidden === 'all' ? 0 : this.hiddenImages().size));
    if (hidden === 'all') return out.slice(0, limit);
    const gone = this.hiddenImages();
    return out.filter((p) => (hidden === 'only' ? gone.has(p.image) : !gone.has(p.image))).slice(0, limit);
  }

  #allPhotos(store: Store, limit: number): { image: string; conversationId: string; messageId: number; from: 'owner' | 'sara'; text: string; createdAt: string }[] {
    const rows = store.db
      .prepare(
        `SELECT m.id, m.conversation_id, m.role, m.content, m.meta, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.partner IS NULL AND m.meta LIKE '%"images"%' ORDER BY m.id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    const out: ReturnType<Scrapbook['photos']> = [];
    for (const r of rows) {
      const imgs = (JSON.parse(String(r.meta)) as { images?: string[] }).images ?? [];
      for (const image of imgs) out.push({ image, conversationId: String(r.conversation_id), messageId: Number(r.id), from: r.role === 'user' ? 'owner' : 'sara', text: String(r.content).replace(/^\(photo\)$/, '').slice(0, 200), createdAt: String(r.created_at) });
    }
    return out;
  }
}

/** Sara's tool: keep a moment or an inside joke, or look back at the scrapbook. */
export function createScrapbookTool(book: Scrapbook): Tool {
  return {
    defaultPermission: 'auto',
    source: 'built-in',
    spec: {
      name: 'scrapbook',
      description:
        'Your shared scrapbook with the person you talk with: moments worth keeping and inside jokes. Use action "add" (rarely, for something genuinely special or a new running joke) or "list" to look back (e.g. to bring up an old inside joke).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list'] },
          kind: { type: 'string', enum: ['moment', 'joke'], description: 'For add: a moment or an inside joke' },
          text: { type: 'string', description: 'For add: the moment or joke, in a sentence or two' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    summarize: (a) => (a.action === 'add' ? `Scrapbook: keep a ${String(a.kind ?? 'moment')}` : 'Scrapbook: look back'),
    async run(args, ctx) {
      const action = str(args, 'action');
      if (action === 'list') {
        const items = book.list({ limit: 40 }).filter((e) => e.kind !== 'photo');
        if (!items.length) return 'The scrapbook is empty so far.';
        return items.map((e) => `- (${e.createdAt.slice(0, 10)}, ${e.kind}${e.addedBy === 'sara' ? ', added by you' : ''}) ${e.text}${e.note ? ` (note: ${e.note})` : ''}`).join('\n');
      }
      if (action !== 'add') throw new ToolError('action must be add or list.');
      const kind = args.kind === 'joke' ? 'joke' : 'moment';
      const e = book.add({ kind, text: str(args, 'text'), conversationId: ctx.conversationId ?? null, addedBy: 'sara' });
      return `Kept in the scrapbook (#${e.id}).`;
    },
  };
}
