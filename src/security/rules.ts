// Phase 81 (harness track M6): the security pass's deterministic checks, written from scratch.
// Each check reads one changed file line by line (no model, no network) and reports the line it
// found as a quote, so every finding passes the "no theater" rule by construction. They look for
// code SHAPES only (string-built SQL, eval of a variable, TLS checks turned off…): nothing here
// writes, runs or sends anything, and no rule contains an exploit or payload.
//
// Each rule has true-positive and near-miss tests in test/phase81.test.ts and is measured on a
// seeded sample set by scripts/eval-security.ts (docs/RESULTS.md).
import { KEY_SHAPED } from '../redact.ts';
import type { FindingSeverity, NewFinding } from './findings.ts';

export type RuleId = 'secret-in-code' | 'code-exec' | 'sql-string' | 'path-traversal' | 'tls-off' | 'unsafe-deserialize' | 'cors-credentials' | 'missing-auth' | 'weak-crypto' | 'inner-html' | 'debug-on';

export interface RuleInfo {
  id: RuleId;
  severity: FindingSeverity;
  title: string;
  advice: string;
}

/** What each check looks for, in plain words (the Findings view, the docs, the fix prompt). */
export const RULES: Record<RuleId, RuleInfo> = {
  'secret-in-code': { id: 'secret-in-code', severity: 'high', title: 'A secret written into the code', advice: 'Move it to an environment variable or a secrets file that git ignores, and change the key: anyone who saw this file has it.' },
  'code-exec': { id: 'code-exec', severity: 'high', title: 'Runs code or a command built from a variable', advice: 'Never pass outside input to eval, new Function or a shell. Use a fixed program with an argument list (execFile / subprocess without shell=True) or parse the data instead of running it.' },
  'sql-string': { id: 'sql-string', severity: 'high', title: 'SQL built by joining strings', advice: 'Use placeholders (? or $1 or %s with the values passed separately) so input can never change the query.' },
  'path-traversal': { id: 'path-traversal', severity: 'high', title: 'A file path taken from the request', advice: 'Keep only the file name (basename), resolve it inside the allowed folder and check the result still starts with that folder before reading or sending it.' },
  'tls-off': { id: 'tls-off', severity: 'high', title: 'Certificate checks turned off', advice: 'Leave TLS verification on. For a private certificate, add its CA to the trusted list instead of switching checks off.' },
  'unsafe-deserialize': { id: 'unsafe-deserialize', severity: 'high', title: 'Unsafe loading of data', advice: 'pickle, marshal, plain yaml.load and unserialize can run code from the data. Use JSON, yaml.safe_load or a SafeLoader for anything that isn\'t fully trusted.' },
  'cors-credentials': { id: 'cors-credentials', severity: 'high', title: 'Any website may call this with the user\'s cookies', advice: 'With credentials allowed, list the exact origins that may call it; a wildcard or an echoed origin lets any site act as the signed-in user.' },
  'missing-auth': { id: 'missing-auth', severity: 'medium', title: 'A new route without the sign-in check the others use', advice: 'The other routes in this file use a sign-in check; add the same one here unless this route is meant to be public.' },
  'weak-crypto': { id: 'weak-crypto', severity: 'medium', title: 'Weak cryptography for a secret', advice: 'Use a slow password hash (scrypt, bcrypt, argon2) for passwords, SHA-256 or better for signatures, crypto.randomBytes / secrets for tokens, and an authenticated cipher such as AES-GCM.' },
  'inner-html': { id: 'inner-html', severity: 'medium', title: 'HTML built from input', advice: 'Set textContent (or create elements) instead of innerHTML for anything that comes from the user, the address bar or the server.' },
  'debug-on': { id: 'debug-on', severity: 'medium', title: 'Debug mode switched on in code', advice: 'Read debug mode from the environment and keep it off by default: debug pages show code and secrets and can run commands.' },
};
export const RULE_IDS = Object.keys(RULES) as RuleId[];

