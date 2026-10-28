// Phase 34: "stays in character". An optional background check rates some of her replies against
// her character sheet (1-10). A reply that drifted leaves a one-time nudge for her next reply in
// that conversation; the scores show on the health page and the personality page.
import type { DatabaseSync } from 'node:sqlite';
import { type AppContext, resolveFor } from './chat.ts';
import { sheetText } from './studio.ts';
import type { Conversation } from './store.ts';

export type DriftMode = 'off' | 'some' | 'every';
/** A score at or below this counts as drift (and gets a nudge). */
export const DRIFT_AT = 5;
/** 'some' checks every third reply. */
export const SOME_EVERY = 3;

export interface DriftCheck {
  id: number;
  conversationId: string;
  messageId: number;
  score: number;
  note: string;
  at: string;
  corrected: boolean;
}

export class DriftStore {
  #db: DatabaseSync;
  #now: () => Date;
  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS character_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL,
      corrected INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS character_checks_conv ON character_checks(conversation_id, id);`);
  }

  record(conversationId: string, messageId: number, score: number, note: string): DriftCheck {
    const at = this.#now().toISOString();
    const r = this.#db.prepare('INSERT INTO character_checks (conversation_id, message_id, score, note, at) VALUES (?, ?, ?, ?, ?)').run(conversationId, messageId, score, note, at);
    return { id: Number(r.lastInsertRowid), conversationId, messageId, score, note, at, corrected: false };
  }

  /** The latest check in this conversation if it drifted and hasn't been acted on. */
  pending(conversationId: string): DriftCheck | undefined {
    const row = this.#db.prepare('SELECT * FROM character_checks WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId) as Record<string, unknown> | undefined;
    if (!row || Number(row.corrected) || Number(row.score) > DRIFT_AT) return undefined;
    return toCheck(row);
  }

  markCorrected(id: number): void {
    this.#db.prepare('UPDATE character_checks SET corrected = 1 WHERE id = ?').run(id);
  }

  /** Checks since a time: how many, the average score and how many drifted. */
  stats(sinceIso: string): { checks: number; average: number | null; drifted: number } {
    const r = this.#db.prepare('SELECT COUNT(*) AS n, AVG(score) AS avg, SUM(CASE WHEN score <= ? THEN 1 ELSE 0 END) AS d FROM character_checks WHERE at >= ?').get(DRIFT_AT, sinceIso) as { n: number; avg: number | null; d: number | null };
    return { checks: Number(r.n), average: r.avg === null ? null : Math.round(Number(r.avg) * 10) / 10, drifted: Number(r.d ?? 0) };
  }

  recent(limit = 20): DriftCheck[] {
    return (this.#db.prepare('SELECT * FROM character_checks ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map(toCheck);
  }
}

const toCheck = (r: Record<string, unknown>): DriftCheck => ({
  id: Number(r.id),
  conversationId: String(r.conversation_id),
  messageId: Number(r.message_id),
  score: Number(r.score),
  note: String(r.note ?? ''),
  at: String(r.at),
  corrected: Boolean(Number(r.corrected)),
});

export const driftMode = (app: AppContext): DriftMode => app.settings.get().persona?.inCharacter ?? 'off';

/** Whether this reply gets checked (owner chats only; private ones stay on local models, so they're skipped). */
export function shouldCheck(app: AppContext, conv: Conversation, assistantCount: number): boolean {
  const mode = driftMode(app);
  if (mode === 'off' || !app.drift || conv.partner || conv.private || conv.mode === 'coding') return false;
  return mode === 'every' || assistantCount % SOME_EVERY === 0;
}

/** The judge prompt: the sheet, what was said, her reply. Asks for JSON {score, note}. */
export function judgePrompt(sheet: string, said: string, reply: string): string {
  return `You check whether a companion character stays in character. Her character sheet:\n${sheet}\n\nThe person said:\n${said.slice(0, 800)}\n\nHer reply:\n${reply.slice(0, 1500)}\n\nRate 1-10 how well the reply fits THIS character: her personality and dials, humour, how she talks (length, register), her life details. Do not judge facts, helpfulness or safety. 10 = unmistakably her; 5 = generic, could be anyone; 1 = clearly someone else (e.g. a formal assistant voice for a casual teasing character). Answer ONLY JSON: {"score": <1-10>, "note": "<if under 8: what was off, in under 15 words; else empty>"}`;
}

export function parseJudge(text: string): { score: number; note: string } | undefined {
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { score?: unknown; note?: unknown };
    const score = Math.round(Number(j.score));
    if (!Number.isFinite(score) || score < 1 || score > 10) return undefined;
    return { score, note: String(j.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  } catch {
    return undefined;
  }
}

/** Rates one reply with the background model and records it. Never throws (a failed check is skipped). */
export async function checkReply(app: AppContext, conv: Conversation, said: string, messageId: number, reply: string): Promise<DriftCheck | undefined> {
  if (!app.drift || !reply.trim()) return undefined;
  try {
    const { provider, model } = resolveFor(app, conv, 'background');
    let out = '';
    for await (const ev of provider.stream({ model, messages: [{ role: 'user', content: judgePrompt(sheetText(app.persona), said, reply) }], temperature: 0.1, maxTokens: 120, reasoning: 'none', signal: AbortSignal.timeout(60_000) })) {
      if (ev.type === 'text') out += ev.text;
      if (out.length > 2000) break;
    }
    const r = parseJudge(out);
    return r ? app.drift.record(conv.id, messageId, r.score, r.note) : undefined;
  } catch {
    return undefined;
  }
}
