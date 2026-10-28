// Phase 6: health page data (Settings → Health and `sara status`). Read-only and cheap.
import { existsSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from './chat.ts';
import { DEFAULT_BACKUP, listBackups } from './backup.ts';

export interface AppInfo {
  version: string;
  revision: string | null;
  startedAt: string;
}

export function appInfo(root: string, startedAt = new Date()): AppInfo {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const revFile = join(root, 'REVISION');
  return { version: pkg.version, revision: existsSync(revFile) ? readFileSync(revFile, 'utf8').trim() || null : null, startedAt: startedAt.toISOString() };
}

const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);

export function healthReport(app: AppContext, info: AppInfo) {
  const now = app.now();
  const root = app.rootDir ?? app.dataDir;
  const db = join(app.dataDir, 'sara.db');
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try {
    const s = statfsSync(root);
    disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    /* not supported here */
  }
  const backups = listBackups(root);
  const backupCfg = { ...DEFAULT_BACKUP, ...app.settings.get().backup };
  const memErrors = app.memory ? app.memory.failing() : [];
  const offsite = { kind: 'off', ...app.settings.get().offsite } as { kind: string; last?: { ok: boolean; at: string }; lastTest?: { ok: boolean; at: string; error?: string; detail?: string } };
  const s = app.settings.get();
  // UX 19: `items` (optional) carries the same facts as `detail` as data, for the app to word them in the owner's language.
  const checks: { name: string; ok: boolean; detail: string; items?: unknown[] }[] = [];
  const add = (name: string, ok: boolean, detail: string, items?: unknown[]) => checks.push({ name, ok, detail, ...(items ? { items } : {}) });
  add('Model', Boolean(s.providers.length && s.defaultModel), s.providers.length ? `${s.defaultModel ?? 'no default model'}` : 'No model provider set up');
  add('Disk space', !disk || disk.freeBytes > 1e9, disk ? `${(disk.freeBytes / 1e9).toFixed(1)} GB free` : 'unknown');
  const last = backups[0];
  const backupAgeH = last ? (now.getTime() - Date.parse(last.createdAt)) / 3600_000 : Infinity;
  add('Backups', backupCfg.auto ? backupAgeH < 48 : Boolean(last), last ? `last ${last.name} (${backupAgeH < 1 ? 'under an hour' : `${Math.round(backupAgeH)} h`} ago)` : backupCfg.auto ? 'first automatic backup runs within the hour' : 'automatic backups are off');
  if (offsite.kind !== 'off') {
    const t = offsite.lastTest;
    const ageD = t ? (now.getTime() - Date.parse(t.at)) / 86_400_000 : Infinity;
    add('Off-server test restore', Boolean(t?.ok && ageD < 8) || (!t && !offsite.last?.ok), !t ? (offsite.last?.ok ? 'first test restore runs within the hour' : 'waiting for the first off-server copy') : t.ok ? `ok ${Math.max(0, Math.round(ageD))} day(s) ago (${t.detail ?? ''})` : `failed: ${t.error ?? 'unknown'}`);
  }
  add('Memory', memErrors.length === 0, memErrors.length ? `${memErrors.length} conversation(s) could not be summarized: ${memErrors[0]}` : 'ok');
  // Phase 34: stays in character (when the check is on): last 7 days.
  if ((s.persona?.inCharacter ?? 'off') !== 'off' && app.drift) {
    const w = app.drift.stats(new Date(now.getTime() - 7 * 86_400_000).toISOString());
    const share = w.checks ? w.drifted / w.checks : 0;
    add('Stays in character', !w.checks || (Number(w.average) >= 6.5 && share <= 0.2), w.checks ? `${w.average}/10 over ${w.checks} checked replies this week; ${w.drifted} drifted (each got a gentle nudge)` : 'no replies checked yet this week');
  }
  // Phase 46: without a sandbox (Windows) commands are fine as long as she asks before each one.
  const unasked = app.sandbox.mode === 'none' ? app.tools.list().filter((t) => t.runsCommands && app.tools.permission(t.spec.name, s.toolPermissions) === 'auto').map((t) => t.spec.name) : [];
  add('Tool sandbox', app.sandbox.mode !== 'none' || (process.platform !== 'linux' && !unasked.length), app.sandbox.mode !== 'none' ? `${app.sandbox.mode} (${app.sandbox.detail})` : unasked.length ? `none: ${unasked.join(', ')} run without asking (Settings → Abilities → Tools and approvals)` : `none (${app.sandbox.detail})`);
  // Phase 56: retired models still chosen somewhere, and switches made for them lately.
  if (app.modelCatalog) {
    // Hardening L1: a list that suddenly shrank (kept, nothing retired) is a warning too.
    const stuck = [...app.modelCatalog.retiredInUse(), ...app.modelCatalog.warnings()];
    const moved = app.modelCatalog.notices(14).slice(0, 5);
    if (stuck.length) add('Model lists', false, stuck.map((x) => x.text).join(' '), stuck);
    if (moved.length) add('Model changes', true, moved.map((n) => n.text).join(' '), moved);
  }
  const tg = app.bridges?.telegram?.status();
  if (s.telegram?.enabled) add('Telegram', Boolean(tg?.running), tg?.running ? `@${tg.bot}${tg.linked ? '' : ' (not linked yet)'}` : (tg?.error ?? 'not running'));
  const dc = app.bridges?.discord?.status();
  if (s.discord?.enabled) add('Discord', Boolean(dc?.running), dc?.running ? `${dc.bot}${dc.linked ? '' : ' (not linked yet)'}` : (dc?.error ?? 'not running'));
  for (const c of s.mcpServers ?? []) {
    if (!c.enabled) continue;
    const conn = app.mcp?.get(c.name);
    add(`MCP ${c.name}`, conn?.status === 'ready', conn ? `${conn.status}${conn.error ? `: ${conn.error}` : ''}` : 'not started');
  }
  return {
    ok: checks.every((c) => c.ok),
    version: info.version,
    revision: info.revision,
    node: process.version,
    startedAt: info.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    data: { dir: root, databaseBytes: size(db) + size(`${db}-wal`), disk },
    voice: app.voice ? app.voice.available : { stt: false, tts: false },
    pushDevices: app.push?.list().length ?? 0,
    backups: { ...backupCfg, count: backups.length, last: last ?? null },
    checks,
  };
}
