// Phase 57: fills the version and checksums into the store packaging (Homebrew cask, winget
// manifests) and the image tag/version into the self-hosting app templates (CasaOS, Umbrel,
// TrueNAS) and the Proxmox script (its release tag and get-sara.sh checksum), from a release folder
// made by scripts/release-assets.sh. Publishes nothing.
//   node scripts/update-packaging.ts [version] [--sums outputs/release/<v>/SHA256SUMS]
//        [--image-digest sha256:<64 hex>] [--date YYYY-MM-DD] [--check]
// It rewrites the files under packaging/ in place and also copies the submission-ready files to
// outputs/release/<v>/homebrew/sara.rb and outputs/release/<v>/winget/manifests/b/BackstageCoding/Sara/<v>/.
// --check only reports what would change; without a release folder (no SHA256SUMS yet) it checks
// the version drift of the files that need no checksum and says which ones it skipped. A missing
// installer checksum is an error when writing (the cask and winget manifests must never ship a
// placeholder).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const IMAGE = 'ghcr.io/farena-ai/sara';
export const PORT = 7860;
export const WINGET_ID = 'BackstageCoding.Sara';
/** The packaging files, by role (paths relative to the repository). */
export const FILES = {
  cask: 'packaging/homebrew/sara.rb',
  wingetVersion: `packaging/winget/manifest/${WINGET_ID}.yaml`,
  wingetInstaller: `packaging/winget/manifest/${WINGET_ID}.installer.yaml`,
  wingetLocale: `packaging/winget/manifest/${WINGET_ID}.locale.en-US.yaml`,
  casaos: 'packaging/casaos/docker-compose.yml',
  umbrelApp: 'packaging/umbrel/umbrel-app.yml',
  umbrelCompose: 'packaging/umbrel/docker-compose.yml',
  truenas: 'packaging/truenas/docker-compose.yml',
  proxmox: 'packaging/proxmox/sara.sh',
} as const;
/** Roles whose fill needs the release's installer checksums. */
export const CHECKSUM_ROLES: Role[] = ['cask', 'wingetVersion', 'wingetInstaller', 'wingetLocale'];
export type Role = keyof typeof FILES;

export const dmgName = (v: string) => `Sara-${v}.dmg`;
export const exeName = (v: string) => `Sara-Setup-${v}.exe`;

/** Reads a SHA256SUMS file (`<hex>  <name>` or `<hex> *<name>` lines) into name → lowercase hex. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m) out.set(m[2].trim(), m[1].toLowerCase());
  }
  return out;
}

export interface FillOptions {
  version: string;
  sums: Map<string, string>;
  /** Release date for winget (YYYY-MM-DD) and CasaOS update_at. */
  date: string;
  /** The pushed multi-arch image's digest, pinned into the Umbrel compose (Umbrel requires it). */
  imageDigest?: string;
}

/** Replaces exactly one match of re, or throws (so a changed template can't be silently skipped). */
function replaceOne(text: string, re: RegExp, by: string, what: string): string {
  const n = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].length;
  if (n !== 1) throw new Error(`${what}: expected one match of ${re}, found ${n}.`);
  return text.replace(re, by);
}

