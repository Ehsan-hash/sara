// Phase 82 (harness track M7, docs/design/HARNESS_TRACK.md §3 M7): the threat pass's small code map
// of a project's reachable surface, and the deterministic threat rules over it. No model, no
// network, nothing runs: it reads files.
//
// Built on the code map's own reader (src/codemap/extract.ts: functions with their body ranges and
// each file's imports; `scan` blanks strings and comments so a "(" in a string doesn't count):
//   1. ENTRY POINTS, found by code: HTTP routes (Express / Koa / Fastify / node:http, Flask,
//      FastAPI, Django views, Go net/http, gin, chi), file uploads, message handlers (WebSocket,
//      worker and window messages, Socket.IO) and the command line (argv). Environment reads are
//      listed as a surface but are the operator's input, so they make no threats.
//   2. SINKS: shell, SQL, file paths, outgoing requests (SSRF), unsafe deserialization, HTML out,
//      redirects, eval, secrets in responses.
//   3. A bounded walk (MAX_HOPS calls) from each entry: request values are followed through
//      assignments and into project functions (argument -> parameter), across files, and a sink
//      reached by such a value without a recognisable guard is a threat: placeholders for SQL, a
//      basename or a resolve + root check for paths, an allowlist / validation test, a fixed host
//      for URLs, escaping for HTML, a local path for redirects. Two rules need no value at all:
//      a route without any sign-in check that reaches a state-changing sink (auth gap) and a login
//      route without a rate limit.
// Every threat quotes its entry line and its sink line (real text: the "no theater" rule is checked
// again by src/security/threats.ts before anything is stored) and names the path entry -> sink.
// It is a shape-and-name follower, not a compiler: it misses what it can't see (callbacks passed
// around, values through objects and return values in another function) and says so in the docs.
import { extract, langOf as mapLang, scan } from '../codemap/extract.ts';
import { AUTH_WORD, PUBLIC_PATH } from './rules.ts';
import type { FindingSeverity } from './findings.ts';

export type EntryKind = 'http' | 'upload' | 'message' | 'cli' | 'env';
export type SinkKind = 'shell' | 'sql' | 'path' | 'ssrf' | 'deserialize' | 'html' | 'redirect' | 'eval' | 'secret';
export type ThreatKind = SinkKind | 'auth' | 'ratelimit';
export const SINK_KINDS: readonly SinkKind[] = ['shell', 'sql', 'path', 'ssrf', 'deserialize', 'html', 'redirect', 'eval', 'secret'];
export const THREAT_KINDS: readonly ThreatKind[] = [...SINK_KINDS, 'auth', 'ratelimit'];
/** At most this many calls deep from an entry point (the walk is bounded). */
export const MAX_HOPS = 4;
const MAX_FILES = 400;
const MAX_BYTES = 512 * 1024;
/** Lines one entry's walk may visit (big projects stay quick). */
const MAX_VISIT = 4000;

export type Stride = 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information disclosure' | 'Denial of service' | 'Elevation of privilege';

export interface ThreatRule {
  kind: ThreatKind;
  severity: FindingSeverity;
  category: Stride;
  title: string;
  advice: string;
}

/** What each threat rule means, in plain words (the Findings view, the docs, the fix prompt). */
export const THREAT_RULES: Record<ThreatKind, ThreatRule> = {
  shell: { kind: 'shell', severity: 'high', category: 'Elevation of privilege', title: 'Outside input reaches a shell command', advice: 'Run a fixed program with an argument list (execFile / spawn without a shell / subprocess with a list) and check the value against what is allowed first.' },
  sql: { kind: 'sql', severity: 'high', category: 'Tampering', title: 'Outside input reaches an SQL query', advice: 'Pass the value as a parameter (? / $1 / %s with the values separately) instead of putting it into the query text.' },
  path: { kind: 'path', severity: 'high', category: 'Information disclosure', title: 'Outside input chooses a file path', advice: 'Keep only the file name (basename), or resolve the path inside the allowed folder and refuse it unless the result still starts with that folder.' },
  ssrf: { kind: 'ssrf', severity: 'high', category: 'Information disclosure', title: 'Outside input chooses where the server connects', advice: 'Use a fixed host, or check the URL\'s host against an allowlist before the request; never let input pick the address.' },
  deserialize: { kind: 'deserialize', severity: 'high', category: 'Elevation of privilege', title: 'Outside input is loaded with an unsafe loader', advice: 'Load outside data as JSON or with a safe loader (yaml.safe_load); pickle, marshal and unserialize can run code from the data.' },
  html: { kind: 'html', severity: 'medium', category: 'Tampering', title: 'Outside input is written into HTML', advice: 'Escape the value (or set textContent) before it goes into the page, or send it as JSON.' },
  redirect: { kind: 'redirect', severity: 'medium', category: 'Spoofing', title: 'Outside input chooses where a redirect goes', advice: 'Redirect only to local paths (starting with one "/" and not "//") or to an allowlist of addresses.' },
  eval: { kind: 'eval', severity: 'high', category: 'Elevation of privilege', title: 'Outside input is run as code', advice: 'Never run outside input as code; parse the data (JSON.parse, a small parser) or map it to fixed actions.' },
  secret: { kind: 'secret', severity: 'high', category: 'Information disclosure', title: 'A secret is sent back to the caller', advice: 'Send only the fields the caller needs; keep environment variables, keys and passwords on the server.' },
  auth: { kind: 'auth', severity: 'high', category: 'Elevation of privilege', title: 'Anyone can reach a change without signing in', advice: 'Add the sign-in check (the middleware or decorator the project uses) to this route, or check the user inside the handler before the change.' },
  ratelimit: { kind: 'ratelimit', severity: 'medium', category: 'Spoofing', title: 'A sign-in route with no rate limit', advice: 'Limit attempts per address and account (express-rate-limit, Flask-Limiter, slowapi, a counter with a lockout) so passwords can\'t be guessed quickly.' },
};

type Lang = 'js' | 'py' | 'go';

interface Fn {
  name: string;
  start: number; // 0-based
  end: number; // 0-based, inclusive
  params: string[][];
}

interface FileInfo {
  rel: string;
  lang: Lang;
  raw: string[];
  clean: string[];
  fns: Fn[];
  /** Project files this one imports (and, for Go, the other files of its package). */
  deps: string[];
  /** Imported bindings → project file (JS `const files = require('./files')`). */
  bindings: Map<string, string>;
  test: boolean;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  file: string;
  /** 1-based line of the route / handler registration. */
  line: number;
  quote: string;
  label: string;
  method?: string;
  path?: string;
  authed: boolean;
  limited: boolean;
  upload: boolean;
}

export interface Step {
  file: string;
  line: number;
  /** What happens here: the entry label, the function called, the sink. */
  label: string;
}

export interface Hit {
  kind: ThreatKind;
  entry: Entry;
  sink: { file: string; line: number; quote: string; kind: ThreatKind };
  path: Step[];
  hops: number;
}

export interface SinkSite {
  kind: SinkKind;
  file: string;
  line: number;
  /** Reached by outside input but guarded (shown in the summary, not a threat). */
  guarded: boolean;
}

export interface Analysis {
  files: number;
  entries: Entry[];
  hits: Hit[];
  /** Sinks the walk reached (guarded or not). */
  sinks: SinkSite[];
  /** Every sink site in the project (reached or not), per kind. */
  sinkCounts: Record<SinkKind, number>;
  envReads: { file: string; line: number }[];
  truncated: boolean;
}

// ---- reading files ----------------------------------------------------------------------------------

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec|e2e|fixtures?)\/|\.(test|spec)\.\w+$|(^|\/)test_[\w-]+\.py$|_test\.(go|py)$/;
const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.git|__pycache__|\.venv|venv|target|coverage)\//;

function langFor(rel: string): Lang | undefined {
  if (SKIP.test(rel) || /\.min\.js$|\.d\.ts$/.test(rel)) return undefined;
  const l = mapLang(rel);
  if (l === 'typescript' || l === 'javascript') return 'js';
  if (l === 'python') return 'py';
  if (l === 'go') return 'go';
  return undefined;
}

/** Python lines with string contents blanked and comments removed (lengths kept). */
function cleanPy(lines: string[]): string[] {
  const out: string[] = [];
  let triple: string | null = null;
  for (const s of lines) {
    let o = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (triple) {
        if (s.startsWith(triple, i)) {
          o += triple;
          i += 2;
          triple = null;
        } else o += ' ';
        continue;
      }
      if (ch === '#') break;
      if ((ch === '"' || ch === "'") && s.startsWith(ch.repeat(3), i)) {
        triple = ch.repeat(3);
        o += triple;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < s.length && s[j] !== ch) j += s[j] === '\\' ? 2 : 1;
        o += ch + ' '.repeat(Math.max(0, Math.min(j, s.length) - i - 1)) + (j < s.length ? ch : '');
        i = j;
        continue;
      }
      o += ch;
    }
    out.push(o);
  }
  return out;
}

