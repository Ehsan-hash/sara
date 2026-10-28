// Phase 65: readers for companion-app chat files. Pure functions: text or parsed JSON in, the
// RawExport shape out; nothing is executed or fetched. Formats, as publicly described:
// - Character.AI: the account export (Profile → Profile Settings → Account → Manage Account & Data
//   → Export data) and the CAI Tools extension hold chats as { turns: [{ author: { name, is_human },
//   candidates: [{ candidate_id, raw_content }], primary_candidate_id, create_time }] }; older tools
//   wrote { histories: [{ msgs: [{ src: { name, is_human }, text }] }] }.
// - SillyTavern (docs.sillytavern.app, "Chat File Management", Export as .jsonl): the first line is
//   { user_name, character_name, create_date, chat_metadata }, then one line per message
//   { name, is_user, is_system, send_date, mes }.
// - Anything else (Replika, Nomi and Kindroid have no documented chat format; browser extensions
//   write JSON, CSV or text): a list of { sender/name/author, text/message/content, time } objects,
//   a CSV with such columns, or a plain text / Markdown transcript with "Name: text" lines.
import { clip, obj, type RawConversation, type RawExport, type RawMessage, str, timeOf } from './types.ts';

type Obj = Record<string, unknown>;

// ---------- Character.AI ----------

const isTurnList = (v: unknown): v is unknown[] => Array.isArray(v) && v.some((t) => Array.isArray(obj(t)?.candidates) && obj(obj(t)?.author) !== undefined);
const isHistory = (v: unknown): boolean => Array.isArray(obj(v)?.msgs);

/** The chats in a Character.AI file (turns or histories), wherever they sit in it. */
function caiChats(root: unknown, depth = 0, out: Obj[] = []): Obj[] {
  if (depth > 5 || out.length > 50_000) return out;
  if (Array.isArray(root)) {
    if (isTurnList(root)) out.push({ turns: root });
    else for (const x of root) caiChats(x, depth + 1, out);
    return out;
  }
  const o = obj(root);
  if (!o) return out;
  if (isTurnList(o.turns) || isHistory(o)) {
    out.push(o);
    return out;
  }
  for (const k of ['chats', 'chat', 'histories', 'history', 'conversations', 'data']) if (o[k] !== undefined) caiChats(o[k], depth + 1, out);
  return out;
}

export function looksLikeCharacterAI(v: unknown): boolean {
  return caiChats(v).length > 0;
}

export function readCharacterAI(v: unknown): RawExport {
  const owner = new Set<string>();
  const conversations: RawConversation[] = [];
  let leftOut = 0;
  let characterName: string | undefined;
  const root = obj(v);
  const info = obj(obj(root?.info)?.character) ?? obj(root?.character);
  if (info && str(info.name).trim()) characterName = str(info.name).trim().slice(0, 60);
  caiChats(v).forEach((chat, i) => {
    const messages: RawMessage[] = [];
    const chatName = str(chat.character_name ?? obj(chat.character)?.name ?? chat.name ?? chat.title).trim();
    if (Array.isArray(chat.turns)) {
      for (const raw of chat.turns) {
        const t = obj(raw);
        const author = obj(t?.author);
        if (!t || !author) continue;
        const cands = Array.isArray(t.candidates) ? t.candidates.map(obj).filter((c): c is Obj => Boolean(c)) : [];
        const chosen = cands.find((c) => c.candidate_id !== undefined && c.candidate_id === t.primary_candidate_id) ?? cands.at(-1);
        const text = str(chosen?.raw_content ?? chosen?.text).trim();
        const name = str(author.name).trim() || (author.is_human ? 'You' : chatName || 'Character');
        if (!text) {
          leftOut++;
          continue;
        }
        if (author.is_human === true) owner.add(name);
        messages.push({ speaker: name, text: clip(text), ...(timeOf(t.create_time ?? chosen?.create_time) ? { at: timeOf(t.create_time ?? chosen?.create_time) } : {}) });
      }
    } else {
      for (const raw of chat.msgs as unknown[]) {
        const m = obj(raw);
        const src = obj(m?.src);
        const text = str(m?.text ?? m?.raw_content).trim();
        if (!m || !text) {
          leftOut++;
          continue;
        }
        const name = str(src?.name ?? m.display_name ?? m.name).trim() || (src?.is_human ? 'You' : chatName || 'Character');
        if (src?.is_human === true || m.is_human === true) owner.add(name);
        const at = timeOf(m.created ?? m.create_time) ?? timeOf(chat.created ?? chat.create_time);
        messages.push({ speaker: name, text: clip(text), ...(at ? { at } : {}) });
      }
    }
    if (!characterName) characterName = chatName || messages.find((m) => !owner.has(m.speaker))?.speaker;
    if (messages.length) {
      const id = str(obj(obj(Array.isArray(chat.turns) ? chat.turns[0] : undefined)?.turn_key)?.chat_id ?? chat.chat_id ?? chat.external_id ?? chat.id) || `cai-${i}`;
      conversations.push({ sourceId: id, title: str(chat.title ?? chat.name).trim().slice(0, 120) || `Chat with ${chatName || characterName || 'the character'}${i ? ` (${i + 1})` : ''}`, messages });
    }
  });
  return { format: 'characterai', conversations, ownerSpeakers: [...owner], ...(characterName ? { characterName } : {}), leftOut };
}

