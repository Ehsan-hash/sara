// Phase 46: finds Tailscale on this computer and reads its state, for the installers' "How will
// you reach her?" question (`node src/main.ts --tailscale-status` prints it as JSON).
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

export interface TailscaleStatus {
  /** The tailscale command was found. */
  installed: boolean;
  cli: string | null;
  /** Signed in and connected (BackendState "Running"). */
  running: boolean;
  /** Tailscale's own word for its state: Running, Stopped, NeedsLogin, … */
  state: string | null;
  /** This computer's name on the tailnet, e.g. box.tailnet-1234.ts.net (no trailing dot). */
  dnsName: string | null;
  /** The HTTPS address `tailscale serve` gives it, when it has a name. */
  url: string | null;
  ips: string[];
  error?: string;
}

export interface FindOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A program on the PATH (with Windows' .exe/.cmd endings), or null. */
export function onPath(name: string, o: FindOptions = {}): string | null {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const exists = o.exists ?? isFile;
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = platform === 'win32' ? `${d.replace(/[\\/]+$/, '')}\\${name}${e}` : `${d.replace(/\/+$/, '')}/${name}`;
      if (exists(p)) return p;
    }
  }
  return null;
}

/** Where the tailscale command is: the usual install place for this system, then the PATH. */
export function findTailscale(o: FindOptions = {}): string | null {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const exists = o.exists ?? isFile;
  const known =
    platform === 'win32'
      ? [`${env.ProgramFiles ?? 'C:\\Program Files'}\\Tailscale\\tailscale.exe`, 'C:\\Program Files\\Tailscale\\tailscale.exe']
      : platform === 'darwin'
        ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']
        : [];
  for (const k of known) if (exists(k)) return k;
  return onPath('tailscale', { platform, env, exists });
}

/** Reads the JSON of `tailscale status --json`. */
export function parseTailscaleStatus(json: string, cli: string | null = null): TailscaleStatus {
  const out: TailscaleStatus = { installed: true, cli, running: false, state: null, dnsName: null, url: null, ips: [] };
  let j: { BackendState?: unknown; Self?: { DNSName?: unknown; TailscaleIPs?: unknown; Online?: unknown } };
  try {
    j = JSON.parse(json) as typeof j;
  } catch {
    return { ...out, error: "Tailscale's status couldn't be read." };
  }
  out.state = typeof j.BackendState === 'string' ? j.BackendState : null;
  out.running = out.state === 'Running';
  const dns = typeof j.Self?.DNSName === 'string' ? j.Self.DNSName.replace(/\.$/, '') : '';
  if (dns) {
    out.dnsName = dns;
    out.url = `https://${dns}`;
  }
  if (Array.isArray(j.Self?.TailscaleIPs)) out.ips = j.Self.TailscaleIPs.filter((x): x is string => typeof x === 'string');
  if (!out.running) out.error = out.state === 'NeedsLogin' ? 'Tailscale is installed but not signed in yet.' : out.state === 'Stopped' ? 'Tailscale is installed but switched off.' : 'Tailscale is installed but not connected.';
  return out;
}

/** Finds Tailscale and asks it how it is (a few seconds at most). */
export function tailscaleStatus(o: FindOptions & { run?: (cli: string, args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error } } = {}): TailscaleStatus {
  const cli = findTailscale(o);
  if (!cli) return { installed: false, cli: null, running: false, state: null, dnsName: null, url: null, ips: [], error: 'Tailscale is not installed on this computer.' };
  const run =
    o.run ??
    ((c: string, args: string[]) => {
      const r = spawnSync(c, args, { encoding: 'utf8', timeout: 8000, windowsHide: true });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
    });
  const r = run(cli, ['status', '--json']);
  // A stopped or signed-out Tailscale still prints its JSON (with a non-zero exit code).
  if (r.stdout.trim().startsWith('{')) return parseTailscaleStatus(r.stdout, cli);
  const why = r.error?.message ?? (r.stderr.trim().split('\n')[0] || `exit code ${r.status}`);
  return { installed: true, cli, running: false, state: null, dnsName: null, url: null, ips: [], error: `Tailscale didn't answer (${why.slice(0, 200)}). Is it running?` };
}

