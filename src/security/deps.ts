// Phase 81 (harness track M6): which packages a project uses, read from its manifests and
// lockfiles (code only, no package manager runs), and which packages an install command is about
// to add. The advisory check (src/security/advisories.ts) looks these up on OSV.dev.
//
// Readers: npm (package-lock.json v1–v3, pnpm-lock.yaml, yarn.lock v1 and Berry, exact pins in
// package.json), PyPI (requirements*.txt, poetry.lock, exact pins in pyproject.toml), crates.io
// (Cargo.lock), Go (go.sum) and RubyGems (Gemfile.lock). Every package keeps the real line it was
// read from, so an advisory finding quotes the lockfile (the "no theater" rule).

export type Ecosystem = 'npm' | 'PyPI' | 'crates.io' | 'Go' | 'RubyGems';
export const ECOSYSTEMS: readonly Ecosystem[] = ['npm', 'PyPI', 'crates.io', 'Go', 'RubyGems'];

export interface Pkg {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}
export interface FoundPkg extends Pkg {
  /** Workspace-relative manifest or lockfile. */
  file: string;
  /** 1-based line the package was read from and that line's text (the finding's quote). */
  line: number;
  quote: string;
}

/** The manifests and lockfiles the pass reads (by file name). */
export const MANIFEST = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|package\.json|requirements[\w.-]*\.txt|poetry\.lock|pyproject\.toml|Cargo\.lock|go\.sum|Gemfile\.lock)$/;
export const isManifest = (rel: string): boolean => MANIFEST.test(rel) && !/(^|\/)node_modules\//.test(rel);

const EXACT = /^\d+(\.\d+){0,3}([-+][\w.+-]+)?$/;
const lineAt = (lines: string[], i: number) => ({ line: i + 1, quote: lines[i].trim().slice(0, 300) });

function npmLock(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  let j: { packages?: Record<string, { version?: string; link?: boolean }>; dependencies?: Record<string, { version?: string; dependencies?: unknown }> };
  try {
    j = JSON.parse(text);
  } catch {
    return out;
  }
  const lines = text.split(/\r?\n/);
  const find = (needle: string, from = 0) => {
    for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i;
    return -1;
  };
  if (j.packages) {
    for (const [key, v] of Object.entries(j.packages)) {
      if (!key || v.link || !v.version || !EXACT.test(v.version)) continue;
      const name = key.replace(/^.*node_modules\//, '');
      const at = find(`"${key}": {`);
      if (at < 0) continue;
      out.push({ ecosystem: 'npm', name, version: v.version, file: rel, ...lineAt(lines, at) });
    }
  } else if (j.dependencies) {
    // v1: nested dependencies.
    const walk = (deps: Record<string, { version?: string; dependencies?: unknown }>) => {
      for (const [name, v] of Object.entries(deps)) {
        if (v.version && EXACT.test(v.version)) {
          const at = find(`"${name}": {`);
          if (at >= 0) out.push({ ecosystem: 'npm', name, version: v.version, file: rel, ...lineAt(lines, at) });
        }
        if (v.dependencies && typeof v.dependencies === 'object') walk(v.dependencies as Record<string, { version?: string }>);
      }
    };
    walk(j.dependencies);
  }
  return out;
}

function packageJson(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return out;
  }
  const lines = text.split(/\r?\n/);
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = j[k];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      const v = String(spec).replace(/^=/, '').trim();
      if (!EXACT.test(v)) continue; // ranges: the lockfile says what is really installed
      const at = lines.findIndex((l) => l.includes(`"${name}"`) && l.includes(String(spec)));
      if (at >= 0) out.push({ ecosystem: 'npm', name, version: v, file: rel, ...lineAt(lines, at) });
    }
  }
  return out;
}

function pnpmLock(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  let inPkgs = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(packages|snapshots):\s*$/.test(l)) {
      inPkgs = l.startsWith('packages');
      continue;
    }
    if (/^\S/.test(l)) inPkgs = false;
    if (!inPkgs) continue;
    // v6+: '  /name@1.2.3:' or "  '@scope/name@1.2.3':" or '  name@1.2.3:'; v5: '  /name/1.2.3:'.
    const m = /^ {2}['"]?\/?((?:@[^/@\s]+\/)?[^/@\s'"]+)[@/](\d[^:('"\s]*)(\(.*\))?['"]?:\s*$/.exec(l);
    if (m && EXACT.test(m[2])) out.push({ ecosystem: 'npm', name: m[1], version: m[2], file: rel, ...lineAt(lines, i) });
  }
  return out;
}