// ---------- SillyTavern ----------

/** True when the first JSONL line is a SillyTavern chat header or message. */
export function looksLikeSillyTavern(firstLine: unknown): boolean {
  const o = obj(firstLine);
  return Boolean(o && ((o.user_name !== undefined && (o.character_name !== undefined || o.chat_metadata !== undefined)) || (o.mes !== undefined && o.is_user !== undefined)));
}

export function readSillyTavern(lines: Iterable<string>, name = 'chat'): RawExport {
  const messages: RawMessage[] = [];
  const owner = new Set<string>();
  let characterName: string | undefined;
  let userName: string | undefined;
  let leftOut = 0;
  let created: string | undefined;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: Obj | undefined;
    try {
      o = obj(JSON.parse(line));
    } catch {
      leftOut++;
      continue;
    }
    if (!o) continue;
    if (o.mes === undefined && o.user_name !== undefined) {
      userName = str(o.user_name).trim() || undefined;
      characterName = str(o.character_name).trim() || undefined;
      created = timeOf(o.create_date);
      continue;
    }
    const text = str(o.mes).trim();
    if (o.is_system === true || !text) {
      leftOut++;
      continue;
    }
    const speaker = str(o.name).trim() || (o.is_user ? (userName ?? 'You') : (characterName ?? 'Character'));
    if (o.is_user === true) owner.add(speaker);
    const at = timeOf(o.send_date) ?? created;
    messages.push({ speaker, text: clip(text), ...(at ? { at } : {}) });
  }
  if (userName && !owner.size) owner.add(userName);
  return {
    format: 'sillytavern',
    conversations: messages.length ? [{ sourceId: `st-${name}-${messages[0].at ?? ''}`, title: characterName ? `${characterName} (${name})` : name, messages }] : [],
    ownerSpeakers: [...owner],
    ...(characterName ? { characterName } : {}),
    leftOut,
  };
}

// ---------- generic JSON ----------

const SPEAKER_KEYS = ['sender', 'author', 'name', 'from', 'speaker', 'role', 'user', 'character'];
const TEXT_KEYS = ['text', 'message', 'content', 'body', 'mes', 'msg'];
const TIME_KEYS = ['timestamp', 'time', 'date', 'datetime', 'created_at', 'createdAt', 'send_date', 'sent_at', 'created', 'create_time'];
const OWNER_FLAGS = ['is_user', 'is_human', 'isUser', 'fromUser', 'from_user', 'is_me'];

