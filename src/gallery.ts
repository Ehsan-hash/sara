// Phase 51: the character gallery. Ready-made companions to start from (persona/gallery/*.json),
// each one an ordinary Sara character file (so it can be shared and loaded anywhere) plus a short
// pitch and three tags for its card. Using one goes through the normal character import, keeping
// the current look. All of them are original, adults, and not romantic or sexual by default.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CharacterFile, parseCharacter } from './characterfile.ts';
import { buildSystemPrompt, type Persona } from './persona.ts';
import { type AppContext, resolveFor } from './chat.ts';
import { ADULT_OFF_NOTE } from './safety.ts';
import { adultModeOn } from './settings.ts';
import type { Conversation } from './store.ts';

export const GALLERY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'persona', 'gallery');

export interface GalleryEntry {
  id: string;
  pitch: string;
  tags: string[];
  persona: Persona;
  /** The whole character file, as shared (what "Use this" loads). */
  file: CharacterFile;
}

/** Checks one gallery file; throws a plain-words error. */
export function checkGalleryFile(id: string, raw: unknown): GalleryEntry {
  const f = raw as CharacterFile & { gallery?: { pitch?: unknown; tags?: unknown } };
  const { persona } = parseCharacter(f); // adults only, the same checks as any character file
  const pitch = String(f.gallery?.pitch ?? '').trim();
  if (!pitch || pitch.length > 140) throw new Error(`${id}: the pitch must be 1-140 characters`);
  const tags = Array.isArray(f.gallery?.tags) ? f.gallery.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  if (tags.length !== 3 || tags.some((t) => t.length > 24)) throw new Error(`${id}: give exactly three short tags`);
  if (f.look !== undefined) throw new Error(`${id}: gallery characters ship without pictures (the current look is kept)`);
  return { id, pitch, tags, persona, file: f };
}

let cache: GalleryEntry[] | undefined;

/** Every gallery character (read once). */
export function gallery(dir = GALLERY_DIR): GalleryEntry[] {
  if (cache && dir === GALLERY_DIR) return cache;
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    names = [];
  }
  const out: GalleryEntry[] = [];
  for (const n of names) {
    try {
      out.push(checkGalleryFile(n.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, n), 'utf8'))));
    } catch (err) {
      console.warn(`gallery: skipped ${n}: ${(err as Error).message}`);
    }
  }
  if (dir === GALLERY_DIR) cache = out;
  return out;
}

export const galleryEntry = (id: string): GalleryEntry | undefined => gallery().find((g) => g.id === id);

/** What the cards need (plus the file itself, which "Use this" posts to the character import). */
export function galleryList(): { id: string; name: string; pronouns: string; age: number; pitch: string; tags: string[]; summary: string; file: CharacterFile }[] {
  return gallery().map((g) => ({ id: g.id, name: g.persona.name, pronouns: g.persona.pronouns ?? 'she', age: g.persona.age, pitch: g.pitch, tags: g.tags, summary: g.persona.summary, file: g.file }));
}

/** No model is connected yet (setup asks for one after the character): the app answers 409. */
export class NoBrainError extends Error {}

/** "Try a line": how this character would say hi (one or two sentences), written by the model now. */
export async function galleryLine(app: AppContext, g: GalleryEntry): Promise<string> {
  const s = app.settings.get();
  const system = buildSystemPrompt(g.persona, { now: app.now(), timeZone: s.timeZone, ownerName: s.ownerName, memory: false, safetyNotes: adultModeOn(s) ? [] : [ADULT_OFF_NOTE] });
  let picked: ReturnType<typeof resolveFor>;
  try {
    picked = resolveFor(app, { providerId: null, model: null, mode: 'chat', private: false } as unknown as Conversation, 'turn');
  } catch {
    throw new NoBrainError('Connect a brain first (the next step), then you can hear them.');
  }
  const { provider, model } = picked;
  let out = '';
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: 'Hi! We just met. Say hello the way you really talk, in one or two short sentences.' },
  ];
  for await (const ev of provider.stream({ model, messages, temperature: 0.8, maxTokens: 120, reasoning: 'none', signal: AbortSignal.timeout(60_000) })) {
    if (ev.type === 'text') out += ev.text;
    if (out.length > 600) break;
  }
  const line = out.trim().replace(/\s+/g, ' ');
  return line.length > 280 ? `${line.slice(0, 279)}…` : line;
}
