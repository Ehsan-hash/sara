// Phase 46: `sara status` on every system (node src/main.ts --status): a few plain lines.
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listBackups } from './backup.ts';
import type { AccessInfo } from './platform.ts';

/** Total size of the files in a folder (links not followed). */
export function folderBytes(dir: string): number {
  let total = 0;
  const walk = (p: string) => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) total += st.size;
    else if (st.isDirectory()) {
      let names: string[] = [];
      try {
        names = readdirSync(p);
      } catch {
        names = [];
      }
      for (const n of names) walk(join(p, n));
    }
  };
  walk(dir);
  return total;
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export interface StatusInput {
  version: string;
  dataDir: string;
  port: number;
  running: boolean;
  access?: AccessInfo;
  now?: Date;
}

export function statusReport(s: StatusInput): string {
  const now = s.now ?? new Date();
  let exists = true;
  try {
    exists = lstatSync(s.dataDir).isDirectory();
  } catch {
    exists = false;
  }
  const last = exists ? listBackups(s.dataDir)[0] : undefined;
  const age = last ? Math.max(0, Math.round((now.getTime() - Date.parse(last.createdAt)) / 3600_000)) : 0;
  const lines = [
    `Sara ${s.version}`,
    `Running:      ${s.running ? `yes, on port ${s.port}` : `no (port ${s.port})`}`,
    `Data folder:  ${s.dataDir}${exists ? ` (${humanBytes(folderBytes(s.dataDir))})` : ' (not created yet)'}`,
    `Last backup:  ${last ? `${last.name} (${age < 1 ? 'under an hour' : `${age} h`} ago)` : 'none yet'}`,
  ];
  if (s.access?.mode || s.access?.url) lines.push(`Reach her at: ${s.access.label}${s.access.url ? ` — ${s.access.url}` : ''}`);
  return lines.join('\n');
}