const imageRe = /(image: ghcr\.io\/farena-ai\/sara):[^\s@"']+(@sha256:[0-9a-f]{64})?/;

function checkOptions(o: { version: string; date: string; imageDigest?: string }): void {
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(o.version)) throw new Error(`Not a version: ${o.version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error(`Not a date: ${o.date}`);
  if (o.imageDigest && !/^sha256:[0-9a-f]{64}$/.test(o.imageDigest)) throw new Error(`Not an image digest: ${o.imageDigest}`);
}

/**
 * Fills the version into the files that need no installer checksum: the app templates (image tag,
 * version) and the Proxmox script (release tag, and get-sara.sh's checksum when SHA256SUMS has it;
 * otherwise it is emptied, so an old checksum never checks a new file). Pure.
 */
export function fillTemplates(texts: Record<Role, string>, o: { version: string; date: string; imageDigest?: string; sums?: Map<string, string> }): Record<Role, string> {
  checkOptions(o);
  const v = o.version;
  const out = { ...texts };
  let ca = out.casaos;
  ca = replaceOne(ca, imageRe, `$1:${v}`, FILES.casaos);
  ca = replaceOne(ca, /^(\s*version: )"[^"]*"/m, `$1"${v}"`, FILES.casaos);
  ca = replaceOne(ca, /^(\s*update_at: )"[^"]*"/m, `$1"${o.date}"`, FILES.casaos);
  out.casaos = ca;

  out.umbrelApp = replaceOne(out.umbrelApp, /^version: "[^"]*"/m, `version: "${v}"`, FILES.umbrelApp);
  // A digest belongs to one image: a new version drops the old one unless a new one is given.
  out.umbrelCompose = replaceOne(out.umbrelCompose, imageRe, `$1:${v}${o.imageDigest ? `@${o.imageDigest}` : ''}`, FILES.umbrelCompose);
  out.truenas = replaceOne(out.truenas, imageRe, `$1:${v}`, FILES.truenas);
  let px = out.proxmox;
  px = replaceOne(px, /^SARA_VERSION="[^"]*"$/m, `SARA_VERSION="${v}"`, FILES.proxmox);
  px = replaceOne(px, /^GET_SARA_SHA256="[^"]*"$/m, `GET_SARA_SHA256="${o.sums?.get('get-sara.sh') ?? ''}"`, FILES.proxmox);
  out.proxmox = px;
  return out;
}

/** Fills one release into the packaging texts (pure: texts in, texts out). */
export function fillPackaging(texts: Record<Role, string>, o: FillOptions): Record<Role, string> {
  checkOptions(o);
  const v = o.version;
  const dmg = o.sums.get(dmgName(v));
  const exe = o.sums.get(exeName(v));
  if (!dmg) throw new Error(`No checksum for ${dmgName(v)} in SHA256SUMS.`);
  if (!exe) throw new Error(`No checksum for ${exeName(v)} in SHA256SUMS.`);
  const out = fillTemplates(texts, o);

  let c = out.cask;
  c = replaceOne(c, /^(\s*version )"[^"]*"/m, `$1"${v}"`, FILES.cask);
  c = replaceOne(c, /^(\s*sha256 )"[^"]*"/m, `$1"${dmg}"`, FILES.cask);
  out.cask = c;

  for (const r of ['wingetVersion', 'wingetInstaller', 'wingetLocale'] as const) {
    out[r] = replaceOne(out[r], /^PackageVersion: .*$/m, `PackageVersion: ${v}`, FILES[r]);
  }
  let wi = out.wingetInstaller;
  wi = replaceOne(wi, /^(\s*InstallerUrl: ).*$/m, `$1https://github.com/farena-ai/sara/releases/download/v${v}/${exeName(v)}`, FILES.wingetInstaller);
  wi = replaceOne(wi, /^(\s*InstallerSha256: ).*$/m, `$1${exe.toUpperCase()}`, FILES.wingetInstaller);
  wi = replaceOne(wi, /^ReleaseDate: .*$/m, `ReleaseDate: ${o.date}`, FILES.wingetInstaller);
  out.wingetInstaller = wi;
  out.wingetLocale = replaceOne(out.wingetLocale, /^ReleaseNotesUrl: .*$/m, `ReleaseNotesUrl: https://github.com/farena-ai/sara/releases/tag/v${v}`, FILES.wingetLocale);
  return out;
}

// ---- A small YAML reader (the subset these manifests use; Sara has no runtime packages) --------

const stripComment = (s: string): string => {
  let q: string | null = null;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
  }
  return s.trimEnd();
};

const ENTRY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'{[#-][^:]*?|-[^\s:][^:]*?):(?:\s+(.*))?$/;