type Lang = 'js' | 'py' | 'go' | 'rb' | 'php' | 'java' | 'other';
const CODE_EXT: Record<string, Lang> = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', vue: 'js', svelte: 'js', py: 'py', go: 'go', rb: 'rb', php: 'php', java: 'java', kt: 'java', cs: 'java', html: 'js', htm: 'js' };
/** Text files the secret check reads (config, env files) besides code. */
const TEXT_EXT = /\.(json|ya?ml|toml|ini|cfg|conf|properties|env|sh|bash|zsh|ps1|txt|xml|tf|tfvars)$|(^|\/)\.env(\.[\w-]+)?$|(^|\/)(Dockerfile|Makefile|Procfile)$/i;
/** Never read: dependency folders, build output, minified bundles, lockfiles, pictures. */
const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.git|__pycache__|\.venv|venv|target)\//;
const SKIP_FILE = /\.min\.(js|css)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
/** Example files are meant to hold fake values. */
const EXAMPLE_FILE = /\.(example|sample|template|dist)$|(^|\/)\.env\.(example|sample|template)$/i;

export function langOf(rel: string): Lang | undefined {
  if (SKIP_PATH.test(rel) || SKIP_FILE.test(rel)) return undefined;
  const ext = /\.([A-Za-z0-9]+)$/.exec(rel)?.[1]?.toLowerCase() ?? '';
  if (CODE_EXT[ext]) return CODE_EXT[ext];
  if (TEXT_EXT.test(rel)) return 'other';
  return undefined;
}

/** Lines that are only a comment (most rules skip them; the secret check doesn't). */
function commentOnly(line: string, lang: Lang): boolean {
  const s = line.trim();
  if (!s) return true;
  if (/^(\/\/|\/\*|\*|<!--)/.test(s)) return true;
  if ((lang === 'py' || lang === 'rb' || lang === 'other') && s.startsWith('#')) return true;
  return false;
}

/** The quote: the line without its indentation (a substring of the real line, so it validates). */
const quoteOf = (line: string) => {
  const q = line.trim();
  return q.length > 300 ? q.slice(0, 300) : q;
};

// ---- the checks ----------------------------------------------------------------------------------

