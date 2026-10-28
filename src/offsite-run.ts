// Glue between Sara's settings/vault and off-server copies (used by the daily backup and the API).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { restoreBackup } from './backup.ts';
import type { AppContext } from './chat.ts';
import { decryptBackup, DEFAULT_OFFSITE, downloadNewestOffsite, OFFSITE_PASS_VAULT, OFFSITE_S3_VAULT, type OffsiteSettings, uploadOffsite } from './offsite.ts';

export function offsiteSettings(app: AppContext): OffsiteSettings {
  return { ...DEFAULT_OFFSITE, ...app.settings.get().offsite };
}

/** Copies one local backup off the server if that is set up; records the result. */
export async function copyOffsite(app: AppContext, file: string): Promise<string | undefined> {
  const cfg = offsiteSettings(app);
  if (cfg.kind === 'off') return undefined;
  const at = app.now().toISOString();
  try {
    const name = await uploadOffsite(file, cfg, { passphrase: app.vault.get(OFFSITE_PASS_VAULT), s3Secret: app.vault.get(OFFSITE_S3_VAULT) });
    app.settings.update({ offsite: { ...offsiteSettings(app), last: { at, ok: true, name } } });
    return name;
  } catch (err) {
    app.settings.update({ offsite: { ...offsiteSettings(app), last: { at, ok: false, error: (err as Error).message.slice(0, 300) } } });
    throw err;
  }
}

export interface OffsiteTest {
  at: string;
  ok: boolean;
  name?: string;
  /** When the tested backup was made. */
  madeAt?: string;
  detail?: string;
  error?: string;
}

/** Days between automatic test restores. */
export const OFFSITE_TEST_DAYS = 7;

/**
 * Phase 30: proves the newest off-server copy can really be restored. Downloads it, decrypts it
 * with the backup passphrase, restores it into a temporary folder (never the live data), checks
 * the database and counts what's in it, then deletes the temporary copy. Records the result.
 */
export async function testOffsite(app: AppContext, fetchImpl: typeof fetch = fetch): Promise<OffsiteTest> {
  const cfg = offsiteSettings(app);
  const at = app.now().toISOString();
  // Inside Sara's own (private) data folder, not the system temp folder: the copy holds her keys.
  mkdirSync(join(app.rootDir ?? app.dataDir, 'tmp'), { recursive: true, mode: 0o700 });
  const tmp = mkdtempSync(join(app.rootDir ?? app.dataDir, 'tmp', 'restore-test-'));
  let result: OffsiteTest;
  try {
    if (cfg.kind === 'off') throw new Error('Off-server copies are turned off.');
    const pass = app.vault.get(OFFSITE_PASS_VAULT);
    if (!pass) throw new Error('No backup passphrase is set.');
    const { name, data } = await downloadNewestOffsite(cfg, { s3Secret: app.vault.get(OFFSITE_S3_VAULT) }, fetchImpl);
    const file = join(tmp, 'backup.tar.gz');
    writeFileSync(file, decryptBackup(data, pass), { mode: 0o600 });
    const dir = join(tmp, 'data');
    const { manifest } = restoreBackup(file, dir, app.now());
    const db = new DatabaseSync(join(dir, 'sara.db'), { readOnly: true });
    try {
      const check = String((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
      if (check !== 'ok') throw new Error(`The database in it is damaged (${check.slice(0, 120)}).`);
      const n = (t: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
      result = { at, ok: true, name, madeAt: manifest.createdAt, detail: `${n('conversations')} conversations, ${n('messages')} messages, ${manifest.files} files` };
    } finally {
      db.close();
    }
  } catch (err) {
    result = { at, ok: false, error: (err as Error).message.slice(0, 300) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  app.settings.update({ offsite: { ...offsiteSettings(app), lastTest: result } });
  return result;
}

/** Is an automatic test restore due? (Off-server copies on, and none in the last week.) */
export function offsiteTestDue(app: AppContext): boolean {
  const cfg = offsiteSettings(app);
  if (cfg.kind === 'off' || !cfg.last?.ok) return false;
  const last = cfg.lastTest?.at ? Date.parse(cfg.lastTest.at) : 0;
  return app.now().getTime() - last >= OFFSITE_TEST_DAYS * 86_400_000;
}