function splitFlow(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function scalar(s: string): unknown {
  const t = s.trim();
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new Error(`Unclosed flow sequence: ${t}`);
    return splitFlow(t.slice(1, -1)).map(scalar);
  }
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new Error(`Unclosed flow mapping: ${t}`);
    const o: Record<string, unknown> = {};
    for (const p of splitFlow(t.slice(1, -1))) {
      const m = ENTRY.exec(p);
      if (!m) throw new Error(`Bad flow mapping entry: ${p}`);
      o[unquote(m[1])] = m[2] === undefined ? null : scalar(m[2]);
    }
    return o;
  }
  if (t.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(t)) throw new Error(`Bad double-quoted string: ${t}`);
    return JSON.parse(t);
  }
  if (t.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(t)) throw new Error(`Bad single-quoted string: ${t}`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[&*!|>]/.test(t) && !/^[|>][-+]?$/.test(t)) throw new Error(`Unsupported YAML: ${t}`);
  return t;
}

const unquote = (k: string): string => (k.startsWith('"') || k.startsWith("'") ? String(scalar(k)) : k);

/** Parses the YAML subset used by Sara's packaging (block maps and lists, flow lists and maps,
 * quoted strings, folded/literal block text). Throws on anything it doesn't understand. */
export function parseYaml(src: string): unknown {
  if (/^ *\t/m.test(src)) throw new Error('Tabs are not allowed in YAML indentation.');
  const lines = src.replace(/\r/g, '').split('\n');
  let i = 0;
  const peek = (): { indent: number; text: string } | null => {
    while (i < lines.length) {
      const t = stripComment(lines[i]);
      if (t.trim() === '' || t.trim() === '---') {
        i++;
        continue;
      }
      return { indent: t.length - t.trimStart().length, text: t.trim() };
    }
    return null;
  };
  const isItem = (t: string) => t === '-' || t.startsWith('- ');

  function block(indent: number): unknown {
    const l = peek();
    if (!l || l.indent < indent) return null;
    return isItem(l.text) ? seq(l.indent) : map(l.indent, {});
  }
  function blockText(parent: number, style: string): string {
    const raw: string[] = [];
    let ind = -1;
    while (i < lines.length) {
      const s = lines[i];
      if (s.trim() === '') {
        raw.push('');
        i++;
        continue;
      }
      const n = s.length - s.trimStart().length;
      if (n <= parent) break;
      if (ind < 0) ind = n;
      raw.push(s.slice(Math.min(ind, n)));
      i++;
    }
    while (raw.length && raw[raw.length - 1] === '') raw.pop();
    if (style.startsWith('|')) return raw.join('\n');
    let out = '';
    for (const r of raw) out += r === '' ? '\n' : out && !out.endsWith('\n') ? ` ${r}` : r;
    return out;
  }
  function value(rest: string | undefined, indent: number): unknown {
    if (rest === undefined || rest === '') {
      const c = peek();
      if (c && (c.indent > indent || (c.indent === indent && isItem(c.text)))) return block(c.indent);
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return blockText(indent, rest);
    return scalar(rest);
  }
  function entry(text: string, indent: number, obj: Record<string, unknown>): void {
    const m = ENTRY.exec(text);
    if (!m) throw new Error(`Line ${i + 1}: not a "key: value" line: ${text}`);
    const key = unquote(m[1]);
    if (key in obj) throw new Error(`Line ${i + 1}: duplicate key ${key}`);
    i++;
    obj[key] = value(m[2], indent);
  }
  function map(indent: number, obj: Record<string, unknown>): Record<string, unknown> {
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent || (l.indent === indent && isItem(l.text))) return obj;
      if (l.indent > indent) throw new Error(`Line ${i + 1}: unexpected indentation`);
      entry(l.text, indent, obj);
    }
  }
  function seq(indent: number): unknown[] {
    const out: unknown[] = [];
    for (;;) {
      const l = peek();
      if (!l || l.indent !== indent || !isItem(l.text)) return out;
      const rest = l.text.slice(1).trim();
      if (rest === '') {
        i++;
        out.push(block(indent + 1));
      } else if (ENTRY.test(rest)) {
        const obj: Record<string, unknown> = {};
        entry(rest, indent + 2, obj);
        out.push(map(indent + 2, obj));
      } else {
        i++;
        out.push(scalar(rest));
      }
    }
  }
  const doc = block(0);
  const left = peek();
  if (left) throw new Error(`Line ${i + 1}: unexpected content: ${left.text}`);
  return doc;
}