function yarnLock(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\S.*:\s*$/.test(l) || l.startsWith('#') || l.startsWith('__metadata')) continue;
    const first = l.replace(/:\s*$/, '').split(',')[0].trim().replace(/^"|"$/g, '');
    const at = first.lastIndexOf('@');
    if (at <= 0) continue;
    const name = first.slice(0, at);
    for (let k = i + 1; k < Math.min(lines.length, i + 8); k++) {
      const v = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(lines[k]);
      if (v) {
        if (EXACT.test(v[1])) out.push({ ecosystem: 'npm', name, version: v[1], file: rel, ...lineAt(lines, i) });
        break;
      }
      if (/^\S/.test(lines[k])) break;
    }
  }
  return out;
}

function requirements(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*===?\s*([0-9][\w.+!-]*)\s*(;.*)?(#.*)?$/.exec(lines[i]);
    if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: m[3], file: rel, ...lineAt(lines, i) });
  }
  return out;
}

/** poetry.lock / Cargo.lock: [[package]] blocks with name = "…" and version = "…". */
function tomlPackages(rel: string, text: string, ecosystem: Ecosystem): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '[[package]]') continue;
    let name = '';
    let nameAt = -1;
    let version = '';
    for (let k = i + 1; k < lines.length && !/^\[/.test(lines[k].trim()); k++) {
      const n = /^name\s*=\s*"([^"]+)"/.exec(lines[k].trim());
      const v = /^version\s*=\s*"([^"]+)"/.exec(lines[k].trim());
      if (n) {
        name = n[1];
        nameAt = k;
      }
      if (v) version = v[1];
    }
    if (name && version && nameAt >= 0) out.push({ ecosystem, name, version, file: rel, ...lineAt(lines, nameAt) });
  }
  return out;
}

