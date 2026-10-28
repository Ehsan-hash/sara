// Phase 37: things to do together. Pick an activity in a conversation (20 questions, trivia, would
// you rather, journaling together, watch along, a story together) and she plays along with the rules
// in her instructions until you end it. Plus shared lists you both add to: a playlist, a reading
// list and a watch list.
import type { DatabaseSync } from 'node:sqlite';
import type { Tool } from './tools/types.ts';
import { str, ToolError } from './tools/types.ts';

export interface Activity {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  /** What the owner's message says when starting it (shown in the chat). */
  start: string;
  /** Her rules while it's on. {owner} is replaced. */
  rules: string;
  /** Asks the owner for a topic first (e.g. what you're watching). */
  topic?: string;
}

export const ACTIVITIES: Activity[] = [
  {
    id: 'twenty-questions',
    label: '20 questions',
    emoji: '🤔',
    blurb: 'She thinks of something; you guess with yes/no questions.',
    start: "Let's play 20 questions! You think of something.",
    rules:
      "You're playing 20 questions with {owner}. You secretly pick something (an animal, object, place or famous thing, nothing obscure) and keep it the same all game. {owner} asks yes/no questions; answer honestly with yes, no or 'sort of' plus a playful word or two, and count the questions out loud (e.g. 'That's 7.'). If {owner} guesses it, celebrate; after 20 wrong, reveal it. Then offer to switch roles or play again.",
  },
  {
    id: 'trivia',
    label: 'Trivia',
    emoji: '🧠',
    blurb: 'Quick questions, a running score.',
    start: "Let's do some trivia!",
    topic: 'Any topic? (leave empty for a mix)',
    rules:
      "You're running a casual trivia game for {owner}{topic}. One question at a time, multiple choice (A to D) or short answer, mixing easy and harder ones. Say whether the answer was right with a fun fact, keep a running score ('3 out of 4!'), and only ask questions you're sure of the answer to. Ten questions make a round; then give the final score and offer another round.",
  },
  {
    id: 'would-you-rather',
    label: 'Would you rather',
    emoji: '⚖️',
    blurb: 'Silly and deep choices, both of you answer.',
    start: "Let's play would you rather!",
    rules:
      "You're playing 'would you rather' with {owner}. Take turns: ask one fun dilemma (mix silly, tricky and thoughtful ones), answer it yourself too with your real reasons in character, and ask {owner} to ask you one now and then. Keep it light and personal.",
  },
  {
    id: 'journal',
    label: 'Journal together',
    emoji: '📓',
    blurb: 'She asks gentle questions about your day; you get a short entry.',
    start: "Can we journal together? Ask me about my day.",
    rules:
      "You're helping {owner} journal about their day. Ask one gentle, open question at a time (how the day felt, a high point, something hard, something they're grateful for, what's on their mind for tomorrow), listen and reflect back briefly; don't advise unless asked. When {owner} says they're done (or after about five questions), write a short journal entry in {owner}'s own voice, first person, from what they told you only (nothing invented), and offer to save it as a note with the note tool (title 'Journal: <date>').",
  },
  {
    id: 'watch-along',
    label: 'Watch along',
    emoji: '🍿',
    blurb: "Tell her what you're watching; she reacts like she's on the sofa with you.",
    start: "Watch along with me?",
    topic: "What are you watching?",
    rules:
      "{owner} is watching {topicPlain} and you're 'watching along' like a friend on the sofa. React to what {owner} tells you about it (scenes, characters, twists) with short, lively comments, guesses and opinions in character. Don't spoil anything {owner} hasn't seen yet unless they ask; if you don't know the show well, say so and react to what they tell you. If {owner} wants, add it to your shared watch list.",
  },
  {
    id: 'story',
    label: 'A story together',
    emoji: '📖',
    blurb: 'You take turns writing a short story.',
    start: "Let's write a story together!",
    topic: 'Any genre or idea? (leave empty for a surprise)',
    rules:
      "You and {owner} are writing a short story together{topic}, taking turns. Write 2 to 4 sentences per turn that build on what {owner} added, end on something that invites the next move, and keep characters and details consistent. Offer a title when it wraps up.",
  },
];

export const LISTS = {
  music: { label: 'Our playlist', emoji: '🎵', item: 'song' },
  reading: { label: 'Reading list', emoji: '📚', item: 'book' },
  watch: { label: 'Watch list', emoji: '🎬', item: 'show or film' },
} as const;
export type ListId = keyof typeof LISTS;

export interface SharedItem {
  id: number;
  list: ListId;
  title: string;
  note: string | null;
  addedBy: 'owner' | 'her';
  addedAt: string;
  doneAt: string | null;
}

