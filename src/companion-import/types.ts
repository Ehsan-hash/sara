// Phase 65: "Bring her from another app". The shape every reader turns a file into: conversations
// of messages by named speakers (the owner says who is who in the preview), plus what was left out.
import type { HistorySource } from '../history-import/types.ts';

export type ImportFormat = 'chatgpt' | 'claude' | 'characterai' | 'sillytavern' | 'json' | 'csv' | 'text';

/** How each format is named in the preview. */
export const FORMAT_NAME: Record<ImportFormat, string> = {
  chatgpt: 'ChatGPT export',
  claude: 'Claude export',
  characterai: 'Character.AI chat',
  sillytavern: 'SillyTavern chat',
  json: 'Chat file (JSON)',
  csv: 'Chat file (CSV)',
  text: 'Text transcript',
};

/** Which app it came from: from the format, or the owner's choice for the generic ones. */
export const FORMAT_SOURCE: Record<ImportFormat, HistorySource> = { chatgpt: 'chatgpt', claude: 'claude', characterai: 'characterai', sillytavern: 'sillytavern', json: 'text', csv: 'text', text: 'text' };
/** The apps the owner can name for a generic file (Replika, Nomi and Kindroid have no documented chat format). */
export const PICKABLE_SOURCES: readonly HistorySource[] = ['characterai', 'sillytavern', 'replika', 'nomi', 'kindroid', 'chatgpt', 'claude', 'text'];

export interface RawMessage {
  /** The speaker's label as it is in the file ("You", "Mira", "Alex"). */
  speaker: string;
  text: string;
  /** ISO time, when the file has one. */
  at?: string;
}

export interface RawConversation {
  sourceId: string;
  title: string;
  messages: RawMessage[];
}

export interface RawExport {
  format: ImportFormat;
  conversations: RawConversation[];
  /** Speakers the file itself marks as the person (is_user / is_human / "user" role). */
  ownerSpeakers: string[];
  /** The character's name when the file says it. */
  characterName?: string;
  /** Messages left out while reading (system lines, hidden, tool output, empty). */
  leftOut: number;
}

/** Biggest upload accepted: a zip, or a single file. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Zip-bomb caps for an uploaded zip. */
export const IMPORT_ZIP_LIMITS = { maxEntries: 200_000, maxEntryBytes: 400 * 1024 * 1024, maxTotalBytes: 800 * 1024 * 1024, maxRatio: 250 };
/** Files inside a zip looked at when it has no conversations.json (Character.AI and others). */
export const MAX_SCANNED_ENTRIES = 2_000;
export const MAX_CONVERSATIONS = 20_000;
export const MAX_MESSAGE_CHARS = 20_000;

export class ImportError extends Error {}

type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** A time from a file (seconds, milliseconds, ISO or a readable date) as ISO, or undefined. */
export function timeOf(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim();
    if (/^\d{10,13}$/.test(s)) return timeOf(Number(s));
    // SillyTavern writes "July 5, 2024 8:05pm"; Date wants a space before am/pm.
    const d = new Date(s.replace(/(\d)(am|pm)\b/i, '$1 $2'));
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1990 || d.getFullYear() > 2200) return undefined;
    // A time without a zone is kept as written (stored as if UTC), so days don't shift with the server's zone.
    const zoned = /(Z|[+-]\d{2}:?\d{2}|\b(UTC|GMT))$/i.test(s) || !/\d{1,2}:\d{2}/.test(s);
    return zoned ? d.toISOString() : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
  }
  return undefined;
}

export const clip = (s: string): string => (s.length > MAX_MESSAGE_CHARS ? `${s.slice(0, MAX_MESSAGE_CHARS)} […]` : s);