function pyproject(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // PEP 621 lists ("requests==2.19.0") and Poetry tables (requests = "2.19.0").
    for (const m of lines[i].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*==\s*([0-9][\w.+!-]*)["']/g)) out.push({ ecosystem: 'PyPI', name: m[1], version: m[3], file: rel, ...lineAt(lines, i) });
    const p = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*"=?=?([0-9][\w.+!-]*)"\s*$/.exec(lines[i]);
    if (p && p[1] !== 'version' && p[1] !== 'python' && EXACT.test(p[2])) out.push({ ecosystem: 'PyPI', name: p[1], version: p[2], file: rel, ...lineAt(lines, i) });
  }
  return out;
}

function goSum(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+)\s+(v[^\s/]+?)(\/go\.mod)?\s+h1:/.exec(lines[i]);
    if (!m) continue;
    const key = `${m[1]}@${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ecosystem: 'Go', name: m[1], version: m[2].replace(/^v/, '').replace(/\+incompatible$/, ''), file: rel, ...lineAt(lines, i) });
  }
  return out;
}

function gemfileLock(rel: string, text: string): FoundPkg[] {
  const out: FoundPkg[] = [];
  const lines = text.split(/\r?\n/);
  let specs = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s{2}specs:\s*$/.test(l)) {
      specs = true;
      continue;
    }
    if (/^\S/.test(l)) specs = false;
    const m = specs ? /^ {4}([A-Za-z0-9_.-]+) \(([0-9][\w.]*)(-[\w-]+)?\)\s*$/.exec(l) : null;
    if (m) out.push({ ecosystem: 'RubyGems', name: m[1], version: m[2], file: rel, ...lineAt(lines, i) });
  }
  return out;
}

/** Every package a manifest or lockfile names with an exact version. */
export function readManifest(rel: string, text: string): FoundPkg[] {
  const base = rel.split('/').pop() ?? rel;
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return npmLock(rel, text);
  if (base === 'package.json') return packageJson(rel, text);
  if (base === 'pnpm-lock.yaml') return pnpmLock(rel, text);
  if (base === 'yarn.lock') return yarnLock(rel, text);
  if (/^requirements[\w.-]*\.txt$/.test(base)) return requirements(rel, text);
  if (base === 'poetry.lock') return tomlPackages(rel, text, 'PyPI');
  if (base === 'pyproject.toml') return pyproject(rel, text);
  if (base === 'Cargo.lock') return tomlPackages(rel, text, 'crates.io');
  if (base === 'go.sum') return goSum(rel, text);
  if (base === 'Gemfile.lock') return gemfileLock(rel, text);
  return [];
}

/** One entry per package + version (the first place it was read from). */
export function uniquePkgs<T extends Pkg>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = pkgKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
export const pkgKey = (p: Pkg): string => `${p.ecosystem}|${p.name.toLowerCase()}|${p.version}`;

// ------------------------------------------------------------------------------------------------
// Install commands (the install-time check)
// ------------------------------------------------------------------------------------------------

/**
 * The packages an install command names WITH an exact version (npm/pnpm/yarn/bun add or install,
 * pip/uv pip install, poetry add, cargo add/install, go get / go install, gem install). A bare
 * name has no version to look up until it is resolved, so it isn't checked here (the post-turn
 * pass reads the lockfile it produces).
 */
export function installTargets(command: string): Pkg[] {
  const out: Pkg[] = [];
  // Each part of a command line (a && b ; c | d).
  for (const seg of command.split(/&&|\|\||;|\|/)) {
    const words = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''));
    let i = 0;
    while (i < words.length && (/^\w+=/.test(words[i]) || words[i] === 'sudo' || words[i] === 'npx' || words[i] === 'command')) i++;
    const prog = (words[i] ?? '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/i, '');
    let sub = words[i + 1] ?? '';
    let rest = words.slice(i + 2);
    const args = () => rest.filter((w) => !w.startsWith('-'));
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog) && /^(install|i|add)$/.test(sub)) {
      for (const a of args()) {
        const m = /^((?:@[^/@\s]+\/)?[^@\s/][^@\s]*)@(=?\d[\w.+-]*)$/.exec(a);
        if (m && EXACT.test(m[2].replace(/^=/, ''))) out.push({ ecosystem: 'npm', name: m[1], version: m[2].replace(/^=/, '') });
      }
    } else if (['pip', 'pip3', 'uv', 'python', 'python3', 'py'].includes(prog)) {
      if (prog === 'uv' && sub === 'pip') {
        sub = rest[0] ?? '';
        rest = rest.slice(1);
      }
      if (/^python3?$|^py$/.test(prog) && sub === '-m' && /^pip3?$/.test(rest[0] ?? '')) {
        sub = rest[1] ?? '';
        rest = rest.slice(2);
      }
      if (sub === 'install' || (prog === 'uv' && sub === 'add')) {
        for (const a of args()) {
          const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?===?([0-9][\w.+!-]*)$/.exec(a);
          if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: m[3] });
        }
      }
    } else if (prog === 'poetry' && sub === 'add') {
      for (const a of args()) {
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:@|==)=?([0-9][\w.+!-]*)$/.exec(a);
        if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: m[2] });
      }
    } else if (prog === 'cargo' && (sub === 'add' || sub === 'install')) {
      const vi = rest.indexOf('--version');
      const pinned = vi >= 0 ? rest[vi + 1] : undefined;
      for (const a of args()) {
        if (a === pinned) continue;
        const m = /^([A-Za-z0-9_-]+)@=?([0-9][\w.+-]*)$/.exec(a);
        if (m) out.push({ ecosystem: 'crates.io', name: m[1], version: m[2] });
        else if (pinned && /^[A-Za-z0-9_-]+$/.test(a)) out.push({ ecosystem: 'crates.io', name: a, version: pinned.replace(/^=/, '') });
      }
    } else if (prog === 'go' && (sub === 'get' || sub === 'install')) {
      for (const a of args()) {
        const m = /^([\w.-]+\.[\w.-]+\/[^@\s]+)@v([0-9][\w.+-]*)$/.exec(a);
        if (m) out.push({ ecosystem: 'Go', name: m[1], version: m[2].replace(/\+incompatible$/, '') });
      }
    } else if (prog === 'gem' && sub === 'install') {
      const vi = rest.findIndex((w) => w === '-v' || w === '--version');
      const pinned = vi >= 0 ? rest[vi + 1] : undefined;
      for (const a of args()) {
        if (a === pinned) continue;
        const m = /^([A-Za-z0-9_.-]+):([0-9][\w.]*)$/.exec(a);
        if (m) out.push({ ecosystem: 'RubyGems', name: m[1], version: m[2] });
        else if (pinned && /^[A-Za-z0-9_.-]+$/.test(a)) out.push({ ecosystem: 'RubyGems', name: a, version: pinned });
      }
    }
  }
  return uniquePkgs(out);
}

/** Is this an install command at all (pinned or not)? */
export function isInstallCommand(command: string): boolean {
  return /(^|[;&|]\s*|\s)(npm|pnpm|yarn|bun)\s+(install|i|add)\b|(^|[;&|]\s*|\s)(pip3?|uv\s+pip|python3?\s+-m\s+pip)\s+install\b|(^|[;&|]\s*|\s)(poetry|uv)\s+add\b|(^|[;&|]\s*|\s)cargo\s+(add|install)\b|(^|[;&|]\s*|\s)go\s+(get|install)\b|(^|[;&|]\s*|\s)gem\s+install\b/.test(` ${command}`);
}