function speakerOf(m: Obj): string {
  for (const k of SPEAKER_KEYS) {
    const v = m[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
    const o = obj(v);
    if (o && str(o.name ?? o.role).trim()) return str(o.name ?? o.role).trim().slice(0, 60);
  }
  return '';
}
function textOf(m: Obj): string {
  for (const k of TEXT_KEYS) {
    const v = m[k];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((p) => (typeof p === 'string' ? p : str(obj(p)?.text))).join('\n');
    const o = obj(v);
    if (o && typeof o.text === 'string') return o.text;
  }
  return '';
}
const looksLikeMessage = (v: unknown): boolean => {
  const o = obj(v);
  return Boolean(o && speakerOf(o) && TEXT_KEYS.some((k) => o[k] !== undefined));
};

/** Message lists in a JSON value: a list of messages, or conversations holding one. */
function messageLists(v: unknown, depth = 0, out: { title: string; id: string; list: Obj[] }[] = [], title = '', id = ''): typeof out {
  if (depth > 4 || out.length > 50_000) return out;
  if (Array.isArray(v)) {
    const msgs = v.filter(looksLikeMessage) as Obj[];
    if (msgs.length && msgs.length >= v.length / 2) out.push({ title, id: id || `list-${out.length}`, list: msgs });
    else v.forEach((x, i) => messageLists(x, depth + 1, out, '', `${id || 'c'}-${i}`));
    return out;
  }
  const o = obj(v);
  if (!o) return out;
  const t = str(o.title ?? o.name ?? o.character_name).trim();
  for (const k of ['messages', 'chat', 'history', 'conversation', 'conversations', 'chats', 'data', 'items', 'log']) if (o[k] !== undefined) messageLists(o[k], depth + 1, out, t || title, str(o.id ?? o.uuid) || id);
  return out;
}

export function looksLikeGenericJson(v: unknown): boolean {
  return messageLists(v).length > 0;
}

export function readGenericJson(v: unknown, name = 'chat'): RawExport {
  const owner = new Set<string>();
  let leftOut = 0;
  const conversations: RawConversation[] = [];
  for (const [i, l] of messageLists(v).entries()) {
    const messages: RawMessage[] = [];
    for (const m of l.list) {
      const speaker = speakerOf(m);
      const text = textOf(m).trim();
      if (!text || /^(system|tool|function)$/i.test(speaker)) {
        leftOut++;
        continue;
      }
      if (OWNER_FLAGS.some((k) => m[k] === true) || /^(user|human|me|you)$/i.test(speaker)) owner.add(speaker);
      const at = TIME_KEYS.map((k) => timeOf(m[k])).find(Boolean);
      messages.push({ speaker, text: clip(text), ...(at ? { at } : {}) });
    }
    if (messages.length) conversations.push({ sourceId: `json-${name}-${l.id}-${i}`, title: l.title || (i ? `${name} ${i + 1}` : name), messages });
  }
  return { format: 'json', conversations, ownerSpeakers: [...owner], leftOut };
}

// ---------- CSV ----------

/** RFC 4180 rows (quoted fields, doubled quotes, newlines inside quotes). */
export function* csvRows(text: string, sep = ','): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) yield row;
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) yield row;
}

const col = (header: string[], names: string[]) => header.findIndex((h) => names.includes(h.trim().toLowerCase().replace(/[\s-]+/g, '_')));
const csvSep = (first: string) => ([',', ';', '\t'] as const).map((s) => ({ s, n: first.split(s).length })).sort((a, b) => b.n - a.n)[0].s;