export class TogetherStore {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS together_activity (conversation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT, started_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shared_items (id INTEGER PRIMARY KEY AUTOINCREMENT, list TEXT NOT NULL, title TEXT NOT NULL, note TEXT, added_by TEXT NOT NULL, added_at TEXT NOT NULL, done_at TEXT);`);
  }

  activity(conversationId: string): { kind: string; topic: string | null; startedAt: string } | undefined {
    const r = this.#db.prepare('SELECT kind, topic, started_at FROM together_activity WHERE conversation_id = ?').get(conversationId) as { kind: string; topic: string | null; started_at: string } | undefined;
    return r && ACTIVITIES.some((a) => a.id === r.kind) ? { kind: r.kind, topic: r.topic, startedAt: r.started_at } : undefined;
  }

  start(conversationId: string, kind: string, topic?: string): void {
    if (!ACTIVITIES.some((a) => a.id === kind)) throw new Error('Pick something to do together.');
    const t = topic?.trim().slice(0, 120) || null;
    this.#db.prepare('INSERT INTO together_activity (conversation_id, kind, topic, started_at) VALUES (?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET kind = excluded.kind, topic = excluded.topic, started_at = excluded.started_at').run(conversationId, kind, t, this.#now().toISOString());
  }

  end(conversationId: string): void {
    this.#db.prepare('DELETE FROM together_activity WHERE conversation_id = ?').run(conversationId);
  }

  items(list?: ListId, includeDone = true): SharedItem[] {
    const rows = this.#db.prepare(`SELECT * FROM shared_items ${list ? 'WHERE list = ?' : ''} ORDER BY done_at IS NOT NULL, id DESC LIMIT 300`).all(...(list ? [list] : [])) as Record<string, unknown>[];
    return rows
      .map((r) => ({ id: Number(r.id), list: r.list as ListId, title: String(r.title), note: (r.note as string | null) ?? null, addedBy: r.added_by === 'her' ? 'her' : 'owner', addedAt: String(r.added_at), doneAt: (r.done_at as string | null) ?? null }) as SharedItem)
      .filter((x) => includeDone || !x.doneAt);
  }

  add(list: ListId, title: string, note: string | null, by: 'owner' | 'her'): SharedItem {
    if (!LISTS[list]) throw new Error('Unknown list.');
    const t = title.trim().slice(0, 200);
    if (!t) throw new Error('Say what to add.');
    const dup = this.items(list).find((x) => x.title.toLowerCase() === t.toLowerCase() && !x.doneAt);
    if (dup) return dup;
    const r = this.#db.prepare('INSERT INTO shared_items (list, title, note, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(list, t, note?.trim().slice(0, 300) || null, by, this.#now().toISOString());
    return this.items(list).find((x) => x.id === Number(r.lastInsertRowid))!;
  }

  setDone(id: number, done: boolean): boolean {
    return Number(this.#db.prepare('UPDATE shared_items SET done_at = ? WHERE id = ?').run(done ? this.#now().toISOString() : null, id).changes) > 0;
  }

  remove(id: number): boolean {
    return Number(this.#db.prepare('DELETE FROM shared_items WHERE id = ?').run(id).changes) > 0;
  }
}

/** Her instructions while an activity is on. */
export function activityNote(a: { kind: string; topic: string | null } | undefined, owner: string): string | undefined {
  const act = a && ACTIVITIES.find((x) => x.id === a.kind);
  if (!act) return undefined;
  const topic = a!.topic ? ` (topic: ${a!.topic})` : '';
  return `${act.rules.replaceAll('{owner}', owner).replaceAll('{topicPlain}', a!.topic ? `"${a!.topic}"` : 'something').replaceAll('{topic}', topic)} Stay yourself while you play. If ${owner} clearly wants to stop or talk about something else, go with it.`;
}

/** Her tool for the shared lists. */
export function createSharedListTool(get: () => TogetherStore | undefined): Tool {
  return {
    defaultPermission: 'auto',
    source: 'built-in',
    isAvailable: () => Boolean(get()),
    spec: {
      name: 'shared_list',
      description:
        "The lists you and the owner share: 'music' (your playlist), 'reading' (books) and 'watch' (shows and films). Add something either of you recommends, list what's on one, or mark something done (listened, read, watched). Add things only when one of you actually suggests them.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'done'] },
          list: { type: 'string', enum: Object.keys(LISTS) },
          title: { type: 'string', description: 'For add/done: the song (with artist), book (with author) or show' },
          note: { type: 'string', description: 'Optional: why, who suggested it' },
          by: { type: 'string', enum: ['owner', 'her'], description: "Who suggested it ('her' = you)" },
        },
        required: ['action', 'list'],
        additionalProperties: false,
      },
    },
    summarize: (a) => `${String(a.action)} ${String(a.list)}${a.title ? `: ${String(a.title)}` : ''}`,
    async run(args) {
      const store = get();
      if (!store) throw new ToolError('Shared lists are not available here.');
      const list = str(args, 'list') as ListId;
      if (!LISTS[list]) throw new ToolError(`Use one of: ${Object.keys(LISTS).join(', ')}.`);
      const action = str(args, 'action');
      if (action === 'list') {
        const items = store.items(list);
        if (!items.length) return `${LISTS[list].label} is empty.`;
        return items.map((x) => `- ${x.title}${x.note ? ` (${x.note})` : ''}${x.doneAt ? ' ✓ done' : ''} [added by ${x.addedBy === 'her' ? 'you' : 'the owner'}]`).join('\n');
      }
      const title = str(args, 'title');
      if (action === 'add') {
        const it = store.add(list, title, typeof args.note === 'string' ? args.note : null, args.by === 'her' ? 'her' : 'owner');
        return `Added to ${LISTS[list].label}: ${it.title}.`;
      }
      if (action === 'done') {
        const it = store.items(list).find((x) => x.title.toLowerCase() === title.trim().toLowerCase()) ?? store.items(list).find((x) => x.title.toLowerCase().includes(title.trim().toLowerCase()));
        if (!it) throw new ToolError(`"${title}" isn't on ${LISTS[list].label}.`);
        store.setDone(it.id, true);
        return `Marked done on ${LISTS[list].label}: ${it.title}.`;
      }
      throw new ToolError('Use add, list or done.');
    },
  };
}
