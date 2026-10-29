// Phase 66: group chats. Two to four of the owner's companions in one conversation, each in her
// own voice. This file holds the pure parts (rooms on disk, turn styles, @mentions, the router's
// prompt and answer, the notes each companion gets, cutting lines written for others); the round
// itself (one owner message → the replies) is in src/group-round.ts.
//
// How a room is kept: every member has her own copy of the conversation in her own database
// (channel 'group', channelKey = the room id), so each companion remembers only what was said in
// her presence, with her own memory pipeline, and the room shows up in each member's list. Her own
// lines are hers (role 'assistant'); another companion's lines are stored as 'assistant' with
// `meta.groupFrom` and reach her model as labelled lines from that companion, never as hers and
// never as the owner's. The room's settings (members, turn style, banter) are in
// <data>/groups.json, shared by every companion.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GROUP_CHANNEL = 'group';
export const isGroupChannel = (channel: string | null | undefined): boolean => channel === GROUP_CHANNEL;

/** 'fits': a router picks who answers (1–2); 'everyone': each in order; 'turns': round-robin; 'mention': who the owner @names (else the router). */
export const TURN_STYLES = ['fits', 'everyone', 'turns', 'mention'] as const;
export type TurnStyle = (typeof TURN_STYLES)[number];
export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 4;
/** Extra companion-to-companion replies after the owner's message (the banter slider). */
export const MAX_BANTER = 2;
/** Replies to one owner message before banter (one per member at most). */
export const MAX_DIRECT_REPLIES = 4;
/** The hard cap of replies to one owner message, whatever the settings say. */
export const replyCap = (banter: number): number => MAX_DIRECT_REPLIES + clampBanter(banter);
export const clampBanter = (v: unknown): number => Math.max(0, Math.min(MAX_BANTER, Math.round(Number(v) || 0)));
/** Read-only tools a companion may use in a group chat (and only when they run without asking). */
export const GROUP_TOOLS: ReadonlySet<string> = new Set(['recall', 'web_search', 'library']);
/** A banter reply that has nothing to add. */
export const PASS_RE = /^\s*[([]?\s*pass\s*[)\]]?\s*[.!]?\s*$/i;

export interface GroupRoom {
  id: string;
  title: string;
  /** Companion ids in speaking order; the position is also her colour in the room. */
  members: string[];
  turnStyle: TurnStyle;
  banter: number;
  /** Every member's copy is a private conversation (models on the owner's own hardware only). */
  private: boolean;
  createdAt: string;
  /** Round-robin position ('turns'). */
  next: number;
  /** When each member's AI notice was last shown in this room. */
  disclosedAt: Record<string, string>;
}

/** Who said a line, as stored in `meta.speaker` and sent to the apps. */
export interface Speaker {
  id: string;
  name: string;
  /** 0–3: her colour in this room (the app maps it to a colour). */
  color: number;
}

/** The rooms, in <data>/groups.json (small; written whole, atomically). */
export class GroupRooms {
  readonly #file: string;
  #rooms: GroupRoom[] = [];
  readonly #busy = new Map<string, AbortController>();