// ---- CLI -----------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: { sums: { type: 'string' }, 'image-digest': { type: 'string' }, date: { type: 'string' }, check: { type: 'boolean', default: false } },
  });
  const version = positionals[0] ?? (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const sumsPath = resolve(ROOT, opt.sums ?? join('outputs', 'release', version, 'SHA256SUMS'));
  const texts = Object.fromEntries(Object.entries(FILES).map(([r, p]) => [r, readFileSync(join(ROOT, p), 'utf8')])) as Record<Role, string>;
  const date = opt.date ?? new Date().toISOString().slice(0, 10);
  if (!existsSync(sumsPath)) {
    if (!opt.check) {
      console.error(`No ${sumsPath}. Make the release folder first: bash scripts/release-assets.sh ${version}`);
      process.exit(1);
    }
    // Drift check before a release: the files that need no checksum, compared on version only.
    const filled = fillTemplates(texts, { version, date, imageDigest: opt['image-digest'] });
    const versionOnly = (r: Role, t: string) => (r === 'casaos' ? t.replace(/^(\s*update_at: )"[^"]*"/m, '$1""') : r === 'proxmox' ? t.replace(/^GET_SARA_SHA256="[^"]*"$/m, 'GET_SARA_SHA256=""') : t);
    let drift = 0;
    for (const r of Object.keys(FILES) as Role[]) {
      if (CHECKSUM_ROLES.includes(r)) {
        console.log(`skipped       ${FILES[r]} (needs the release's SHA256SUMS)`);
        continue;
      }
      const changed = versionOnly(r, filled[r]) !== versionOnly(r, texts[r]);
      if (changed) drift++;
      console.log(`${changed ? `not ${version}` : 'up to date'}  ${FILES[r]}`);
    }
    console.log(`\nNo ${sumsPath.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '')}: ${drift ? `${drift} file(s) are behind ${version}; they are set at release.` : `everything that needs no checksum is at ${version}.`}`);
    process.exit(0);
  }
  const filled = fillPackaging(texts, { version, sums: parseSums(readFileSync(sumsPath, 'utf8')), date, imageDigest: opt['image-digest'] });
  for (const r of Object.keys(FILES) as Role[]) {
    if (FILES[r].endsWith('.yaml') || FILES[r].endsWith('.yml')) parseYaml(filled[r]);
    const changed = filled[r] !== texts[r];
    console.log(`${changed ? (opt.check ? 'would update' : 'updated') : 'unchanged'}  ${FILES[r]}`);
    if (changed && !opt.check) writeFileSync(join(ROOT, FILES[r]), filled[r]);
  }
  if (!opt.check) {
    const rel = join(ROOT, 'outputs', 'release', version);
    mkdirSync(join(rel, 'homebrew'), { recursive: true });
    writeFileSync(join(rel, 'homebrew', 'sara.rb'), filled.cask);
    const wdir = join(rel, 'winget', 'manifests', 'b', 'BackstageCoding', 'Sara', version);
    mkdirSync(wdir, { recursive: true });
    for (const r of ['wingetVersion', 'wingetInstaller', 'wingetLocale'] as const) writeFileSync(join(wdir, FILES[r].split('/').pop()!), filled[r]);
    console.log(`\nSubmission copies: outputs/release/${version}/homebrew/sara.rb and outputs/release/${version}/winget/manifests/b/BackstageCoding/Sara/${version}/`);
    console.log(`Check the winget manifests on Windows: winget validate --manifest outputs/release/${version}/winget/manifests/b/BackstageCoding/Sara/${version}`);
    if (!opt['image-digest']) console.log('No --image-digest: the Umbrel compose has the tag only (Umbrel wants @sha256:<digest> pinned before submitting).');
  }
}