/** Parameter names of a declaration line, by position (destructured ones grouped). */
function paramsOf(sig: string, lang: Lang, name: string): string[][] {
  let s = sig;
  if (lang === 'go') s = s.replace(/^\s*func\s*(\([^)]*\)\s*)?/, '');
  const at = name ? s.indexOf(`${name}`) : -1;
  let open = s.indexOf('(', at >= 0 ? at : 0);
  // `const f = async x => …` (one bare parameter)
  const bare = /=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(s);
  if (bare && (open < 0 || bare.index < open)) return [[bare[1]]];
  if (open < 0) return [];
  let depth = 0;
  let close = -1;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  const inner = s.slice(open + 1, close < 0 ? s.length : close);
  const parts = splitTop(inner);
  const out: string[][] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (/^[{[]/.test(t)) {
      out.push([...t.replace(/[=:][^,}\]]*/g, '').matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]));
      continue;
    }
    const id = /^(?:\.\.\.|\*{1,2})?([A-Za-z_$][\w$]*)/.exec(t)?.[1];
    if (!id) continue;
    if (lang === 'py' && (id === 'self' || id === 'cls')) continue;
    out.push([id]);
  }
  // Go: `a, b string` → each name its own position.
  return out;
}

/** Splits an argument list at top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** From `(` at clean[li][col]: the call's arguments (raw text, joined over lines) and the end line. */
function callArgs(f: FileInfo, li: number, col: number, maxLines = 400): { raw: string; clean: string; endLine: number } {
  let depth = 0;
  let raw = '';
  let clean = '';
  for (let l = li; l < Math.min(f.clean.length, li + maxLines); l++) {
    const c = f.clean[l];
    const r = f.raw[l];
    for (let i = l === li ? col : 0; i < c.length; i++) {
      const ch = c[i];
      if (ch === '(') {
        depth++;
        if (depth === 1) continue;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) return { raw, clean, endLine: l };
      }
      raw += r[i] ?? '';
      clean += ch;
    }
    raw += '\n';
    clean += '\n';
  }
  return { raw, clean, endLine: Math.min(f.clean.length - 1, li + maxLines - 1) };
}

/** Splits raw args at the top-level commas found in the clean copy (same positions). */
function argsSplit(a: { raw: string; clean: string }): { raw: string; clean: string }[] {
  const out: { raw: string; clean: string }[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < a.clean.length; i++) {
    const ch = a.clean[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push({ raw: a.raw.slice(from, i), clean: a.clean.slice(from, i) });
      from = i + 1;
    }
  }
  out.push({ raw: a.raw.slice(from), clean: a.clean.slice(from) });
  return out.filter((x) => x.clean.trim() || x.raw.trim());
}