  constructor(rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
    this.#file = join(rootDir, 'groups.json');
    if (existsSync(this.#file)) {
      try {
        const j = JSON.parse(readFileSync(this.#file, 'utf8')) as { rooms?: GroupRoom[] };
        this.#rooms = Array.isArray(j.rooms) ? j.rooms.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.members)) : [];
      } catch {
        this.#rooms = [];
      }
    }
  }

  #save(): void {
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ rooms: this.#rooms }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  list(): GroupRoom[] {
    return this.#rooms.map((r) => ({ ...r, members: [...r.members], disclosedAt: { ...r.disclosedAt } }));
  }

  get(id: string | null | undefined): GroupRoom | undefined {
    const r = this.#rooms.find((x) => x.id === id);
    return r ? { ...r, members: [...r.members], disclosedAt: { ...r.disclosedAt } } : undefined;
  }

  create(input: { title: string; members: string[]; turnStyle: TurnStyle; banter: number; private: boolean }, now: Date): GroupRoom {
    const room: GroupRoom = { id: randomUUID(), title: input.title, members: [...input.members], turnStyle: input.turnStyle, banter: clampBanter(input.banter), private: input.private, createdAt: now.toISOString(), next: 0, disclosedAt: {} };
    this.#rooms.push(room);
    this.#save();
    return this.get(room.id)!;
  }

  update(id: string, patch: Partial<Pick<GroupRoom, 'title' | 'turnStyle' | 'banter' | 'next' | 'disclosedAt' | 'members'>>): GroupRoom | undefined {
    const r = this.#rooms.find((x) => x.id === id);
    if (!r) return undefined;
    if (patch.title !== undefined) r.title = patch.title;
    if (patch.turnStyle !== undefined) r.turnStyle = patch.turnStyle;
    if (patch.banter !== undefined) r.banter = clampBanter(patch.banter);
    if (patch.next !== undefined) r.next = patch.next;
    if (patch.disclosedAt !== undefined) r.disclosedAt = { ...patch.disclosedAt };
    if (patch.members !== undefined) r.members = [...patch.members];
    this.#save();
    return this.get(id);
  }

  markDisclosed(id: string, companionId: string, at: Date): void {
    const r = this.#rooms.find((x) => x.id === id);
    if (!r) return;
    r.disclosedAt = { ...r.disclosedAt, [companionId]: at.toISOString() };
    this.#save();
  }

  remove(id: string): boolean {
    const n = this.#rooms.length;
    this.#rooms = this.#rooms.filter((r) => r.id !== id);
    if (this.#rooms.length !== n) this.#save();
    this.#busy.get(id)?.abort();
    this.#busy.delete(id);
    return this.#rooms.length !== n;
  }

  /** A round is running in this room (one at a time, whichever member's copy it was sent from). */
  isBusy(id: string): boolean {
    return this.#busy.has(id);
  }
  setBusy(id: string, ctl: AbortController | null): void {
    if (ctl) this.#busy.set(id, ctl);
    else this.#busy.delete(id);
  }
  /** Stop: ends the whole round (every reply still to come). */
  stop(id: string): boolean {
    const c = this.#busy.get(id);
    c?.abort();
    return Boolean(c);
  }
}

const rooms = new Map<string, GroupRooms>();
/** The rooms of one server (shared by its companions). */
export function groupRooms(rootDir: string): GroupRooms {
  let r = rooms.get(rootDir);
  if (!r) rooms.set(rootDir, (r = new GroupRooms(rootDir)));
  return r;
}

/** Lower case without accents, for matching names ("Zoë" = "zoe", "JOSÉ" = "jose"). */
export const foldName = (s: string): string => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The members the owner @named, in the order named. Accents and case don't matter ("@zoe" names
 * Zoë), a name may have spaces ("@Mary Ann"), and the longest name wins ("@Mia" vs "@Mia Rose").
 * "@all" / "@everyone" name everyone.
 */
export function parseMentions(text: string, members: { id: string; name: string }[]): string[] {
  const t = foldName(text);
  if (/(^|[^\p{L}\p{N}])@(all|everyone|everybody)(?![\p{L}\p{N}])/u.test(t)) return members.map((m) => m.id);
  const hits: { id: string; at: number; len: number }[] = [];
  for (const m of members) {
    const n = foldName(m.name.trim());
    if (!n) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])@${escapeRe(n).replace(/ +/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
    for (const x of t.matchAll(re)) hits.push({ id: m.id, at: x.index + x[1].length, len: n.length });
  }
  // Overlapping hits ("@Mia Rose" also matches "@Mia"): the longer one wins.
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  const out: string[] = [];
  let end = -1;
  for (const h of hits) {
    if (h.at < end) continue;
    end = h.at + h.len + 1;
    if (!out.includes(h.id)) out.push(h.id);
  }
  return out;
}

/** Names of members found in a text (whole words, accents ignored), in order of appearance. */
export function namesIn(text: string, members: { id: string; name: string }[]): string[] {
  const t = foldName(text);
  const hits: { id: string; at: number }[] = [];
  for (const m of members) {
    const n = foldName(m.name.trim());
    if (!n) continue;
    const x = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u').exec(t);
    if (x) hits.push({ id: m.id, at: x.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

export const ROUTER_SYSTEM = 'You choose who speaks next in a group chat. Answer with names only, nothing else.';

/** The router's question: who should answer the owner's last message. */
export function routerPrompt(owner: string, title: string, members: { name: string; about: string }[], lines: string[]): string {
  return [
    `Group chat "${title}" between ${owner} and these AI companions:`,
    ...members.map((m) => `- ${m.name}: ${m.about.replace(/\s+/g, ' ').slice(0, 200)}`),
    '',
    'Latest lines (the last one is new):',
    ...lines.slice(-8),
    '',
    `Who should answer ${owner}'s last message? Pick the companion who was spoken to, or whose personality and interests fit it best. Pick two only if both clearly should answer. Answer with just the name, or two names separated by a comma.`,
  ].join('\n');
}

/** The members named in the router's answer (at most two); none = use the fallback. */
export function parseRouterAnswer(answer: string, members: { id: string; name: string }[]): string[] {
  const cleaned = answer.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  return namesIn(cleaned, members).slice(0, 2);
}

/** Without a usable router answer: whoever spoke least recently (never the same one twice in a row). */
export function fallbackSpeaker(memberIds: string[], recent: string[]): string {
  const last = recent.at(-1);
  let best = memberIds[0];
  let bestAt = Number.POSITIVE_INFINITY;
  for (const id of memberIds) {
    if (id === last && memberIds.length > 1) continue;
    const at = recent.lastIndexOf(id);
    if (at < bestAt) {
      best = id;
      bestAt = at;
    }
  }
  return best;
}

/** Who answers the owner's message, by turn style (crisis: everyone, to be supportive). */
export function planSpeakers(opts: { style: TurnStyle; memberIds: string[]; mentioned: string[]; next: number; crisis: boolean }): { speakers: string[] | null; next: number } {
  const ids = opts.memberIds;
  if (opts.crisis || opts.style === 'everyone') return { speakers: ids.slice(0, MAX_DIRECT_REPLIES), next: opts.next };
  if (opts.style === 'turns') return { speakers: [ids[((opts.next % ids.length) + ids.length) % ids.length]], next: opts.next + 1 };
  // 'mention' and 'fits': the people named; otherwise the router decides (null).
  if (opts.mentioned.length) return { speakers: opts.mentioned.filter((id) => ids.includes(id)).slice(0, MAX_DIRECT_REPLIES), next: opts.next };
  return { speakers: null, next: opts.next };
}

/** Who reacts in a banter step: someone the last line named, else whoever spoke least recently (never the last speaker). */
export function banterSpeaker(memberIds: string[], lastText: string, members: { id: string; name: string }[], recent: string[]): string | undefined {
  const last = recent.at(-1);
  const pool = memberIds.filter((id) => id !== last);
  if (!pool.length) return undefined;
  const named = namesIn(lastText, members.filter((m) => pool.includes(m.id)));
  return named[0] ?? fallbackSpeaker(pool, recent.filter((id) => pool.includes(id)));
}

/** The line each companion gets about the room (in her instructions, under "Important for this reply"). */
export function groupNote(o: { name: string; owner: string; title: string; others: string[]; mode: 'owner' | 'mentioned' | 'banter' | 'crisis'; lastSpeaker?: string }): string {
  const others = o.others.length === 1 ? o.others[0] : `${o.others.slice(0, -1).join(', ')} and ${o.others.at(-1)}`;
  const base =
    `This is a group chat in the app ("${o.title}") between ${o.owner} and several AI companions: you (${o.name}) and ${others}. Each of them is a separate AI character with their own personality, not you and not ${o.owner}. ` +
    `Their lines reach you labelled like "[${o.others[0]}, another AI companion]: …"; ${o.owner}'s lines are labelled "[${o.owner}]: …". ` +
    `Write only your own reply, as ${o.name}, starting straight with what you say (nothing in square brackets before it), and never write lines for ${others} or for ${o.owner}. Keep it short and natural for a group chat (one to four sentences unless asked for more), and use names when you talk to someone.`;
  if (o.mode === 'crisis') return `${base} ${o.owner} may be in crisis: answer with care and warmth, no jokes and no banter, and encourage reaching out to the help shown.`;
  if (o.mode === 'mentioned') return `${base} ${o.owner} asked you by name.`;
  if (o.mode === 'banter') return `${base} ${o.owner} hasn't said anything new: you may react briefly to ${o.lastSpeaker ?? 'the last message'} (agree, tease, add something). If you have nothing worthwhile to add, reply with exactly (pass).`;
  return base;
}

/** How another companion's line reaches a companion's model. */
export const otherLine = (name: string, text: string): string => `[${name}, another AI companion]: ${text}`;
/** How the owner's line reaches a companion's model in a group chat. */
export const ownerLine = (owner: string, text: string): string => `[${owner}]: ${text}`;

/** A tag the model copied in front of its reply ("[Movie night] …", "[Mia, another AI companion]: …") is removed. */
export function stripLeadTag(text: string, words: string[]): string {
  const m = /^\s*(?:\*\*|__)?\[([^\]\n]{1,80})\](?:\*\*|__)?\s*:?\s*/.exec(text);
  if (!m) return text;
  const tag = foldName(m[1]);
  // The room's labels, or the model echoing its instructions ("[No name tag for this reply]").
  const hit = /another ai companion|\b(name tag|tag|reply|group chat)\b/.test(tag) || words.some((w) => w.trim() && (tag === foldName(w.trim()) || tag.startsWith(`${foldName(w.trim())},`)));
  const rest = text.slice(m[0].length);
  return hit && rest.trim() ? rest : text;
}

/**
 * A reply that goes on to write lines for others ("…\nMia: sure!") is cut where the other
 * speaker starts. Only at the start of a line, and never the whole reply.
 */
export function cutOtherSpeakers(text: string, names: string[]): string {
  const ns = names.map((n) => n.trim()).filter(Boolean);
  if (!ns.length) return text;
  const re = new RegExp(`\\n\\s*(?:\\*\\*|__)?\\[?(?:${ns.map(escapeRe).join('|')})(?:,[^\\]\\n]{0,40})?\\]?(?:\\*\\*|__)?\\s*:`, 'iu');
  const m = re.exec(text);
  if (!m || !text.slice(0, m.index).trim()) return text;
  return text.slice(0, m.index).trimEnd();
}
