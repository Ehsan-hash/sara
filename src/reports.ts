// Phase 19: "Report this reply". Google Play requires AI apps to let people flag offensive
// AI-generated content without leaving the app, and to get those reports to the developer.
// A report is kept on the owner's own server (Settings → Data → Reports) and, unless the owner
// says no, also sent to the app developer's report inbox: only the reply's text, the reason and
// the note, nothing else from the conversation. The developer's server runs with
// SARA_REPORT_INBOX=1 to accept them (public, size- and rate-limited).
import { netFetch } from './net-guard.ts';
import type { DatabaseSync } from 'node:sqlite';

export const REPORT_REASONS = ['harmful', 'sexual', 'hateful', 'false', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REASON_LABELS: Record<ReportReason, string> = {
  harmful: 'Harmful or dangerous',
  sexual: 'Sexual content',
  hateful: 'Hateful or harassing',
  false: 'False or misleading',
  other: 'Something else',
};
/** Where reports go when they're sent to the developer (the app's publisher). */
export const DEFAULT_REPORT_INBOX = 'https://sara.backstagecoding.com/api/public/report';
const MAX_TEXT = 6000;
const MAX_NOTE = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER,
  conversation_id TEXT,
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  model TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  send_error TEXT
);
CREATE TABLE IF NOT EXISTS report_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  model TEXT,
  platform TEXT,
  app_version TEXT,
  received_at TEXT NOT NULL
);`;

export interface Report {
  id: number;
  messageId: number | null;
  conversationId: string | null;
  text: string;
  reason: ReportReason;
  note: string;
  model: string | null;
  createdAt: string;
  sentAt: string | null;
  sendError: string | null;
}

export interface InboxReport {
  id: number;
  text: string;
  reason: ReportReason;
  note: string;
  model: string | null;
  platform: string | null;
  appVersion: string | null;
  receivedAt: string;
}

export const validReason = (r: unknown): r is ReportReason => typeof r === 'string' && (REPORT_REASONS as readonly string[]).includes(r);

export class ReportStore {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  /** Per-address counts for the public inbox (reset hourly). */
  readonly #inboxHits = new Map<string, number>();
  #inboxHour = '';

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    db.exec(SCHEMA);
  }

  add(r: { messageId?: number; conversationId?: string; text: string; reason: ReportReason; note?: string; model?: string }): Report {
    const row = this.#db
      .prepare('INSERT INTO reports (message_id, conversation_id, text, reason, note, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(r.messageId ?? null, r.conversationId ?? null, r.text.slice(0, MAX_TEXT), r.reason, (r.note ?? '').slice(0, MAX_NOTE), r.model ?? null, this.#now().toISOString()) as { id: number };
    return this.get(row.id)!;
  }

  get(id: number): Report | undefined {
    const r = this.#db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as Record<string, string | number | null> | undefined;
    return r ? this.#report(r) : undefined;
  }

  list(): Report[] {
    return (this.#db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 200').all() as Record<string, string | number | null>[]).map((r) => this.#report(r));
  }

  #report(r: Record<string, string | number | null>): Report {
    return {
      id: Number(r.id),
      messageId: r.message_id === null ? null : Number(r.message_id),
      conversationId: (r.conversation_id as string | null) ?? null,
      text: String(r.text),
      reason: r.reason as ReportReason,
      note: String(r.note ?? ''),
      model: (r.model as string | null) ?? null,
      createdAt: String(r.created_at),
      sentAt: (r.sent_at as string | null) ?? null,
      sendError: (r.send_error as string | null) ?? null,
    };
  }

  /** Sends a report to the developer's inbox; records whether it worked. */
  async send(id: number, info: { platform: string; appVersion: string }, inbox = DEFAULT_REPORT_INBOX, fetchImpl: typeof fetch = netFetch): Promise<boolean> {
    const r = this.get(id);
    if (!r) return false;
    try {
      const res = await fetchImpl(inbox, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: r.text, reason: r.reason, note: r.note, model: r.model, platform: info.platform, appVersion: info.appVersion }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`the inbox answered ${res.status}`);
      this.#db.prepare('UPDATE reports SET sent_at = ?, send_error = NULL WHERE id = ?').run(this.#now().toISOString(), id);
      return true;
    } catch (err) {
      this.#db.prepare('UPDATE reports SET send_error = ? WHERE id = ?').run((err as Error).message.slice(0, 200), id);
      return false;
    }
  }

  // ---------- the developer's inbox (SARA_REPORT_INBOX=1) ----------

  /** Accepts a report from any Sara server or app. Returns false when this address sent too many. */
  receive(from: string, body: Record<string, unknown>): boolean {
    const hour = this.#now().toISOString().slice(0, 13);
    if (hour !== this.#inboxHour) {
      this.#inboxHour = hour;
      this.#inboxHits.clear();
    }
    const n = (this.#inboxHits.get(from) ?? 0) + 1;
    this.#inboxHits.set(from, n);
    if (n > 30) return false;
    const text = String(body.text ?? '').trim();
    if (!text || !validReason(body.reason)) throw new Error('A report needs the reply text and a reason.');
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
    this.#db
      .prepare('INSERT INTO report_inbox (text, reason, note, model, platform, app_version, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(text.slice(0, MAX_TEXT), body.reason, s(body.note, MAX_NOTE) ?? '', s(body.model, 100), s(body.platform, 40), s(body.appVersion, 20), this.#now().toISOString());
    // Keep the inbox bounded.
    this.#db.exec('DELETE FROM report_inbox WHERE id NOT IN (SELECT id FROM report_inbox ORDER BY id DESC LIMIT 5000)');
    return true;
  }

  inbox(): InboxReport[] {
    return (this.#db.prepare('SELECT * FROM report_inbox ORDER BY id DESC LIMIT 200').all() as Record<string, string | number | null>[]).map((r) => ({
      id: Number(r.id),
      text: String(r.text),
      reason: r.reason as ReportReason,
      note: String(r.note ?? ''),
      model: (r.model as string | null) ?? null,
      platform: (r.platform as string | null) ?? null,
      appVersion: (r.app_version as string | null) ?? null,
      receivedAt: String(r.received_at),
    }));
  }
}