const PRIVATE_KEY_LINE = new RegExp(`${'-'.repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${'-'.repeat(5)}`);
const SECRET_NAME = /\b([A-Za-z0-9_$.-]*(?:passw(?:or)?d|pwd|secret|api[_-]?key|apikey|access[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|private[_-]?key|signing[_-]?key|db[_-]?pass)[A-Za-z0-9_$.-]*)['"]?\]?\s*(?:[:=]|=>)\s*(['"`])([^'"`\s]{8,})\2/i;
/** Live payment-provider keys (the redactor's list covers the AI / cloud / git ones). */
const LIVE_KEY = /\b[sr]k_live_[A-Za-z0-9]{16,}\b/;
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|changeme|change[_-]?me|your[_-]|<|\{\{|\$\{|%\(|%s|example|placeholder|dummy|sample|redacted|\[redacted|todo|fixme|none|null|undefined|secret|password|replace[_-]?me|enter[_-]|insert[_-]|test[_-]?(?:key|secret|password|token)?$|fake)/i;

function secretCheck(line: string): boolean {
  if (PRIVATE_KEY_LINE.test(line)) return true;
  if (KEY_SHAPED.some((re) => re.test(line)) || LIVE_KEY.test(line)) return true;
  const m = SECRET_NAME.exec(line);
  if (!m) return false;
  const value = m[3];
  if (PLACEHOLDER.test(value)) return false;
  // process.env.X / os.environ / getenv / config lookups are references, not values.
  if (/process\.env|os\.environ|getenv|ENV\[|config\.get/.test(value)) return false;
  // A value of only one repeated character or with spaces is a placeholder; a path or URL without credentials isn't a secret.
  if (/^(.)\1+$/.test(value) || /^(https?:\/\/|\/|\.\/)/.test(value)) return false;
  return true;
}

function codeExec(line: string, lang: Lang, file: string): boolean {
  if (lang === 'js') {
    // eval / new Function with anything but plain string literals.
    if (/(?<![\w$.])eval\s*\(\s*(?!['"][^'"]*['"]\s*\))[^)\s]/.test(line)) return true;
    if (/\bnew\s+Function\s*\(/.test(line)) {
      // Any argument that isn't a plain string literal (a variable, a call, a joined string).
      const args = line.slice(line.search(/\bnew\s+Function\s*\(/)).replace(/^new\s+Function\s*\(/, '');
      if (/\$\{|\+|(^|,)\s*[A-Za-z_$]/.test(args)) return true;
    }
    // A timer given a string of code built from a value.
    if (/(?<![\w$.])(setTimeout|setInterval)\s*\(\s*(['"][^'"]*['"]\s*\+|`[^`]*\$\{)/.test(line)) return true;
    if (/\bnew\s+Function\s*\([^)]*$/.test(line) && /\+|\$\{/.test(line)) return true;
    // child_process with a command made from a template or a joined string.
    if (/child_process|require\(['"]child_process|from ['"](node:)?child_process/.test(file)) {
      const m = /(?:(?<![\w$.])|(?:child_process|cp|childProcess|proc)\.)(exec|execSync|spawn|spawnSync)\s*\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+|[A-Za-z_$][\w$.]*\s*\+)/.exec(line);
      if (m) return true;
      if (/(?<![\w$.])(spawn|spawnSync|execFile)\s*\([^)]*shell\s*:\s*true/.test(line) && /\$\{|\+/.test(line)) return true;
    }
    return false;
  }
  if (lang === 'py') {
    if (/(?<![\w.])(eval|exec)\s*\(\s*(?![rbuf]?['"][^'"]*['"]\s*\))[^)\s]/.test(line) && !/literal_eval/.test(line)) return true;
    const built = /\bf['"][^'"]*\{|['"]\s*%\s*[\w(]|\.format\(|['"]\s*\+\s*\w|\w\s*\+\s*['"]/;
    if (/\bos\.(system|popen)\s*\(/.test(line) && built.test(line)) return true;
    if (/\bsubprocess\.\w+\s*\(/.test(line) && /shell\s*=\s*True/.test(line) && built.test(line)) return true;
    return false;
  }
  if (lang === 'php') return /\b(eval|system|shell_exec|passthru|exec|popen)\s*\(\s*[^'")\s]*\$/.test(line);
  if (lang === 'rb') return /\b(eval|system|exec)\s*\(?\s*["'][^"']*#\{/.test(line) || /`[^`]*#\{/.test(line);
  if (lang === 'go') return /exec\.Command\(\s*"(sh|bash|cmd)"\s*,\s*"(-c|\/c)"\s*,\s*[^)]*(\+|Sprintf)/.test(line);
  return false;
}

const SQL = /\b(SELECT\s+[\w*.,\s()]+?\s+FROM\s|INSERT\s+INTO\s|UPDATE\s+[\w.`"]+\s+SET\s|DELETE\s+FROM\s|WHERE\s+[\w.`"]+\s*(=|LIKE|IN)\s*)/i;
const SQL_UPPER = /\b(SELECT\s+[\w*.,\s()]+?\s+FROM\s|INSERT\s+INTO\s|UPDATE\s+[\w.`"]+\s+SET\s|DELETE\s+FROM\s)/;
const DB_CALL = /\b(query|execute|executemany|executescript|prepare|raw|exec|all|run|get|each|sql|cursor|Query|Exec|QueryRow)\s*\(/;
function sqlString(line: string, lang: Lang): boolean {
  // SQL in capitals anywhere, or any-case SQL handed straight to a database call ("Select a file
  // from the list" in a message is not SQL).
  if (!SQL_UPPER.test(line) && !(SQL.test(line) && DB_CALL.test(line))) return false;
  // A template / f-string with a value inside, a string joined with a variable, or %-formatting.
  // (A double-quoted string may hold single quotes and the other way round: WHERE name = '" + x + "'.)
  if (lang === 'js' && /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{/i.test(line)) return true;
  if (lang === 'py' && /\bf("[^"]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"]*\{|'[^']*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^']*\{)/i.test(line)) return true;
  if (/("[^"]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"]*"|'[^']*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^']*')\s*(\+|\.\s*\$|\.\.)\s*[A-Za-z_$(]/i.test(line)) return true;
  if (/[A-Za-z_$)\]]\s*\+\s*['"][^'"]*\b(SELECT|FROM|WHERE|AND|OR|SET|VALUES)\b/i.test(line) && /['"]\s*\+/.test(line)) return true;
  if (lang === 'py' && /("[^"]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"]*%[sd][^"]*"|'[^']*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^']*%[sd][^']*')\s*%\s*[\w(]/i.test(line)) return true;
  if (/("[^"]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"]*\{[^"]*"|'[^']*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^']*\{[^']*')\s*\.format\(/i.test(line)) return true;
  if (lang === 'php' && /["'][^"']*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"']*\$\w+/i.test(line) && /"/.test(line)) return true;
  if (lang === 'go' && /Sprintf\(\s*"[^"]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"]*%[sv]/i.test(line)) return true;
  return false;
}

const REQ_INPUT = /\b(req|request|ctx)\.(params|query|body|args|form|files|GET|POST|path_params|query_params)\b|searchParams\.get\(|\brequest\.(args|form|values)\.get\(/;
const FILE_SINK = /\b(path\.(join|resolve)|readFile(Sync)?|createReadStream|writeFile(Sync)?|unlink(Sync)?|sendFile|res\.download|fs\.\w+|os\.path\.join|open\s*\(|send_file|Path\s*\(|File\.(read|open)|ioutil\.ReadFile|os\.Open|filepath\.Join)\s*\(?/;
function pathTraversal(line: string): boolean {
  if (!REQ_INPUT.test(line) || !FILE_SINK.test(line)) return false;
  // Kept to the file name, or a framework helper that does the check.
  if (/basename\(|secure_filename\(|safe_join\(|send_from_directory\(|filepath\.Base\(|path\.normalize\([^)]*\)\.startsWith|\broot\s*:/.test(line)) return false;
  return true;
}

function tlsOff(line: string): boolean {
  return (
    /rejectUnauthorized\s*:\s*false/.test(line) ||
    /NODE_TLS_REJECT_UNAUTHORIZED['"]?\s*\]?\s*=\s*['"]?0/.test(line) ||
    /\bverify\s*=\s*False\b/.test(line) ||
    /InsecureSkipVerify\s*:\s*true/.test(line) ||
    /ssl\._create_unverified_context|ssl\.CERT_NONE|check_hostname\s*=\s*False/.test(line) ||
    /strictSSL\s*:\s*false/.test(line) ||
    /CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0)/.test(line)
  );
}

function unsafeDeserialize(line: string, lang: Lang): boolean {
  if (lang === 'py') {
    if (/\b(c?[Pp]ickle|marshal|dill)\.loads?\s*\(/.test(line) || /\bshelve\.open\s*\(/.test(line)) return true;
    if (/\byaml\.(unsafe_load|full_load)\s*\(/.test(line)) return true;
    if (/\byaml\.load(_all)?\s*\(/.test(line) && !/Loader\s*=\s*(yaml\.)?(C?SafeLoader|BaseLoader)/.test(line)) return true;
    if (/\bjsonpickle\.decode\s*\(/.test(line)) return true;
    return false;
  }
  if (lang === 'js') return /\b(serialize|nodeSerialize|serializer)\.unserialize\s*\(/.test(line) || /\byaml\.load\s*\([^)]*\{\s*schema\s*:\s*\w*(DEFAULT_FULL|UNSAFE)/.test(line);
  if (lang === 'php') return /(?<![\w>])unserialize\s*\(\s*\$/.test(line);
  if (lang === 'java') return /new\s+ObjectInputStream\s*\(/.test(line) || /\bBinaryFormatter\b/.test(line);
  if (lang === 'rb') return /\bMarshal\.load\s*\(|YAML\.load\s*\(/.test(line);
  return false;
}

const CORS_CRED = /credentials\s*:\s*true|Allow-Credentials['"]?\s*[,:=]\s*['"]?true|allow_credentials\s*=\s*True|AllowCredentials\s*:\s*true|supports_credentials\s*=\s*True/i;
const CORS_ANY = /\borigin\s*:\s*(['"]\*['"]|true\b)|Allow-Origin['"]?\s*[,:]\s*(['"]\*['"]|req\.headers\.origin|req\.header\(['"]origin|request\.headers\.get\(['"]origin)|allow_origins\s*=\s*\[\s*['"]\*['"]|AllowOrigins\s*:\s*\[\]string\{\s*"\*"|origins\s*=\s*['"]\*['"]|origin\s*:\s*\(\s*\w+\s*,\s*(cb|callback)\s*\)\s*=>\s*\w+\(\s*null\s*,\s*true\s*\)/i;

function weakCrypto(line: string, lang: Lang): boolean {
  const secretWords = /passw|pwd|secret|token|sign|hmac|auth|api.?key|salt|session|otp|nonce|reset/i;
  if (/createHash\(\s*['"](md5|sha1)['"]\s*\)|createHmac\(\s*['"](md5|sha1)['"]|hashlib\.(md5|sha1)\s*\(|\b(md5|sha1)\s*\(|\b(md5|sha1)\.(Sum|New)\s*\(|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"|DigestUtils\.(md5|sha1)/i.test(line)) {
    if (/usedforsecurity\s*=\s*False/.test(line)) return false;
    return secretWords.test(line);
  }
  if (/Math\.random\s*\(\s*\)/.test(line) && lang === 'js') return /token|secret|passw|api.?key|salt|nonce|session|otp|reset|invite/i.test(line);
  if (lang === 'py' && /\brandom\.(random|randint|choice|choices|getrandbits)\s*\(/.test(line)) return /token|secret|passw|api.?key|salt|nonce|session|otp|reset|invite/i.test(line);
  if (/\bcreateCipher\s*\(/.test(line)) return true;
  if (/['"](des|des-ede3?|des3|rc4|rc2|bf|blowfish|aes-(128|192|256)-ecb)(-cbc)?['"]|AES\.MODE_ECB|DES\.new\(|ARC4\.new\(|Cipher\.getInstance\("(DES|RC4|AES\/ECB|AES")/i.test(line)) return true;
  return false;
}

function innerHtml(line: string, lang: Lang): boolean {
  if (lang !== 'js') return false;
  const m = /\.(innerHTML|outerHTML)\s*\+?=\s*(.+)$/.exec(line) ?? /\binsertAdjacentHTML\s*\(\s*['"][\w-]+['"]\s*,\s*(.+)$/.exec(line) ?? /\bdocument\.write(ln)?\s*\(\s*(.+)$/.exec(line);
  if (!m) return false;
  const rhs = m[m.length - 1].trim();
  // A plain literal without values in it (or an empty string) is fine.
  if (/^(['"])[^'"]*\1\s*[;)]*\s*$/.test(rhs) || /^`[^`$]*`\s*[;)]*\s*$/.test(rhs)) return false;
  if (/^(DOMPurify\.sanitize|sanitize\w*|escapeHtml|escape)\s*\(/.test(rhs)) return false;
  return /\$\{|\+|\b(location|search|hash|params|query|value|input|data|message|text|name|title|body|comment|html|content|res|response|json|e\.target|event)\b/i.test(rhs);
}

function debugOn(line: string, lang: Lang): boolean {
  if (lang === 'py') return /\.run\([^)]*\bdebug\s*=\s*True/.test(line) || /^\s*DEBUG\s*=\s*True\b/.test(line) || /\bapp\.debug\s*=\s*True/.test(line) || /\bdebug\s*=\s*True\b.*\b(uvicorn|Flask|FastAPI)\b/.test(line);
  if (lang === 'js') return /\bapp\.set\(\s*['"]env['"]\s*,\s*['"]development['"]\s*\)/.test(line) || /\bdumpExceptions\s*:\s*true|showStack\s*:\s*true/.test(line) || /errorhandler\(\s*\{\s*(dumpExceptions|showStack)/.test(line);
  if (lang === 'php') return /ini_set\(\s*['"]display_errors['"]\s*,\s*['"]?(1|on|true)/i.test(line);
  if (lang === 'go') return /gin\.SetMode\(\s*gin\.DebugMode\s*\)/.test(line);
  return false;
}

// ---- routes without the sign-in check others use ------------------------------------------------

const AUTH_WORD = /auth|login|logged|session|token|guard|protect|ensure|require|verify|admin|jwt|passport|signed|isUser|permission|acl/i;
const PUBLIC_PATH = /^\/?$|login|logout|sign[-_]?(in|up|out)|register|health|status|ping|public|static|assets|webhook|callback|oauth|favicon|robots|sitemap|well-known|docs?$|metrics/i;

interface RouteHit {
  line: number;
  path: string;
  authed: boolean;
}

function routesOf(lines: string[], lang: Lang): { routes: RouteHit[]; global: number } {
  const routes: RouteHit[] = [];
  // A line like app.use(requireAuth) makes every route after it signed-in.
  let global = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (lang === 'js') {
      if (/\b(app|router|server|api)\.use\(\s*(?:['"`][^'"`]*['"`]\s*,\s*)?([A-Za-z_$][\w$.]*(\(\))?)\s*[,)]/.test(l)) {
        const name = /\.use\(\s*(?:['"`][^'"`]*['"`]\s*,\s*)?([A-Za-z_$][\w$.]*)/.exec(l)?.[1] ?? '';
        if (AUTH_WORD.test(name) && !global) global = i + 1;
      }
      const m = /\b(app|router|server|api|routes)\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\3\s*,(.*)$/.exec(l);
      if (m) {
        // Middleware: the names before the handler (an inline function or the last name).
        const rest = m[5];
        const before = rest.split(/\basync\b|\bfunction\b|\(\s*req\b|\(\s*\{|\(\s*\)\s*=>|\(\s*ctx\b|\breq\s*=>/)[0];
        const names = before.split(',').map((x) => x.trim()).filter(Boolean);
        const mids = /\(\s*req\b|function|=>/.test(rest) ? names : names.slice(0, -1);
        routes.push({ line: i + 1, path: m[4], authed: mids.some((n) => AUTH_WORD.test(n)) });
      }
    } else if (lang === 'py') {
      const m = /^\s*@(\w+)\.(route|get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/.exec(l);
      if (m) {
        let authed = false;
        const isDeco = (s: string) => /^\s*@/.test(s);
        const authDeco = (s: string) => isDeco(s) && AUTH_WORD.test(s) && !/\.(route|get|post|put|patch|delete)\(/.test(s);
        // Decorators directly above (the same stack) and below, down to the def.
        for (let j = i - 1; j >= 0 && isDeco(lines[j]); j--) if (authDeco(lines[j])) authed = true;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          if (/^\s*(async\s+)?def\s/.test(lines[j])) {
            if (/Depends\(\s*\w*(auth|user|login|current)/i.test(lines[j]) || /Depends\(\s*\w*(auth|user|login|current)/i.test(lines[j + 1] ?? '')) authed = true;
            break;
          }
          if (!isDeco(lines[j])) break;
          if (authDeco(lines[j])) authed = true;
        }
        routes.push({ line: i + 1, path: m[3], authed });
      }
    }
  }
  return { routes, global };
}

function missingAuth(lines: string[], lang: Lang, changed?: Set<number>): { line: number }[] {
  if (lang !== 'js' && lang !== 'py') return [];
  const { routes, global } = routesOf(lines, lang);
  const priv = routes.filter((r) => !PUBLIC_PATH.test(r.path) && !(global && r.line > global));
  const authed = priv.filter((r) => r.authed);
  // The project's pattern is clear only when most other routes here use a check (at least two).
  const out: { line: number }[] = [];
  for (const r of priv) {
    if (r.authed) continue;
    if (changed && !changed.has(r.line)) continue;
    const others = priv.filter((x) => x !== r);
    const othersAuthed = others.filter((x) => x.authed).length;
    if (authed.length >= 2 && othersAuthed >= Math.ceil((others.length * 2) / 3)) out.push({ line: r.line });
  }
  return out;
}

// ---- running them ----------------------------------------------------------------------------------

export interface CheckOptions {
  /** 1-based line numbers changed in this turn: only routes added there count as \"new\" routes. */
  changed?: Set<number>;
  /** Only these rules (the fix loop re-runs only the finding's rule). */
  only?: RuleId[];
}

const finding = (rule: RuleId, file: string, line: number, text: string): NewFinding => ({ source: 'security', origin: 'code', severity: RULES[rule].severity, rule, title: RULES[rule].title, advice: RULES[rule].advice, file, line, quote: quoteOf(text) });

/** Every check on one file's text. `rel` is the workspace-relative path (forward slashes). */
export function checkFile(rel: string, text: string, opts: CheckOptions = {}): NewFinding[] {
  const lang = langOf(rel);
  if (!lang || text.includes('\u0000')) return [];
  const want = (r: RuleId) => !opts.only || opts.only.includes(r);
  const lines = text.split(/\r?\n/);
  const out: NewFinding[] = [];
  const example = EXAMPLE_FILE.test(rel);
  const hasCorsCred = want('cors-credentials') && CORS_CRED.test(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue; // minified or generated
    if (!line.trim()) continue;
    if (want('secret-in-code') && !example && secretCheck(line)) out.push(finding('secret-in-code', rel, i + 1, line));
    if (lang === 'other' || commentOnly(line, lang)) continue;
    if (want('code-exec') && codeExec(line, lang, text)) out.push(finding('code-exec', rel, i + 1, line));
    if (want('sql-string') && sqlString(line, lang)) out.push(finding('sql-string', rel, i + 1, line));
    if (want('path-traversal') && pathTraversal(line)) out.push(finding('path-traversal', rel, i + 1, line));
    if (want('tls-off') && tlsOff(line)) out.push(finding('tls-off', rel, i + 1, line));
    if (want('unsafe-deserialize') && unsafeDeserialize(line, lang)) out.push(finding('unsafe-deserialize', rel, i + 1, line));
    if (hasCorsCred && CORS_ANY.test(line)) out.push(finding('cors-credentials', rel, i + 1, line));
    if (want('weak-crypto') && weakCrypto(line, lang)) out.push(finding('weak-crypto', rel, i + 1, line));
    if (want('inner-html') && innerHtml(line, lang)) out.push(finding('inner-html', rel, i + 1, line));
    if (want('debug-on') && debugOn(line, lang)) out.push(finding('debug-on', rel, i + 1, line));
  }
  if (want('missing-auth')) for (const r of missingAuth(lines, lang, opts.changed)) out.push(finding('missing-auth', rel, r.line, lines[r.line - 1]));
  return out;
}

/** Can the pass read this file at all (code or a config/env file)? */
export const checkable = (rel: string): boolean => langOf(rel) !== undefined;