/** Interpolated code inside strings (JS `${…}`, Python f-strings), which blanked strings hide. */
function interps(raw: string): string {
  const out: string[] = [];
  for (const m of raw.matchAll(/\$\{([^}]*)\}/g)) out.push(m[1]);
  for (const m of raw.matchAll(/\b[fF][rR]?(["'])(.*?)\1/g)) for (const x of m[2].matchAll(/\{([^}]*)\}/g)) out.push(x[1]);
  return out.join(' ');
}
const codeOf = (x: { raw: string; clean: string }) => `${x.clean} ${interps(x.raw)}`;

function resolveImport(from: string, spec: string, lang: Lang, have: Set<string>, goModule?: string): string[] {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const norm = (p: string) => {
    const parts: string[] = [];
    for (const x of p.split('/')) {
      if (!x || x === '.') continue;
      if (x === '..') parts.pop();
      else parts.push(x);
    }
    return parts.join('/');
  };
  if (lang === 'js') {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return [];
    const base = norm(`${dir}/${spec}`);
    const cands = [base, base.replace(/\.(m|c)?js$/, '.ts'), `${base}.js`, `${base}.ts`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`, `${base}.tsx`, `${base}/index.js`, `${base}/index.ts`];
    const hit = cands.find((c) => have.has(c));
    return hit ? [hit] : [];
  }
  if (lang === 'py') {
    const dots = /^\.*/.exec(spec)![0].length;
    const mod = spec.slice(dots).replace(/\./g, '/');
    const roots = dots ? [norm(dir.split('/').slice(0, Math.max(0, dir.split('/').filter(Boolean).length - (dots - 1))).join('/'))] : ['', dir, 'src', 'app'];
    for (const r of roots) {
      const base = norm(`${r}/${mod}`);
      for (const c of [`${base}.py`, `${base}/__init__.py`]) if (have.has(c)) return [c];
    }
    return [];
  }
  if (lang === 'go' && goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) {
    const d = spec.slice(goModule.length + 1);
    return [...have].filter((f) => f.endsWith('.go') && (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '') === d);
  }
  return [];
}

function load(list: string[], read: (rel: string) => string | undefined): { files: Map<string, FileInfo>; truncated: boolean } {
  const files = new Map<string, FileInfo>();
  const code = list.filter((f) => langFor(f));
  const truncated = code.length > MAX_FILES;
  for (const rel of code.slice(0, MAX_FILES)) {
    const text = read(rel);
    if (text === undefined || text.length > MAX_BYTES || text.includes('\u0000')) continue;
    const lang = langFor(rel)!;
    const raw = text.split(/\r?\n/);
    const clean = lang === 'py' ? cleanPy(raw) : scan(raw, lang === 'js' ? { backtick: true, regex: true } : { charQuote: true, backtick: true }).clean;
    const ex = extract(lang === 'js' ? (/\.tsx?$|\.mts$|\.cts$/.test(rel) ? 'typescript' : 'javascript') : lang === 'py' ? 'python' : 'go', text);
    const fns: Fn[] = ex.symbols
      .filter((s) => s.kind === 'function' || s.kind === 'method')
      .map((s) => ({ name: s.name, start: s.line - 1, end: Math.max(s.line - 1, s.end - 1), params: paramsOf(raw[s.line - 1] ?? s.signature, lang, s.name) }));
    files.set(rel, { rel, lang, raw, clean, fns, deps: [], bindings: new Map(), test: TEST_FILE.test(rel) });
    (files.get(rel) as FileInfo & { imports?: typeof ex.imports }).imports = ex.imports;
  }
  const have = new Set(files.keys());
  const goMod = /^module\s+(\S+)/m.exec(read('go.mod') ?? '')?.[1];
  for (const f of files.values()) {
    const imps = (f as FileInfo & { imports?: { spec: string; line: number; names?: string }[] }).imports ?? [];
    const deps = new Set<string>();
    for (const imp of imps) {
      let targets = resolveImport(f.rel, imp.spec, f.lang, have, goMod);
      // Python `from . import store` / `from pkg import mod`: the names may be modules.
      if (f.lang === 'py' && imp.names) {
        for (const n of imp.names.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          const sub = resolveImport(f.rel, `${imp.spec}${imp.spec.endsWith('.') ? '' : '.'}${n}`, 'py', have);
          if (sub.length) {
            targets = [...targets, ...sub];
            f.bindings.set(n, sub[0]);
          }
        }
      }
      for (const t of targets) deps.add(t);
      if (f.lang === 'js' && targets.length) {
        // `const files = require('./files')` / `import * as files from` / `import files from`
        const line = f.raw[imp.line - 1] ?? '';
        const b = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/.exec(line)?.[1] ?? /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from/.exec(line)?.[1];
        if (b) f.bindings.set(b, targets[0]);
      }
      if (f.lang === 'py' && targets.length && !imp.names) f.bindings.set(imp.spec.split('.').pop()!, targets[0]);
      if (f.lang === 'go' && targets.length) f.bindings.set(imp.spec.split('/').pop()!, targets[0]);
    }
    if (f.lang === 'go') {
      const d = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
      for (const o of files.values()) if (o !== f && o.lang === 'go' && (o.rel.includes('/') ? o.rel.slice(0, o.rel.lastIndexOf('/')) : '') === d) deps.add(o.rel);
    }
    f.deps = [...deps];
  }
  return { files, truncated };
}

// ---- entry points --------------------------------------------------------------------------------

interface EntryBody {
  entry: Entry;
  file: FileInfo;
  start: number;
  end: number;
  /** Names that ARE outside input (a FastAPI parameter, a message, argv). */
  tainted: string[];
  /** Names of request objects (their .query / .body / … are outside input). */
  reqs: string[];
  /** The handler named by reference (resolved into a function body). */
  fn?: Fn;
}

const quoteOf = (line: string) => {
  const q = line.trim();
  return q.length > 300 ? q.slice(0, 300) : q;
};

const LIMIT_WORD = /limit|throttl|slow[-_]?down|brute|rate/i;
const LOGIN_PATH = /(^|\/)(login|log-in|signin|sign-in|logon|authenticate|auth(\/(login|token|signin))?|token|session|password(\/reset)?|reset[-_]?password|forgot[-_]?password|otp|verify[-_]?(otp|code)|2fa|mfa)(\/|$|\?)/i;
const BODY_AUTH = /\b(req|request|ctx)\.(user|session\.(user|userId|uid)|auth|state\.user)\b|isAuthenticated\(|is_authenticated|current_user|jwt\.verify\(|verify\w*Token\(|check\w*Auth\w*\(|require\w*(Auth|Login|User)\w*\(|headers\.authorization|\.get\(\s*['"]authorization['"]|getCurrentUser|get_current_user|@login_required|session\[['"]user/i;

function fnAt(f: FileInfo, li: number): Fn | undefined {
  let best: Fn | undefined;
  for (const fn of f.fns) if (fn.start <= li && fn.end >= li && (!best || fn.start >= best.start)) best = fn;
  return best;
}

function findFn(files: Map<string, FileInfo>, f: FileInfo, name: string): { file: FileInfo; fn: Fn } | undefined {
  const own = f.fns.find((x) => x.name === name);
  if (own) return { file: f, fn: own };
  for (const d of f.deps) {
    const o = files.get(d);
    const fn = o?.fns.find((x) => x.name === name);
    if (o && fn) return { file: o, fn };
  }
  return undefined;
}

/** The first arrow / function in a handler text: its parameters. */
function handlerParams(text: string): string[] {
  const m = /(?:async\s+)?(?:function\s*[\w$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)/.exec(text) ?? /(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(text);
  if (!m) return [];
  return m[1].split(',').map((x) => /^[\s{]*([A-Za-z_$][\w$]*)/.exec(x)?.[1] ?? '').filter(Boolean);
}

function entriesOf(files: Map<string, FileInfo>): { bodies: EntryBody[]; envReads: { file: string; line: number }[] } {
  const bodies: EntryBody[] = [];
  const envReads: { file: string; line: number }[] = [];
  let n = 0;
  // Routers mounted behind a sign-in middleware in another file: app.use('/admin', requireAuth, adminRouter).
  const mountedAuth = new Set<string>();
  const globalLimit = [...files.values()].some((f) => f.raw.some((l) => /\.use\(/.test(l) && LIMIT_WORD.test(l)) || f.raw.some((l) => /@\w*limiter\.limit|Limiter\(|slowapi|httprate\.|tollbooth\./.test(l)));
  for (const f of files.values()) {
    for (const l of f.raw) {
      const m = /\.use\(\s*['"`][^'"`]*['"`]\s*,(.+)\)/.exec(l);
      if (!m) continue;
      const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      const last = names.at(-1)?.replace(/\(.*$/, '') ?? '';
      if (names.slice(0, -1).some((x) => AUTH_WORD.test(x)) && f.bindings.get(last)) mountedAuth.add(f.bindings.get(last)!);
    }
  }
  const push = (e: Omit<Entry, 'id'>, b: Omit<EntryBody, 'entry'>) => bodies.push({ entry: { ...e, id: `E${++n}` }, ...b });
  for (const f of files.values()) {
    if (f.test) continue;
    const { raw, clean } = f;
    let globalAuth = mountedAuth.has(f.rel) ? 0 : -1;
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const c = clean[i];
      if (!c.trim()) continue;
      if (/process\.env\b|os\.environ|os\.getenv|os\.Getenv\(/.test(r)) envReads.push({ file: f.rel, line: i + 1 });
      if (f.lang === 'js') {
        if (globalAuth < 0 && /\b(app|router|server|api|fastify)\.(use|addHook)\(/.test(c) && !/\.use\(\s*['"`]/.test(r)) {
          const name = /\.(?:use|addHook)\(\s*(?:['"`][^'"`]*['"`]\s*,\s*)?([A-Za-z_$][\w$.]*)/.exec(r)?.[1] ?? '';
          if (AUTH_WORD.test(name) && !/static|json|urlencoded|cors|helmet|morgan|logger|cookie|compression|body/i.test(name)) globalAuth = i;
        }
        const m = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|del|all|options)\(\s*(['"`])([^'"`]+)\3\s*,/.exec(r);
        if (m && /^(app|router|server|api|fastify|routes|r|v1|v2|admin|\w*[Rr]outer|\w*[Aa]pp)$/.test(m[1]) && m[4].startsWith('/')) {
          const col = c.indexOf('(', m.index + m[1].length + m[2].length);
          const a = callArgs(f, i, col);
          const args = argsSplit(a).slice(1);
          const inline = args.findIndex((x) => /=>|\bfunction\b/.test(x.clean));
          const mids = (inline >= 0 ? args.slice(0, inline) : args.slice(0, -1)).map((x) => x.raw.trim());
          const upload = mids.some((x) => /upload|multer|\.single\(|\.array\(|\.fields\(/.test(x)) || /req\.files?\b/.test(raw.slice(i, a.endLine + 1).join('\n'));
          const body = raw.slice(i, a.endLine + 1).join('\n');
          const authed = (globalAuth >= 0 && globalAuth < i) || mids.some((x) => AUTH_WORD.test(x) && !LIMIT_WORD.test(x)) || BODY_AUTH.test(body);
          const limited = globalLimit || mids.some((x) => LIMIT_WORD.test(x));
          const e = { kind: (upload ? 'upload' : 'http') as EntryKind, file: f.rel, line: i + 1, quote: quoteOf(r), label: `${m[2].toUpperCase()} ${m[4]}`, method: m[2].toLowerCase(), path: m[4], authed, limited, upload };
          if (inline >= 0) {
            const hp = handlerParams(args[inline].clean);
            push(e, { file: f, start: i, end: a.endLine, tainted: [], reqs: hp.length ? hp.slice(0, 1) : ['req', 'ctx'] });
          } else {
            const name = /([A-Za-z_$][\w$]*)\s*$/.exec(args.at(-1)?.clean.trim() ?? '')?.[1];
            const t = name ? findFn(files, f, name) : undefined;
            if (t) push({ ...e, authed: e.authed || BODY_AUTH.test(t.file.raw.slice(t.fn.start, t.fn.end + 1).join('\n')) }, { file: t.file, start: t.fn.start, end: t.fn.end, tainted: [], reqs: t.fn.params[0] ?? ['req'], fn: t.fn });
          }
          continue;
        }
        // node:http
        const hs = /\b(?:https?\.)?createServer\(/.exec(c);
        if (hs && /\b(createServer)\b/.test(c) && /require\(['"](node:)?https?['"]\)|from ['"](node:)?https?['"]/.test(raw.join('\n'))) {
          const col = c.indexOf('(', hs.index);
          const a = callArgs(f, i, col);
          const first = argsSplit(a).find((x) => /=>|\bfunction\b|^\s*[A-Za-z_$][\w$]*\s*$/.test(x.clean));
          const e = { kind: 'http' as EntryKind, file: f.rel, line: i + 1, quote: quoteOf(r), label: 'HTTP server', authed: BODY_AUTH.test(raw.slice(i, a.endLine + 1).join('\n')), limited: globalLimit, upload: false };
          if (first && /=>|\bfunction\b/.test(first.clean)) push(e, { file: f, start: i, end: a.endLine, tainted: [], reqs: handlerParams(first.clean).slice(0, 1) });
          else if (first) {
            const t = findFn(files, f, first.clean.trim());
            if (t) push(e, { file: t.file, start: t.fn.start, end: t.fn.end, tainted: [], reqs: t.fn.params[0] ?? ['req'], fn: t.fn });
          }
          continue;
        }
        // Message handlers.
        const mh = /\.(on|addEventListener)\(\s*['"](message|data)['"]\s*,/.exec(r) ?? /\bonmessage\s*=/.exec(r);
        if (mh) {
          const col = c.indexOf('(', mh.index + 1);
          const a = col >= 0 && mh[0].includes('(') ? callArgs(f, i, col) : { raw: raw[i], clean: c, endLine: fnAt(f, i)?.end ?? i };
          const params = handlerParams(a.clean.slice(a.clean.indexOf(',') + 1)) ;
          push({ kind: 'message', file: f.rel, line: i + 1, quote: quoteOf(r), label: `message handler`, authed: true, limited: true, upload: false }, { file: f, start: i, end: a.endLine, tainted: params.length ? params : ['event', 'data', 'msg', 'message'], reqs: [] });
          continue;
        }
      }
      if (f.lang === 'py') {
        const m = /^\s*@(\w+)\.(route|get|post|put|patch|delete|api_route|websocket)\(\s*['"]([^'"]+)['"](.*)$/.exec(r);
        const sock = /^\s*@(\w+)\.on\(\s*['"]([^'"]+)['"]/.exec(r);
        if (m || sock) {
          let j = i + 1;
          const decos: string[] = [];
          for (let k = i - 1; k >= 0 && /^\s*@/.test(raw[k]); k--) decos.push(raw[k]);
          while (j < raw.length && /^\s*@/.test(raw[j])) decos.push(raw[j++]);
          const fn = f.fns.find((x) => x.start === j);
          if (!fn) continue;
          const sig = raw.slice(fn.start, Math.min(fn.end, fn.start + 4) + 1).join(' ');
          const authed = decos.some((d) => AUTH_WORD.test(d) && !/\.(route|get|post|put|patch|delete)\(/.test(d) && !LIMIT_WORD.test(d)) || /Depends\(\s*\w*(auth|user|login|current)/i.test(sig) || BODY_AUTH.test(raw.slice(fn.start, fn.end + 1).join('\n'));
          const limited = globalLimit || decos.some((d) => LIMIT_WORD.test(d));
          if (sock) {
            push({ kind: 'message', file: f.rel, line: i + 1, quote: quoteOf(r), label: `message ${sock[2]}`, authed: true, limited: true, upload: false }, { file: f, start: fn.start, end: fn.end, tainted: fn.params.flat(), reqs: [], fn });
            continue;
          }
          const methods = /methods\s*=\s*\[([^\]]*)\]/.exec(m![4])?.[1];
          const method = m![2] === 'route' ? (methods && /POST/i.test(methods) ? 'post' : 'get') : m![2] === 'api_route' ? 'all' : m![2];
          // FastAPI: plain parameters are query / path / body values (not the injected ones).
          const injected = /^(request|req|response|db|session|background_tasks|current_user|user|settings|websocket)$/;
          const fastapi = files.size && raw.some((l) => /from fastapi|import fastapi/.test(l));
          // Flask: the <name> parts of the route are the view's parameters.
          const pathParams = [...m![3].matchAll(/<(?:\w+:)?(\w+)>/g)].map((x) => x[1]);
          const tainted = fastapi ? fn.params.flat().filter((p) => !injected.test(p) && !new RegExp(`\\b${p}\\s*(:[^=,]*)?=\\s*Depends\\(`).test(sig)) : pathParams.filter((p) => fn.params.flat().includes(p));
          const upload = /request\.files|UploadFile|FileStorage/.test(raw.slice(fn.start, fn.end + 1).join('\n') + sig);
          push({ kind: upload ? 'upload' : 'http', file: f.rel, line: i + 1, quote: quoteOf(r), label: `${method.toUpperCase()} ${m![3]}`, method, path: m![3], authed, limited, upload }, { file: f, start: fn.start, end: fn.end, tainted, reqs: ['request', 'req'], fn });
          continue;
        }
        // Django views: def view(request, …) in a Django file.
        const dv = /^\s*def\s+(\w+)\s*\(\s*request\b/.exec(r);
        if (dv && raw.some((l) => /from django|import django/.test(l))) {
          const fn = f.fns.find((x) => x.start === i);
          if (fn) {
            const decos: string[] = [];
            for (let k = i - 1; k >= 0 && /^\s*@/.test(raw[k]); k--) decos.push(raw[k]);
            const body = raw.slice(fn.start, fn.end + 1).join('\n');
            push({ kind: /request\.FILES/.test(body) ? 'upload' : 'http', file: f.rel, line: i + 1, quote: quoteOf(r), label: `Django view ${dv[1]}`, authed: decos.some((d) => AUTH_WORD.test(d)) || BODY_AUTH.test(body), limited: globalLimit || decos.some((d) => LIMIT_WORD.test(d)), upload: /request\.FILES/.test(body) }, { file: f, start: fn.start, end: fn.end, tainted: fn.params.flat().slice(1), reqs: ['request'], fn });
          }
          continue;
        }
      }
      if (f.lang === 'go') {
        const m = /\b(\w+)\.(HandleFunc|Handle|Get|Post|Put|Delete|Patch|GET|POST|PUT|DELETE|PATCH|Any)\(\s*"([^"]+)"\s*,\s*(.+)$/.exec(r);
        if (m) {
          const rest = m[4];
          const method = /^Handle/.test(m[2]) ? 'all' : m[2].toLowerCase();
          const mw = /^(\w+)\((\w+)\)\)?\s*$/.exec(rest.trim().replace(/\)\s*$/, ')'));
          const authed = AUTH_WORD.test(rest.split(/func\s*\(/)[0]) || raw.slice(0, i).some((l) => /\.Use\(/.test(l) && AUTH_WORD.test(l));
          const limited = globalLimit || LIMIT_WORD.test(rest.split(/func\s*\(/)[0]);
          const e = { kind: 'http' as EntryKind, file: f.rel, line: i + 1, quote: quoteOf(r), label: `${method === 'all' ? 'ANY' : method.toUpperCase()} ${m[3]}`, method, path: m[3], authed, limited, upload: false };
          if (/func\s*\(/.test(rest)) {
            const col = c.indexOf('(', c.indexOf(m[2]));
            const a = callArgs(f, i, col);
            const ps = /func\s*\(([^)]*)\)/.exec(a.clean)?.[1] ?? '';
            const reqs = ps.split(',').map((x) => x.trim().split(/\s+/)).filter((x) => /\*http\.Request|\*gin\.Context|echo\.Context|\*fiber\.Ctx/.test(x.join(' '))).map((x) => x[0]);
            push({ ...e, authed: e.authed || BODY_AUTH.test(a.raw) }, { file: f, start: i, end: a.endLine, tainted: [], reqs: reqs.length ? reqs : ['r', 'c'] });
          } else {
            const name = (mw ? mw[2] : /^(\w+)/.exec(rest.trim())?.[1]) ?? '';
            const t = findFn(files, f, name) ?? (/^(\w+)\.(\w+)/.exec(rest.trim()) ? findFn(files, f, /^(\w+)\.(\w+)/.exec(rest.trim())![2]) : undefined);
            if (t) push({ ...e, authed: e.authed || Boolean(mw && AUTH_WORD.test(mw[1])) }, { file: t.file, start: t.fn.start, end: t.fn.end, tainted: [], reqs: ['r', 'c', ...t.fn.params.flat().slice(1)], fn: t.fn });
          }
          continue;
        }
      }
      // The command line.
      if (/process\.argv|\bsys\.argv|\bos\.Args\b|\.parse_args\(\)|\bflag\.(String|Int|Arg|Args|Parse)\(|\byargs\b.*\.argv|\bprogram\.(opts|args)\b/.test(c)) {
        const fn = fnAt(f, i);
        push({ kind: 'cli', file: f.rel, line: i + 1, quote: quoteOf(r), label: 'command line', authed: true, limited: true, upload: false }, { file: f, start: fn ? fn.start : 0, end: fn ? fn.end : raw.length - 1, tainted: [], reqs: [], ...(fn ? { fn } : {}) });
      }
    }
  }
  // A handler listed twice (named handler in two routes) stays two entries; Go functions with the
  // net/http signature that no route names are entries of their own (registered elsewhere).
  for (const f of files.values()) {
    if (f.lang !== 'go' || f.test) continue;
    for (const fn of f.fns) {
      const sig = f.raw[fn.start] ?? '';
      if (!/http\.ResponseWriter/.test(sig) || !/\*http\.Request/.test(sig)) continue;
      if (bodies.some((b) => b.file === f && b.start === fn.start)) continue;
      const req = /(\w+)\s+\*http\.Request/.exec(sig)?.[1] ?? 'r';
      push({ kind: 'http', file: f.rel, line: fn.start + 1, quote: quoteOf(sig), label: `handler ${fn.name}`, authed: BODY_AUTH.test(f.raw.slice(fn.start, fn.end + 1).join('\n')), limited: globalLimit, upload: false }, { file: f, start: fn.start, end: fn.end, tainted: [], reqs: [req], fn });
    }
  }
  return { bodies, envReads };
}

// ---- sinks ---------------------------------------------------------------------------------------

/** A sink call on a line: where its argument list starts, and which arguments carry the danger. */
interface SinkMatch {
  kind: SinkKind;
  col: number;
  /** Which arguments matter: 'all', the first, the nth (0-based). */
  args: 'all' | number;
  /** The sink guards itself (a root option, send_from_directory). */
  safe?: boolean;
}

const SQL_WORDS = /\b(SELECT\s[\s\S]*?\sFROM|INSERT\s+INTO|UPDATE\s+[\w.`"]+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i;
const SQL_WRITE = /\b(INSERT\s+INTO|UPDATE\s+[\w.`"]+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i;

function sinksOn(f: FileInfo, li: number, ctx: { sqlVars: Set<string>; htmlVars: Set<string> }): SinkMatch[] {
  const r = f.raw[li];
  const c = f.clean[li];
  const out: SinkMatch[] = [];
  const at = (re: RegExp, src = c) => {
    const m = re.exec(src);
    if (!m) return -1;
    const p = c.indexOf('(', m.index + m[0].length - 1);
    return p;
  };
  const add = (kind: SinkKind, col: number, args: SinkMatch['args'], safe?: boolean) => {
    if (col >= 0) out.push({ kind, col, args, ...(safe ? { safe } : {}) });
  };
  const whole = f.raw.join('\n');
  if (f.lang === 'js') {
    const cp = /child_process/.test(whole);
    if (cp) {
      add('shell', at(/(?:(?<![\w$.])|(?:child_process|cp|childProcess|proc)\.)(exec|execSync)\s*\(/), 'all');
      if (/(?<![\w$.])(spawn|spawnSync|execFile|execFileSync)\s*\(/.test(c)) add('shell', at(/(?<![\w$.])(spawn|spawnSync|execFile|execFileSync)\s*\(/), /shell\s*:\s*true/.test(r) ? 'all' : 0);
    }
    if (/\b(query|execute|exec|raw|all|get|run|prepare|each|unsafe)\s*\(/.test(c) && (SQL_WORDS.test(r) || [...ctx.sqlVars].some((v) => new RegExp(`\\b(query|execute|exec|raw|all|get|run|prepare|each|unsafe)\\s*\\(\\s*${v}\\b`).test(c)))) add('sql', at(/\b(query|execute|exec|raw|all|get|run|prepare|each|unsafe)\s*\(/), 0);
    const fsr = /\b(?:fs\.|fsp\.|promises\.)?(readFile|readFileSync|createReadStream|createWriteStream|writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|readdir|readdirSync|stat|statSync|open|openSync|copyFile|rename)\s*\(/.exec(c);
    if (fsr && (/\bfs[pP]?\.|promises\./.test(c.slice(Math.max(0, fsr.index - 12), fsr.index + 4)) || /(?<![\w$.])(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync)\s*\(/.test(c))) add('path', c.indexOf('(', fsr.index), 0);
    const sf = /\b(res|reply|response)\.(sendFile|download|sendfile)\s*\(/.exec(c);
    if (sf) add('path', c.indexOf('(', sf.index), 0, /\broot\s*:/.test(r));
    const ft = /(?<![\w$.])(fetch|got|needle|superagent)\s*\(|\baxios(\.(get|post|put|delete|patch|head|request))?\s*\(|\bhttps?\.(get|request)\s*\(|\brequest\.(get|post)\s*\(/.exec(c);
    if (ft) add('ssrf', c.indexOf('(', ft.index), 0);
    if (/\b(serialize|nodeSerialize|serializer)\.unserialize\s*\(|\byaml\.load\s*\([^)]*(DEFAULT_FULL|UNSAFE)|\bunserialize\s*\(/.test(c)) add('deserialize', at(/unserialize\s*\(|yaml\.load\s*\(/), 'all');
    const send = /\b(res|reply|response|ctx)\.(send|write|end)\s*\(|\bctx\.body\s*=/.exec(c);
    if (send && (/<\/?[a-z][\w-]*[\s>]/i.test(r) || [...ctx.htmlVars].some((v) => new RegExp(`\\b${v}\\b`).test(c.slice(send.index))))) add('html', c.indexOf('(', send.index) >= 0 ? c.indexOf('(', send.index) : send.index, 'all');
    const ih = /\.(innerHTML|outerHTML)\s*\+?=|\bdocument\.write(ln)?\s*\(|insertAdjacentHTML\s*\(/.exec(c);
    if (ih) out.push({ kind: 'html', col: ih.index, args: 'all' });
    add('redirect', at(/\b(res|reply|response|ctx)\.redirect\s*\(/), 'all');
    add('eval', at(/(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|\bvm\.(runInNewContext|runInThisContext|runInContext|compileFunction)\s*\(/), 'all');
    const js = /\b(res|reply|response)\.(json|send)\s*\(|\bctx\.body\s*=/.exec(c);
    if (js) out.push({ kind: 'secret', col: c.indexOf('(', js.index) >= 0 ? c.indexOf('(', js.index) : js.index, args: 'all' });
  } else if (f.lang === 'py') {
    add('shell', at(/\bos\.(system|popen)\s*\(|\bcommands\.getoutput\s*\(/), 'all');
    if (/\bsubprocess\.\w+\s*\(/.test(c)) add('shell', at(/\bsubprocess\.\w+\s*\(/), /shell\s*=\s*True/.test(c) ? 'all' : 0);
    if (/\.(execute|executemany|executescript|raw|exec_driver_sql|text)\s*\(|\btext\s*\(/.test(c) && (SQL_WORDS.test(r) || [...ctx.sqlVars].some((v) => new RegExp(`\\.(execute|executemany|executescript|raw)\\s*\\(\\s*${v}\\b`).test(c)))) add('sql', at(/\.(execute|executemany|executescript|raw|exec_driver_sql)\s*\(|\btext\s*\(/), 0);
    const op = /(?<![\w.])open\s*\(|\bos\.(remove|unlink|rmdir|listdir|stat)\s*\(|\bshutil\.\w+\s*\(|\bPath\s*\(|\bsend_file\s*\(|\bFileResponse\s*\(|\bio\.open\s*\(/.exec(c);
    if (op) add('path', c.indexOf('(', op.index), 0);
    const sfd = /\bsend_from_directory\s*\(/.exec(c);
    if (sfd) add('path', c.indexOf('(', sfd.index), 'all', true);
    add('ssrf', at(/\b(requests|httpx|session|client)\.(get|post|put|delete|patch|head|request)\s*\(|\burlopen\s*\(|\burllib\.request\.urlopen\s*\(/), 0);
    if (/\b(c?[Pp]ickle|marshal|dill)\.loads?\s*\(|\bjsonpickle\.decode\s*\(|\byaml\.(unsafe_load|full_load)\s*\(/.test(c) || (/\byaml\.load(_all)?\s*\(/.test(c) && !/SafeLoader|BaseLoader/.test(c))) add('deserialize', at(/\b(c?[Pp]ickle|marshal|dill)\.loads?\s*\(|\bjsonpickle\.decode\s*\(|\byaml\.\w+\s*\(/), 'all');
    if (/\brender_template_string\s*\(|\bMarkup\s*\(|\bmark_safe\s*\(/.test(c)) add('html', at(/\brender_template_string\s*\(|\bMarkup\s*\(|\bmark_safe\s*\(/), 'all');
    const hr = /\b(HttpResponse|make_response|Response|HTMLResponse)\s*\(/.exec(c);
    if (hr && /<\/?[a-z][\w-]*[\s>]/i.test(r)) add('html', c.indexOf('(', hr.index), 0);
    if (/^\s*return\s+(f?["']|[\w]+\s*\+)/.test(r) && /<\/?[a-z][\w-]*[\s>]/i.test(r)) out.push({ kind: 'html', col: c.indexOf('return') + 6, args: 'all' });
    add('redirect', at(/\b(redirect|HttpResponseRedirect|RedirectResponse)\s*\(/), 0);
    if (!/literal_eval/.test(c)) add('eval', at(/(?<![\w.])(eval|exec)\s*\(/), 'all');
    const js = /\b(jsonify|JSONResponse|JsonResponse)\s*\(|^\s*return\s+\{/.exec(c);
    if (js) out.push({ kind: 'secret', col: c.indexOf('(', js.index) >= 0 ? c.indexOf('(', js.index) : js.index, args: 'all' });
  } else {
    const ec = /\bexec\.Command(Context)?\s*\(/.exec(c);
    if (ec) add('shell', c.indexOf('(', ec.index), /exec\.Command(Context)?\(\s*(ctx\s*,\s*)?"(sh|bash|cmd|powershell)"/.test(r) ? 'all' : /CommandContext/.test(ec[0]) ? 1 : 0);
    if (/\.(Query|QueryRow|Exec|QueryContext|ExecContext|Raw)\s*\(/.test(c) && (SQL_WORDS.test(r) || [...ctx.sqlVars].some((v) => new RegExp(`\\.(Query|QueryRow|Exec|QueryContext|ExecContext|Raw)\\s*\\(\\s*(ctx\\s*,\\s*)?${v}\\b`).test(c)))) add('sql', at(/\.(Query|QueryRow|Exec|QueryContext|ExecContext|Raw)\s*\(/), /Context/.test(c) ? 1 : 0);
    const op = /\b(os\.(Open|OpenFile|ReadFile|WriteFile|Create|Remove|RemoveAll)|ioutil\.(ReadFile|WriteFile))\s*\(/.exec(c);
    if (op) add('path', c.indexOf('(', op.index), 0);
    const sf = /\bhttp\.ServeFile\s*\(|\bc\.File\s*\(/.exec(c);
    if (sf) add('path', c.indexOf('(', sf.index), /ServeFile/.test(sf[0]) ? 2 : 0);
    const hg = /\bhttp\.(Get|Post|Head)\s*\(|\bhttp\.NewRequest(WithContext)?\s*\(/.exec(c);
    if (hg) add('ssrf', c.indexOf('(', hg.index), /NewRequestWithContext/.test(hg[0]) ? 2 : /NewRequest/.test(hg[0]) ? 1 : 0);
    if (/\btemplate\.HTML\s*\(/.test(c)) add('html', at(/\btemplate\.HTML\s*\(/), 'all');
    const fp = /\bfmt\.Fprintf\s*\(|\bw\.Write\s*\(|\bio\.WriteString\s*\(/.exec(c);
    if (fp && /<\/?[a-z][\w-]*[\s>]/i.test(r)) add('html', c.indexOf('(', fp.index), 'all');
    const rd = /\bhttp\.Redirect\s*\(|\bc\.Redirect\s*\(/.exec(c);
    if (rd) add('redirect', c.indexOf('(', rd.index), /http\.Redirect/.test(rd[0]) ? 2 : 1);
    const js = /\bc\.JSON\s*\(|\bjson\.NewEncoder\(\s*\w+\s*\)\.Encode\s*\(/.exec(c);
    if (js) out.push({ kind: 'secret', col: c.indexOf('(', js.index + js[0].length - 1), args: 'all' });
  }
  return out;
}

/** A URL argument that starts with a fixed scheme and host (input only picks the path) or a local path. */
const FIXED_URL = /^\s*(?:[fF]?[`'"]|`)(?:https?:\/\/[^/'"`$\s{]+\/|\/(?!\/))/;
/** A redirect target that starts with a local path ("/x", not "//"). */
const LOCAL_TARGET = /^\s*(?:[fF]?[`'"])\/(?![/\\'"`])/;
const SECRET_OUT = /process\.env(?!\s*\.\s*(NODE_ENV|PORT|HOST)\b)(?!\s*[.[])|\bos\.environ\b(?!\s*(\.get|\[))|process\.env\s*\.\s*\w*(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|API_?KEY|ACCESS_?KEY)\w*|os\.environ(?:\.get\(|\[)\s*['"]\w*(SECRET|PASSWORD|TOKEN|PRIVATE|API_?KEY)\w*['"]|os\.(getenv|Getenv)\(\s*['"]\w*(SECRET|PASSWORD|TOKEN|PRIVATE|API_?KEY)\w*['"]|(?<![\w$.'"])[A-Z][A-Z0-9_]*(SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY)[A-Z0-9_]*(?![\w$'"])/;

// ---- the walk --------------------------------------------------------------------------------------

type Taint = Map<string, Set<string>>; // name → kinds it was made safe for ('*' = every kind)

const SANITIZERS: [RegExp, string[]][] = [
  [/\b(?:path\.)?basename\s*\(|\bsecure_filename\s*\(|\bfilepath\.Base\s*\(|\bpath\.Base\s*\(/, ['path']],
  [/\bparseInt\s*\(|\bparseFloat\s*\(|\bNumber\s*\(|(?<![\w.])int\s*\(|(?<![\w.])float\s*\(|\bstrconv\.(Atoi|ParseInt|ParseFloat|ParseBool)\s*\(|\buuid\.UUID\s*\(|\bBoolean\s*\(|\bMath\.(floor|round|trunc)\s*\(/, ['*']],
  [/\bescape\w*\s*\(|\bhtml\.escape\s*\(|\bDOMPurify\.sanitize\s*\(|\bsanitize\w*\s*\(|\bbleach\.clean\s*\(|\btemplate\.HTMLEscapeString\s*\(|\bhtmlspecialchars\s*\(/, ['html']],
  [/\bencodeURIComponent\s*\(|\burllib\.parse\.quote\s*\(|\burl\.QueryEscape\s*\(/, ['html', 'shell', 'path', 'redirect', 'sql']],
  [/\bshlex\.quote\s*\(|\bshell-?quote|\bshellescape\s*\(/, ['shell']],
  // Slashes (or dots) taken out of the value: it can't leave the folder.
  [/\.replace(?:All)?\((?=\s*(['"])[/\\.]+\1)/, ['path']],
];
/**
 * The code with every sanitizer call that covers this kind cut out (its argument is safe for it).
 * Matched on the raw text (a sanitizer can depend on a string: .replace('/', '')), cut from both
 * copies at the same places, so they stay aligned.
 */
function stripSanitized(x: { raw: string; clean: string }, kind: string): { raw: string; clean: string } {
  let { raw, clean } = x;
  for (const [re, kinds] of SANITIZERS) {
    if (!kinds.includes(kind) && !kinds.includes('*')) continue;
    const g = new RegExp(re.source, 'g');
    for (let guard = 0; guard < 20; guard++) {
      g.lastIndex = 0;
      const m = g.exec(raw);
      if (!m) break;
      const open = clean.indexOf('(', m.index + m[0].length - 1);
      if (open < 0) break;
      let depth = 0;
      let end = clean.length - 1;
      for (let i = open; i < clean.length; i++) {
        if (clean[i] === '(') depth++;
        else if (clean[i] === ')' && --depth === 0) {
          end = i;
          break;
        }
      }
      raw = `${raw.slice(0, m.index)}SAFE${raw.slice(end + 1)}`;
      clean = `${clean.slice(0, m.index)}SAFE${clean.slice(end + 1)}`;
    }
  }
  return { raw, clean };
}
const GUARD_LINE = /^\s*(if|elif|else\s+if|unless|assert|guard|switch|case|when|match)\b|\bif\s*[(!]|&&|\|\||\?\s*[^:]+:/;
const ALLOW_CHECK = /\.includes\s*\(|\.has\s*\(|\.indexOf\s*\(|\.test\s*\(|\.match\s*\(|\bre\.(fullmatch|match|search)\s*\(|\bregexp\.MatchString\s*\(|\.MatchString\s*\(|\b(not\s+)?in\s+[A-Za-z_][\w.]*|\b(allow|ALLOW|whitelist|WHITELIST|permitted|PERMITTED|isValid|is_valid|validate|VALID)\w*|\bslices\.Contains\s*\(|\bcontains\s*\(/;
const ROOT_CHECK = /\.startsWith\s*\(|\.startswith\s*\(|\bstrings\.HasPrefix\s*\(|\.is_relative_to\s*\(|\bcommonpath\s*\(|['"]\.\.['"]|\brelative\s*\(/;

interface WalkCtx {
  files: Map<string, FileInfo>;
  body: EntryBody;
  hits: Hit[];
  sinks: SinkSite[];
  visited: Set<string>;
  budget: { lines: number };
  /** Lines reached from the entry (auth gap, rate limit). */
  reached: { file: FileInfo; line: number; path: Step[] }[];
}

function idents(text: string): string[] {
  return [...text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

function walk(w: WalkCtx, f: FileInfo, start: number, end: number, taint: Taint, reqs: Set<string>, path: Step[], depth: number): void {
  const sqlVars = new Set<string>();
  const htmlVars = new Set<string>();
  const reqRe = reqs.size ? new RegExp(`(?<![\\w$.])(${[...reqs].map((x) => x.replace(/[$]/g, '\\$')).join('|')})\\s*\\.\\s*(query|params|body|headers|cookies|files?|url|originalUrl|path|hostname|request\\s*\\.\\s*(body|query|files?)|args|form|values|json|data|GET|POST|FILES|COOKIES|META|get_json|get_data|query_params|path_params|URL|Form|PostForm|FormValue|PostFormValue|FormFile|Header|Body|Query|Param|PostForm|DefaultQuery|ShouldBind\\w*|Bind\\w*|GetHeader|Cookie|Params|QueryParam|FormParams)\\b|\\bmux\\.Vars\\(\\s*(${[...reqs].join('|')})\\s*\\)|\\bchi\\.URLParam\\(`) : undefined;
  const CLI = /process\.argv|\bsys\.argv|\bos\.Args\b|\.parse_args\(\)|\bflag\.(String|Int|Arg|Args)\(|\byargs\b.*\.argv|\bprogram\.(opts|args)\b|\binput\s*\(/;
  const isCli = w.body.entry.kind === 'cli';
  /** For which kinds is this text outside input? undefined = not at all. */
  const taintOf = (text: string): Set<string> | undefined => {
    if ((reqRe && reqRe.test(text)) || (isCli && CLI.test(text))) return new Set();
    let safe: Set<string> | undefined;
    for (const id of idents(text)) {
      const s = taint.get(id);
      if (!s) continue;
      safe = safe ? new Set([...safe].filter((k) => s.has(k))) : new Set(s);
    }
    return safe;
  };
  const isTaintedFor = (x: { raw: string; clean: string }, kind: string) => {
    const s = taintOf(codeOf(stripSanitized(x, kind)));
    return Boolean(s && !s.has('*') && !s.has(kind));
  };
  /** Outside input that went through a sanitizer call: safe for that sanitizer's kinds. */
  const taintWith = (x: { raw: string; clean: string }): Set<string> | undefined => {
    const t = taintOf(codeOf(x));
    if (!t) return t;
    const safe = new Set(t);
    for (const [re, kinds] of SANITIZERS) if (re.test(x.raw) && !taintOf(codeOf(stripSanitized(x, kinds[0])))) for (const k of kinds) safe.add(k);
    return safe;
  };
  for (let i = start; i <= end && i < f.raw.length; i++) {
    if (--w.budget.lines < 0) return;
    const raw = f.raw[i];
    const clean = f.clean[i];
    if (!clean.trim()) continue;
    const code = codeOf({ raw, clean });
    w.reached.push({ file: f, line: i, path });
    // Assignments carry outside input (and the guards it went through) to new names.
    const asg = /^\s*(?:(?:const|let|var|final)\s+)?(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*))\s*(?::[^=]+)?(?::=|(?<![=!<>+\-*/])=(?!=))\s*(.+)$/.exec(clean);
    if (asg) {
      const names = (asg[1] ?? asg[2] ?? asg[3]).split(',').map((x) => x.replace(/[:=].*$/, '').trim().split(/\s+/).pop()!).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
      const rhsClean = asg[4];
      const rhsRaw = raw.slice(clean.length - rhsClean.length);
      const t = taintWith({ raw: rhsRaw, clean: rhsClean });
      for (const n of names) {
        if (SQL_WORDS.test(rhsRaw) || (sqlVars.size && [...sqlVars].some((v) => new RegExp(`\\b${v}\\b`).test(rhsClean)))) sqlVars.add(n);
        if (/<\/?[a-z][\w-]*[\s>]/i.test(rhsRaw)) htmlVars.add(n);
        if (t) taint.set(n, new Set(t)); else if (reqRe && reqs.has(rhsClean.trim().replace(/;$/, ''))) reqs.add(n);
        else if (!/\+=/.test(clean)) taint.delete(n);
      }
    }
    // A guard: a check of the value (allowlist, pattern) or of the resolved path against the root.
    if (GUARD_LINE.test(clean)) {
      const names = idents(code).filter((x) => taint.has(x));
      if (names.length) {
        const kinds = ALLOW_CHECK.test(code) ? ['*'] : ROOT_CHECK.test(code) ? ['path', 'redirect'] : [];
        for (const n of names) for (const k of kinds) taint.get(n)!.add(k);
      }
    }
    // Sinks.
    for (const s of sinksOn(f, i, { sqlVars, htmlVars })) {
      if (s.kind === 'secret') {
        const a = callArgs(f, i, s.col, 8);
        const text = s.col >= 0 && f.clean[i][s.col] === '(' ? a.raw : raw;
        if (w.body.entry.kind !== 'cli' && SECRET_OUT.test(text)) recordHit(w, 'secret', f, i, path, depth);
        continue;
      }
      const a = f.clean[i][s.col] === '(' ? callArgs(f, i, s.col, 12) : { raw: raw.slice(s.col), clean: clean.slice(s.col), endLine: i };
      const parts = argsSplit(a);
      let pick = s.args === 'all' ? [a] : parts[s.args] ? [parts[s.args]] : [];
      // A program with an argument list (no shell): only the program's name matters.
      if (s.kind === 'shell' && s.args === 0 && pick[0] && /^\s*\[/.test(pick[0].clean)) {
        const inner = pick[0].clean.indexOf('[');
        pick = argsSplit({ raw: pick[0].raw.slice(inner + 1), clean: pick[0].clean.slice(inner + 1) }).slice(0, 1);
      }
      const tainted = pick.some((p) => isTaintedFor(p, s.kind));
      if (!tainted) {
        if (parts.some((p) => taintOf(codeOf(p)))) w.sinks.push({ kind: s.kind, file: f.rel, line: i + 1, guarded: true });
        continue;
      }
      let guarded = Boolean(s.safe);
      const first = pick[0]?.raw ?? '';
      if (s.kind === 'ssrf' && FIXED_URL.test(first)) guarded = true;
      if (s.kind === 'redirect' && LOCAL_TARGET.test(first)) guarded = true;
      if (s.kind === 'sql') {
        // Placeholders: the query text itself carries no outside value.
        const q = parts[s.args === 'all' ? 0 : s.args];
        if (q && !isTaintedFor(q, 'sql')) guarded = true;
      }
      w.sinks.push({ kind: s.kind, file: f.rel, line: i + 1, guarded });
      if (!guarded) recordHit(w, s.kind, f, i, path, depth);
    }
    // Calls into the project's own functions (bounded).
    if (depth >= MAX_HOPS) continue;
    for (const m of clean.matchAll(/(?<![\w$])(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (/^(if|for|while|switch|return|function|catch|typeof|new|await|async|def|print|elif|with|func|go|defer|super|require|import)$/.test(name)) continue;
      const owner = m[1];
      let target: { file: FileInfo; fn: Fn } | undefined;
      if (owner && f.bindings.has(owner)) {
        const o = w.files.get(f.bindings.get(owner)!);
        const fn = o?.fns.find((x) => x.name === name);
        if (o && fn) target = { file: o, fn };
      } else if (!owner || owner === 'this' || owner === 'self' || owner === 'exports' || owner === 'module') target = findFn(w.files, f, name);
      if (!target) continue;
      if (target.file === f && target.fn.start <= i && target.fn.end >= i) continue; // itself
      const col = (m.index ?? 0) + m[0].length - 1;
      const a = callArgs(f, i, col, 12);
      const args = argsSplit(a);
      const next: Taint = new Map();
      const nextReqs = new Set<string>();
      const offset = f.lang === 'py' && owner && !f.bindings.has(owner) ? 0 : 0;
      args.forEach((arg, k) => {
        const names = target!.fn.params[k + offset] ?? [];
        const t = taintWith(arg);
        const bare = arg.clean.trim();
        for (const n of names) {
          if (t) next.set(n, new Set(t));
          if (reqs.has(bare)) nextReqs.add(n);
        }
      });
      const key = `${target.file.rel}:${target.fn.start}:${[...next.keys()].sort().join(',')}:${[...nextReqs].sort().join(',')}`;
      if (w.visited.has(key)) continue;
      w.visited.add(key);
      walk(w, target.file, target.fn.start, target.fn.end, next, nextReqs, [...path, { file: f.rel, line: i + 1, label: `${name}()` }], depth + 1);
    }
  }
}

function recordHit(w: WalkCtx, kind: ThreatKind, f: FileInfo, i: number, path: Step[], depth: number): void {
  const e = w.body.entry;
  if (w.hits.some((h) => h.kind === kind && h.sink.file === f.rel && h.sink.line === i + 1 && h.entry.id === e.id)) return;
  w.hits.push({ kind, entry: e, sink: { file: f.rel, line: i + 1, quote: quoteOf(f.raw[i]), kind }, path: [...path, { file: f.rel, line: i + 1, label: SINK_LABEL[kind] }], hops: depth });
}

const SINK_LABEL: Record<ThreatKind, string> = { shell: 'shell command', sql: 'SQL query', path: 'file path', ssrf: 'outgoing request', deserialize: 'unsafe loader', html: 'HTML output', redirect: 'redirect', eval: 'runs code', secret: 'response with a secret', auth: 'change without sign-in', ratelimit: 'password check' };

const STATE_CHANGE = new RegExp(
  [
    SQL_WRITE.source,
    String.raw`\b(?:fs\.|fsp\.)?(writeFile|writeFileSync|appendFile|unlink|unlinkSync|rm|rmSync|rmdir|rename)\s*\(`,
    String.raw`\bos\.(remove|unlink|rmdir|Remove|RemoveAll|WriteFile|Create)\s*\(|\bshutil\.(rmtree|move)\s*\(|\bioutil\.WriteFile\s*\(`,
    String.raw`\.(destroy|deleteOne|deleteMany|updateOne|updateMany|insertOne|insertMany|findByIdAndDelete|findByIdAndUpdate|bulkCreate|bulk_create)\s*\(|\.objects\.[^\n]*\.(delete|update)\s*\(|\bdb\.session\.(delete|commit)\s*\(`,
    String.raw`(?<![\w$.])(exec|execSync|spawn)\s*\(|\bos\.system\s*\(|\bsubprocess\.\w+\s*\(|\bexec\.Command\s*\(`,
  ].join('|'),
);
const PASSWORD_CHECK = /\b(password|passwd|pwd|otp|pin|passcode)\b|bcrypt\.compare|check_password|verify_password|argon2\.verify|scrypt|timingSafeEqual|compare_digest|CompareHashAndPassword/i;
const STRONG_CHECK = /bcrypt\.compare|check_password|verify_password|argon2\.verify|timingSafeEqual|compare_digest|CompareHashAndPassword|\.compare(Sync)?\s*\(|===?\s*\w*(password|hash)\b|\b\w*(password|hash)\s*===?/i;
const ATTEMPTS = /attempt|lockout|locked_until|tooMany|too_many|failed_?logins?|retry_after|captcha/i;

/** The analysis of one project (or the in-memory files of a test): entries, the walk, the hits. */
export function analyze(list: string[], read: (rel: string) => string | undefined, opts: { maxHops?: number } = {}): Analysis {
  const { files, truncated } = load(list, read);
  const { bodies, envReads } = entriesOf(files);
  const hits: Hit[] = [];
  const sinks: SinkSite[] = [];
  for (const b of bodies) {
    const taint: Taint = new Map(b.tainted.map((n) => [n, new Set<string>()]));
    const w: WalkCtx = { files, body: b, hits, sinks, visited: new Set(), budget: { lines: MAX_VISIT }, reached: [] };
    const first: Step = { file: b.entry.file, line: b.entry.line, label: b.entry.label };
    // The handler's own name is a step when it lives elsewhere (not when only decorators sit between).
    const decorated = b.fn && b.file.rel === b.entry.file && b.fn.start + 1 > b.entry.line && b.file.raw.slice(b.entry.line - 1, b.fn.start).every((l) => /^\s*@/.test(l));
    const startPath = b.fn && !decorated && (b.file.rel !== b.entry.file || b.fn.start + 1 !== b.entry.line) ? [first, { file: b.file.rel, line: b.fn.start + 1, label: `${b.fn.name}()` }] : [first];
    walk(w, b.file, b.start, b.end, taint, new Set(b.reqs), startPath, startPath.length - 1);
    const e = b.entry;
    // Auth gap: a route nobody signs in for that reaches a change (and the project does sign people
    // in somewhere, or the path says admin).
    if ((e.kind === 'http' || e.kind === 'upload') && !e.authed && !PUBLIC_PATH.test(e.path ?? '/x')) {
      const mutating = e.method === undefined || /^(post|put|patch|delete|del|all)$/.test(e.method) || /admin|delete|remove|destroy|drop|reset|config|settings/i.test(e.path ?? '');
      const projectAuth = bodies.some((o) => o.entry.authed && (o.entry.kind === 'http' || o.entry.kind === 'upload')) || /admin/i.test(e.path ?? '');
      if (mutating && projectAuth) {
        const at = w.reached.find((x) => STATE_CHANGE.test(x.file.clean[x.line]) || (SQL_WRITE.test(x.file.raw[x.line]) && /\b(query|execute|exec|run|Exec)\s*\(/.test(x.file.clean[x.line])));
        if (at && !hits.some((h) => h.kind === 'auth' && h.entry.id === e.id)) hits.push({ kind: 'auth', entry: e, sink: { file: at.file.rel, line: at.line + 1, quote: quoteOf(at.file.raw[at.line]), kind: 'auth' }, path: [...at.path, { file: at.file.rel, line: at.line + 1, label: SINK_LABEL.auth }], hops: Math.max(0, at.path.length - 1) });
      }
    }
    // A sign-in route with no rate limit: the password check is the "sink".
    if (e.kind === 'http' && !e.limited && LOGIN_PATH.test(e.path ?? '') && /^(post|all|put)$/.test(e.method ?? 'post') && !/logout|sign-?out/i.test(e.path ?? '')) {
      const cand = w.reached.filter((x) => PASSWORD_CHECK.test(x.file.clean[x.line]) && !/^\s*(const|let|var)?\s*\{?\s*\w*\s*,?\s*(password|passwd)\s*\}?\s*=\s*(req|request)\./.test(x.file.raw[x.line]) && /\(|===|==|!=/.test(x.file.clean[x.line]));
      // The comparison itself wins over a line that only passes the password on.
      const at = cand.find((x) => STRONG_CHECK.test(x.file.clean[x.line])) ?? cand.find((x) => !(x.file.rel === e.file && x.line + 1 === e.line));
      const counted = w.reached.some((x) => ATTEMPTS.test(x.file.clean[x.line]));
      if (at && !counted) hits.push({ kind: 'ratelimit', entry: e, sink: { file: at.file.rel, line: at.line + 1, quote: quoteOf(at.file.raw[at.line]), kind: 'ratelimit' }, path: [...at.path, { file: at.file.rel, line: at.line + 1, label: SINK_LABEL.ratelimit }], hops: Math.max(0, at.path.length - 1) });
    }
  }
  const sinkCounts = Object.fromEntries(SINK_KINDS.map((k) => [k, 0])) as Record<SinkKind, number>;
  for (const f of files.values()) {
    if (f.test) continue;
    for (let i = 0; i < f.raw.length; i++) for (const s of sinksOn(f, i, { sqlVars: new Set(), htmlVars: new Set() })) if (s.kind !== 'secret') sinkCounts[s.kind]++;
  }
  // One site per line and kind (the strictest verdict wins: unguarded over guarded).
  const seen = new Map<string, SinkSite>();
  for (const s of sinks) {
    const k = `${s.kind}|${s.file}|${s.line}`;
    const o = seen.get(k);
    if (!o || (o.guarded && !s.guarded)) seen.set(k, s);
  }
  return { files: files.size, entries: bodies.map((b) => b.entry), hits, sinks: [...seen.values()], sinkCounts, envReads: envReads.slice(0, 200), truncated };
}

/** A hit's path in one line: "GET /doc (routes.js:5) → readDoc() (files.js:3) → file path (files.js:4)". */
export function pathLine(steps: Step[]): string {
  return steps.map((s) => `${s.label} (${s.file}:${s.line})`).join(' → ');
}

/**
 * The regions of a file the fix pass may change for these lines (1-based): the function around each
 * line, or the call that starts on it (an inline route handler), or a few lines around it.
 */
export function regionsFor(rel: string, text: string, lines: number[]): [number, number][] {
  const { files } = load([rel], () => text);
  const f = files.get(rel);
  const total = text.split(/\r?\n/).length;
  const out: [number, number][] = [];
  for (const L of lines) {
    const i = L - 1;
    if (!f) {
      out.push([Math.max(1, L - 3), Math.min(total, L + 3)]);
      continue;
    }
    const fn = fnAt(f, i);
    if (fn && fn.end - fn.start <= 400) {
      out.push([fn.start + 1, fn.end + 1]);
      continue;
    }
    const col = f.clean[i]?.indexOf('(') ?? -1;
    const span = col >= 0 ? callArgs(f, i, col, 120).endLine : i;
    out.push([Math.max(1, L - 3), Math.min(total, Math.max(span + 1, L + 3))]);
  }
  return out;
}