export function looksLikeCsv(text: string): boolean {
  const first = text.slice(0, 2000).split(/\r?\n/)[0] ?? '';
  const header = first.split(csvSep(first)).map((h) => h.replace(/"/g, ''));
  return header.length >= 2 && col(header, SPEAKER_KEYS.concat(['sender_name', 'author_name'])) >= 0 && col(header, TEXT_KEYS) >= 0;
}

export function readCsv(text: string, name = 'chat'): RawExport {
  const first = text.slice(0, 2000).split(/\r?\n/)[0] ?? '';
  const sep = csvSep(first);
  const rows = csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, sep);
  const header = rows.next().value ?? [];
  const si = col(header, SPEAKER_KEYS.concat(['sender_name', 'author_name']));
  const ti = col(header, TEXT_KEYS);
  const wi = col(header, TIME_KEYS.map((k) => k.toLowerCase()));
  const oi = col(header, OWNER_FLAGS.map((k) => k.toLowerCase()));
  const owner = new Set<string>();
  const messages: RawMessage[] = [];
  let leftOut = 0;
  for (const r of rows) {
    const speaker = (r[si] ?? '').trim().slice(0, 60);
    const text = (r[ti] ?? '').trim();
    if (!speaker || !text) {
      leftOut++;
      continue;
    }
    if (oi >= 0 && /^(true|1|yes)$/i.test(r[oi] ?? '')) owner.add(speaker);
    if (/^(user|human|me|you)$/i.test(speaker)) owner.add(speaker);
    const at = wi >= 0 ? timeOf(r[wi]) : undefined;
    messages.push({ speaker, text: clip(text), ...(at ? { at } : {}) });
  }
  return { format: 'csv', conversations: splitByDay(messages, name), ownerSpeakers: [...owner], leftOut };
}

// ---------- plain text / Markdown ----------

const TIME_PART = String.raw`(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:,?\s+|T)?)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)?`;
/** "[2024-03-05 21:14] Alex: hi", "3/5/24, 9:14 PM - Alex: hi", "**Alex:** hi", "Alex: hi". */
const LINE = new RegExp(String.raw`^\s*(?:>\s*)?(?:\[(${TIME_PART})\]\s*|(${TIME_PART})\s+[-–—]\s+)?(?:\*\*|__)?([\p{L}][\p{L}\p{N} ._'’-]{0,39}?)(?:\*\*|__)?\s*:(?:\*\*|__)?\s+(.*)$`, 'u');
/** A Markdown heading that is a speaker: "## Alex" / "### Mira:". */
const HEADING = /^\s*#{1,4}\s+([\p{L}][\p{L}\p{N} ._'’-]{0,39}?)\s*:?\s*$/u;
/** A line that is only a date: a new day, so a new conversation. */
const DATE_LINE = /^\s*(?:[-=#*\s]*)((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/\d{2,4})|(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})(?:[-=#*\s]*)$/i;
const NOT_SPEAKERS = /^(https?|note|notes|edit|p\.?s|re|subject|to|from|date|time|title|summary|example|warning|tip|step \d+|q|a)$/i;

function readTime(day: string | undefined, part: string | undefined): string | undefined {
  if (!part?.trim()) return undefined;
  const p = part.trim().replace(/,$/, '');
  if (/^\d{1,2}:\d{2}/.test(p) && day) return timeOf(`${day} ${p}`);
  // "3/5/24, 9:14 PM": a two-digit year is this century.
  return timeOf(p.replace(/^(\d{1,2}\/\d{1,2}\/)(\d{2})(?=,|\s)/, '$120$2'));
}

export function readTranscript(text: string, name = 'transcript'): RawExport {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  // Labels first: a label counts as a speaker when it starts lines at least twice (or is "You").
  const counts = new Map<string, number>();
  for (const l of lines) {
    const m = LINE.exec(l) ?? HEADING.exec(l);
    const label = (m ? (m.length > 2 ? m[3] : m[1]) : '')?.trim();
    if (label && !NOT_SPEAKERS.test(label) && label.split(/\s+/).length <= 4) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const speakers = new Set([...counts].filter(([k, n]) => n >= 2 || /^(you|me|user)$/i.test(k)).map(([k]) => k));
  const messages: RawMessage[] = [];
  let day: string | undefined;
  let leftOut = 0;
  let cur: RawMessage | undefined;
  for (const l of lines) {
    const date = DATE_LINE.exec(l);
    if (date) {
      day = timeOf(date[1].replace(/^(\d{1,2}\/\d{1,2}\/)(\d{2})$/, '$120$2'))?.slice(0, 10) ?? day;
      cur = undefined;
      continue;
    }
    const m = LINE.exec(l);
    if (m && speakers.has(m[3].trim())) {
      const at = readTime(day, m[1] ?? m[2]) ?? (day ? `${day}T12:00:00.000Z` : undefined);
      cur = { speaker: m[3].trim(), text: m[4], ...(at ? { at } : {}) };
      messages.push(cur);
      continue;
    }
    const h = HEADING.exec(l);
    if (h && speakers.has(h[1].trim())) {
      cur = { speaker: h[1].trim(), text: '', ...(day ? { at: `${day}T12:00:00.000Z` } : {}) };
      messages.push(cur);
      continue;
    }
    if (cur) cur.text += `\n${l.replace(/^\s*>\s?/, '')}`;
    else if (l.trim()) leftOut++;
  }
  const clean = messages.map((m) => ({ ...m, text: clip(m.text.trim()) })).filter((m) => m.text);
  return { format: 'text', conversations: splitByDay(clean, name), ownerSpeakers: [...speakers].filter((s) => /^(you|me|user)$/i.test(s)), leftOut };
}

/** Messages with times become one conversation per day (a long log is many days); without times, one. */
export function splitByDay(messages: RawMessage[], name: string): RawConversation[] {
  if (!messages.length) return [];
  if (!messages.some((m) => m.at)) return [{ sourceId: `${name}-all`, title: name, messages }];
  const out: RawConversation[] = [];
  let day = '';
  let lastAt: string | undefined;
  for (const m of messages) {
    const at = m.at ?? lastAt;
    lastAt = at;
    const d = at?.slice(0, 10) ?? day;
    if (!out.length || d !== day) {
      day = d;
      out.push({ sourceId: `${name}-${d || out.length}`, title: d ? `${name} (${d})` : name, messages: [] });
    }
    out.at(-1)!.messages.push(at ? { ...m, at } : m);
  }
  return out;
}
