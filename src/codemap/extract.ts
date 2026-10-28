// Phase 50: symbol extraction for the code map, without outside parsers. Each language gets a
// small line-based reader: strings and comments are blanked first (so a "{" in a string or a
// commented-out function doesn't count), braces are matched to find where a function or class
// ends, and a few honest patterns find functions, classes, methods, types and imports. It is a
// map, not a compiler: unusual layouts can be missed, and the tools say where things are, not
// what they mean.

export type Lang = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'csharp' | 'c' | 'cpp' | 'markdown' | 'text';

export interface Sym {
  name: string;
  kind: string;
  /** 1-based first line (the declaration). */
  line: number;
  /** 1-based last line of its body (the same line when there is no body). */
  end: number;
  /** The declaration line, trimmed and shortened. */
  signature: string;
  exported: boolean;
  /** The class / impl / type it belongs to (methods). */
  parent?: string;
}

export interface Imp {
  /** What is imported, as written ("./store.ts", "node:fs", "os.path", "mod:util"). */
  spec: string;
  line: number;
  /** The imported names, when easy to see ("{ a, b }", "x"). */
  names?: string;
}

export interface Extracted {
  symbols: Sym[];
  imports: Imp[];
}

const EXT: Record<string, Lang> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  json: 'text', yaml: 'text', yml: 'text', toml: 'text', html: 'text', htm: 'text', css: 'text', scss: 'text', less: 'text',
  sh: 'text', bash: 'text', zsh: 'text', ps1: 'text', sql: 'text', txt: 'text', rst: 'text', vue: 'text', svelte: 'text',
  rb: 'text', php: 'text', swift: 'text', dart: 'text', lua: 'text', ini: 'text', cfg: 'text', xml: 'text', gradle: 'text', proto: 'text', graphql: 'text',
};
const NAMES: Record<string, Lang> = { makefile: 'text', dockerfile: 'text', readme: 'markdown', gemfile: 'text', procfile: 'text', justfile: 'text' };
/** Generated or lock files: big, and nobody looks for code in them. */
const SKIP_NAME = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|cargo\.lock|go\.sum|poetry\.lock|pipfile\.lock|composer\.lock|gemfile\.lock)$|\.min\.(js|css)$|\.map$|\.d\.ts\.map$/i;

/** The language of a file by its name, or undefined when it isn't a source or text file the map reads. */
export function langOf(path: string): Lang | undefined {
  const name = path.split('/').pop() ?? path;
  if (SKIP_NAME.test(name)) return undefined;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return NAMES[name.toLowerCase()];
  return EXT[name.slice(dot + 1).toLowerCase()] ?? NAMES[name.slice(0, dot).toLowerCase()];
}

// ---------- strings, comments and braces ----------

interface ScanOpts {
  /** "'" starts a short character literal (C, Java, Go, Rust) rather than a string. */
  charQuote?: boolean;
  /** Backticks are (multi-line) strings: JS template literals, Go raw strings. */
  backtick?: boolean;
  /** JS: a "/" after an operator starts a regular expression. */
  regex?: boolean;
  /** C#/Rust-ish verbatim strings are not handled; triple quotes (Kotlin/Java text blocks) are. */
  tripleQuote?: boolean;
}

export interface Scanned {
  /** Each line with comments removed and string contents blanked (quotes kept). */
  clean: string[];
  /** Brace depth at the start of each line. */
  depth: number[];
  /** Braces opened on each line: the depth before the brace and the line (0-based) where it closes. */
  opens: { depth: number; close: number }[][];
}

/** Blanks strings and comments and matches braces, for the brace languages. */
export function scan(lines: string[], o: ScanOpts = {}): Scanned {
  const clean: string[] = [];
  const depth: number[] = [];
  const opens: { depth: number; close: number }[][] = lines.map(() => []);
  const stack: { line: number; idx: number }[] = [];
  let d = 0;
  let inBlock = false;
  let inStr: string | null = null; // a string that runs across lines (template, raw, text block)
  for (let li = 0; li < lines.length; li++) {
    const s = lines[li];
    depth.push(d);
    let out = '';
    let prev = ''; // the last significant character (for the regex rule)
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inBlock) {
        if (ch === '*' && s[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        out += ' ';
        continue;
      }
      if (inStr) {
        if (ch === '\\' && inStr !== '`raw') {
          out += '  ';
          i++;
          continue;
        }
        if (inStr === '"""' && s.startsWith('"""', i)) {
          out += '"""';
          i += 2;
          inStr = null;
        } else if ((inStr === '`' || inStr === '`raw') && ch === '`') {
          out += '`';
          inStr = null;
        } else if (inStr === ch && inStr.length === 1) {
          out += ch;
          inStr = null;
        } else out += ' ';
        continue;
      }
      if (ch === '/' && s[i + 1] === '/') break;
      if (ch === '/' && s[i + 1] === '*') {
        inBlock = true;
        out += '  ';
        i++;
        continue;
      }
      if (o.tripleQuote && s.startsWith('"""', i)) {
        inStr = '"""';
        out += '"""';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inStr = '"';
        out += '"';
        continue;
      }
      if (ch === '`' && o.backtick) {
        inStr = o.regex ? '`' : '`raw';
        out += '`';
        continue;
      }
      if (ch === "'") {
        if (o.charQuote) {
          // A character literal ('a', '\n', '\u{1F600}'); anything else (Rust lifetimes) is plain.
          const m = /^'(\\[^']{1,10}|[^\\'])'/.exec(s.slice(i));
          if (m) {
            out += `'${' '.repeat(m[0].length - 2)}'`;
            i += m[0].length - 1;
            continue;
          }
          out += ch;
          prev = ch;
          continue;
        }
        inStr = "'";
        out += "'";
        continue;
      }
      if (ch === '/' && o.regex && (prev === '' || '(,=:[!&|?{};~+-*%<>'.includes(prev) || /\breturn\s*$/.test(out))) {
        // A regular expression literal: skip to its closing slash (classes may hold a slash).
        let j = i + 1;
        let inClass = false;
        for (; j < s.length; j++) {
          const c = s[j];
          if (c === '\\') j++;
          else if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
        }
        if (j < s.length) {
          out += `/${' '.repeat(j - i - 1)}/`;
          i = j;
          prev = '/';
          continue;
        }
      }
      if (ch === '{') {
        stack.push({ line: li, idx: opens[li].length });
        opens[li].push({ depth: d, close: lines.length - 1 });
        d++;
      } else if (ch === '}') {
        if (d > 0) d--;
        const open = stack.pop();
        if (open) opens[open.line][open.idx].close = li;
      }
      out += ch;
      if (!/\s/.test(ch)) prev = ch;
    }
    // A plain string can't run past the end of a line (an unclosed quote is a typo or a lifetime).
    if (inStr === '"' || inStr === "'") inStr = null;
    clean.push(out);
  }
  return { clean, depth, opens };
}

/**
 * Where the body that starts at (or just after) a declaration line ends, or the line itself. The
 * body may open on a later line only while the declaration is clearly still going (open
 * parentheses, a trailing comma or operator, or a brace on its own next line).
 */
function endOf(sc: Scanned, line: number, ahead = 6): number {
  const d0 = sc.depth[line];
  let parens = 0;
  for (let j = line; j < Math.min(sc.clean.length, line + ahead); j++) {
    const c = sc.clean[j];
    if (j > line) {
      const prev = sc.clean[j - 1].trim();
      const next = c.trim();
      const going = parens > 0 || /[(,=:|&>\-+]$/.test(prev) || /^[{:]/.test(next) || /^(where|throws|extends|implements|const|noexcept|override|->)\b/.test(next) || next === '';
      if (!going) return line;
    }
    const open = sc.opens[j].find((o) => o.depth === d0);
    if (open) return open.close;
    // A declaration that ends before any body opens (a prototype, an abstract method, a value).
    if (/;\s*$/.test(c)) return line;
    for (const ch of c) {
      if (ch === '(') parens++;
      else if (ch === ')') parens = Math.max(0, parens - 1);
    }
  }
  return line;
}

const sig = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 160);

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'finally', 'with', 'new', 'throw', 'typeof', 'await', 'yield', 'case', 'sizeof', 'delete', 'super', 'this', 'import', 'export', 'goto', 'using', 'lock', 'foreach', 'fixed', 'when', 'match', 'loop', 'static_assert', 'defined', 'elif', 'until', 'unless', 'in', 'of', 'and', 'or', 'not']);

/** Line number (1-based) of a character offset. */
function lineAt(starts: number[], idx: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

// ---------- TypeScript / JavaScript ----------

function extractJs(text: string, lines: string[]): Extracted {
  const sc = scan(lines, { backtick: true, regex: true });
  const symbols: Sym[] = [];
  const containers: { name: string; depth: number; end: number }[] = [];
  const exportNames = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const c = sc.clean[i];
    if (!c.trim()) continue;
    const d = sc.depth[i];
    while (containers.length && containers[containers.length - 1].end < i) containers.pop();
    const top = containers[containers.length - 1];
    let m: RegExpExecArray | null;
    if ((m = /^\s*(export\s+)?(default\s+)?(declare\s+)?(async\s+)?function\s*\*?\s*([\w$]+)/.exec(c))) {
      symbols.push({ name: m[5], kind: 'function', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: Boolean(m[1]) });
      continue;
    }
    if ((m = /^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?class\s+([\w$]+)/.exec(c))) {
      const end = endOf(sc, i);
      symbols.push({ name: m[5], kind: 'class', line: i + 1, end: end + 1, signature: sig(lines[i]), exported: Boolean(m[1]) });
      containers.push({ name: m[5], depth: d, end });
      continue;
    }
    if ((m = /^\s*(export\s+)?(declare\s+)?(interface|enum|namespace)\s+([\w$.]+)/.exec(c)) || (m = /^\s*(export\s+)?(declare\s+)?(type)\s+([\w$]+)\s*(?:<[^=]*>)?\s*=/.exec(c))) {
      const end = m[3] === 'type' ? i : endOf(sc, i);
      symbols.push({ name: m[4], kind: m[3], line: i + 1, end: end + 1, signature: sig(lines[i]), exported: Boolean(m[1]) });
      continue;
    }
    if (d === 0 && (m = /^(export\s+)?(declare\s+)?(const|let|var)\s+([\w$]+)\s*(?::[^=]*)?=\s*(.*)$/.exec(c))) {
      const rest = m[5];
      const fn = /^(async\s+)?(function\b|\([^)]*\)?\s*(?::[^=]*)?=>|[\w$]+\s*=>|\($)/.test(rest) && (/=>|function/.test(rest) || /\($/.test(rest));
      symbols.push({ name: m[4], kind: fn ? 'function' : 'const', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: Boolean(m[1]) });
      continue;
    }
    if ((m = /^\s*(?:module\.)?exports\.([\w$]+)\s*=\s*(.*)$/.exec(c))) {
      symbols.push({ name: m[1], kind: /function|=>/.test(m[2]) ? 'function' : 'const', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: true });
      continue;
    }
    if ((m = /^\s*(?:module\.exports\s*=|export)\s*\{([^}]*)\}/.exec(c)) && !/\bfrom\b/.test(c)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].replace(/:.*$/, '').trim();
        if (n) exportNames.add(n);
      }
      continue;
    }
    if ((m = /^\s*export\s+default\s+([\w$]+)\s*;?\s*$/.exec(c))) {
      exportNames.add(m[1]);
      continue;
    }
    if (top && d === top.depth + 1) {
      const mm = /^\s*((?:(?:public|private|protected|static|readonly|abstract|override|async|declare|get|set|accessor)\s+)*)\*?\s*(#?[\w$]+)\s*(?:<[^>()]*>)?\s*\(/.exec(c) ?? /^\s*((?:(?:public|private|protected|static|readonly)\s+)*)(#?[\w$]+)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]*)?=>/.exec(c);
      if (mm && !KEYWORDS.has(mm[2])) {
        symbols.push({ name: mm[2], kind: 'method', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: !/private/.test(mm[1]) && !mm[2].startsWith('#'), parent: top.name });
      }
    }
  }
  for (const s of symbols) if (!s.parent && exportNames.has(s.name)) s.exported = true;
  // Imports: over the whole text (a braced list can span lines), skipping commented-out ones.
  const starts = lineStarts(text);
  const imports: Imp[] = [];
  const seen = new Set<string>();
  const add = (spec: string, idx: number, names?: string) => {
    const line = lineAt(starts, idx);
    if (!sc.clean[line - 1]?.trim()) return; // inside a comment
    const key = `${spec}@${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ spec, line, ...(names ? { names: names.replace(/\s+/g, ' ').trim().slice(0, 160) } : {}) });
  };
  for (const m of text.matchAll(/^[ \t]*import\s+(?:type\s+)?([^;'"`]*?)\s*from\s*['"]([^'"\n]+)['"]/gm)) add(m[2], m.index!, m[1]);
  for (const m of text.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm)) add(m[1], m.index!);
  for (const m of text.matchAll(/^[ \t]*export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/gm)) add(m[2], m.index!, m[1]);
  for (const m of text.matchAll(/\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g)) add(m[1], m.index!);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g)) add(m[1], m.index!);
  imports.sort((a, b) => a.line - b.line);
  return { symbols, imports };
}

// ---------- Python ----------

function extractPython(lines: string[]): Extracted {
  const symbols: Sym[] = [];
  const imports: Imp[] = [];
  // Lines inside triple-quoted strings are not code.
  const code: boolean[] = [];
  let inTriple: string | null = null;
  for (const l of lines) {
    if (inTriple) {
      code.push(false);
      if (l.split(inTriple).length % 2 === 0) inTriple = null;
      continue;
    }
    code.push(true);
    for (const q of ['"""', "'''"]) {
      if (l.split(q).length % 2 === 0) {
        inTriple = q;
        break;
      }
    }
  }
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const blockEnd = (i: number, indent: number): number => {
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || (code[j] && l.trim().startsWith('#'))) continue;
      if (code[j] && indentOf(l) <= indent) break;
      last = j;
    }
    return last;
  };
  const stack: { indent: number; name: string; kind: 'class' | 'def' }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!code[i] || !l.trim() || l.trim().startsWith('#')) continue;
    const ind = indentOf(l);
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
    let m: RegExpExecArray | null;
    if ((m = /^\s*(async\s+)?def\s+(\w+)\s*[([]/.exec(l))) {
      const owner = stack[stack.length - 1];
      const method = owner?.kind === 'class';
      symbols.push({ name: m[2], kind: method ? 'method' : 'function', line: i + 1, end: blockEnd(i, ind) + 1, signature: sig(l), exported: !m[2].startsWith('_') || /^__\w+__$/.test(m[2]), ...(method ? { parent: owner.name } : {}) });
      stack.push({ indent: ind, name: m[2], kind: 'def' });
      continue;
    }
    if ((m = /^\s*class\s+(\w+)/.exec(l))) {
      symbols.push({ name: m[1], kind: 'class', line: i + 1, end: blockEnd(i, ind) + 1, signature: sig(l), exported: !m[1].startsWith('_'), ...(stack.length && stack[stack.length - 1].kind === 'class' ? { parent: stack[stack.length - 1].name } : {}) });
      stack.push({ indent: ind, name: m[1], kind: 'class' });
      continue;
    }
    if ((m = /^\s*import\s+(.+?)\s*(#.*)?$/.exec(l))) {
      for (const part of m[1].split(',')) {
        const spec = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(spec)) imports.push({ spec, line: i + 1 });
      }
      continue;
    }
    if ((m = /^\s*from\s+(\.*[\w.]*)\s+import\s+(.+?)\s*(#.*)?$/.exec(l))) {
      imports.push({ spec: m[1], line: i + 1, names: m[2].replace(/[()\\]/g, '').trim().slice(0, 160) });
      continue;
    }
    if (ind === 0 && (m = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=(?!=)/.exec(l))) symbols.push({ name: m[1], kind: 'const', line: i + 1, end: i + 1, signature: sig(l), exported: true });
  }
  return { symbols, imports };
}

// ---------- Go ----------

function extractGo(lines: string[]): Extracted {
  const sc = scan(lines, { charQuote: true, backtick: true });
  const symbols: Sym[] = [];
  const imports: Imp[] = [];
  let block: 'import' | 'type' | 'const' | 'var' | null = null;
  const pub = (n: string) => /^[A-Z]/.test(n);
  for (let i = 0; i < lines.length; i++) {
    const c = sc.clean[i];
    const raw = lines[i];
    if (!c.trim()) continue;
    let m: RegExpExecArray | null;
    if (block) {
      if (/^\s*\)/.test(c)) {
        block = null;
        continue;
      }
      if (block === 'import' && (m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(raw))) imports.push({ spec: m[1], line: i + 1 });
      else if (block === 'type' && sc.depth[i] === 0 && (m = /^\s*(\w+)\s+(struct|interface)?/.exec(c))) symbols.push({ name: m[1], kind: m[2] ?? 'type', line: i + 1, end: endOf(sc, i) + 1, signature: sig(raw), exported: pub(m[1]) });
      else if ((block === 'const' || block === 'var') && sc.depth[i] === 0 && (m = /^\s*([A-Z]\w*)\b/.exec(c))) symbols.push({ name: m[1], kind: block, line: i + 1, end: i + 1, signature: sig(raw), exported: true });
      continue;
    }
    if ((m = /^import\s*\(/.exec(c))) {
      block = 'import';
      continue;
    }
    if ((m = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(raw))) {
      imports.push({ spec: m[1], line: i + 1 });
      continue;
    }
    if ((m = /^(type|const|var)\s*\(/.exec(c))) {
      block = m[1] as 'type' | 'const' | 'var';
      continue;
    }
    if ((m = /^func\s+\(([^)]*)\)\s*(\w+)/.exec(c))) {
      const recv = m[1].trim().split(/\s+/).pop()?.replace(/^\*/, '').replace(/\[.*$/, '') ?? '';
      symbols.push({ name: m[2], kind: 'method', line: i + 1, end: endOf(sc, i) + 1, signature: sig(raw), exported: pub(m[2]), parent: recv });
      continue;
    }
    if ((m = /^func\s+(\w+)/.exec(c))) {
      symbols.push({ name: m[1], kind: 'function', line: i + 1, end: endOf(sc, i) + 1, signature: sig(raw), exported: pub(m[1]) });
      continue;
    }
    if ((m = /^type\s+(\w+)(?:\[[^\]]*\])?\s+(struct|interface)?/.exec(c))) {
      symbols.push({ name: m[1], kind: m[2] ?? 'type', line: i + 1, end: endOf(sc, i) + 1, signature: sig(raw), exported: pub(m[1]) });
      continue;
    }
    if ((m = /^(const|var)\s+(\w+)/.exec(c)) && pub(m[2])) symbols.push({ name: m[2], kind: m[1], line: i + 1, end: i + 1, signature: sig(raw), exported: true });
  }
  return { symbols, imports };
}

// ---------- Rust ----------

function extractRust(lines: string[]): Extracted {
  const sc = scan(lines, { charQuote: true });
  const symbols: Sym[] = [];
  const imports: Imp[] = [];
  const containers: { name: string; depth: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const c = sc.clean[i];
    if (!c.trim()) continue;
    const d = sc.depth[i];
    while (containers.length && containers[containers.length - 1].end < i) containers.pop();
    const top = containers[containers.length - 1];
    let m: RegExpExecArray | null;
    if ((m = /^\s*(pub(?:\s*\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/.exec(c))) {
      const inside = top && d === top.depth + 1;
      symbols.push({ name: m[2], kind: inside ? 'method' : 'function', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: Boolean(m[1]) || Boolean(inside && top.name.includes(' for ')), ...(inside ? { parent: top.name.split(' for ').pop() } : {}) });
      continue;
    }
    if ((m = /^\s*(?:unsafe\s+)?impl\b(?:\s*<[^{]*?>)?\s+([^{]+?)\s*(?:where\b[^{]*)?\{?\s*$/.exec(c))) {
      const name = m[1].replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const end = endOf(sc, i);
      symbols.push({ name, kind: 'impl', line: i + 1, end: end + 1, signature: sig(lines[i]), exported: false });
      containers.push({ name, depth: d, end });
      continue;
    }
    if ((m = /^\s*(pub(?:\s*\([^)]*\))?\s+)?(struct|enum|trait|type|union|mod|const|static)\s+(?:mut\s+)?(\w+)/.exec(c))) {
      if (m[2] === 'mod' && /;\s*$/.test(c)) {
        imports.push({ spec: `mod:${m[3]}`, line: i + 1 });
        continue;
      }
      const end = m[2] === 'const' || m[2] === 'static' || m[2] === 'type' ? i : endOf(sc, i);
      symbols.push({ name: m[3], kind: m[2], line: i + 1, end: end + 1, signature: sig(lines[i]), exported: Boolean(m[1]) });
      if (m[2] === 'trait') containers.push({ name: m[3], depth: d, end });
      continue;
    }
    if ((m = /^\s*macro_rules!\s*(\w+)/.exec(c))) {
      symbols.push({ name: m[1], kind: 'macro', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: /#\[macro_export\]/.test(lines[i - 1] ?? '') });
      continue;
    }
    if ((m = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?use\s+(.*)$/.exec(c))) {
      let body = m[1];
      for (let j = i + 1; !/;/.test(body) && j < Math.min(lines.length, i + 30); j++) body += ` ${sc.clean[j].trim()}`;
      const spec = body.replace(/;.*$/, '').replace(/\s+/g, '').trim();
      const root = spec.split('::{')[0];
      imports.push({ spec: root, line: i + 1, ...(root !== spec ? { names: spec.slice(root.length + 3).replace(/\}$/, '').slice(0, 160) } : {}) });
    }
  }
  return { symbols, imports };
}

// ---------- Java / Kotlin / C# ----------

const JVM_MODS = '(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|readonly|unsafe|new|inner|value|enum|annotation|inline|override|non-sealed|strictfp|virtual|async|extern|synchronized|native|default|suspend|operator|infix|tailrec|external|lateinit|const|expect|actual)';

function extractJvm(lines: string[], lang: 'java' | 'kotlin' | 'csharp'): Extracted {
  const sc = scan(lines, { charQuote: true, tripleQuote: lang !== 'csharp' });
  const symbols: Sym[] = [];
  const imports: Imp[] = [];
  const containers: { name: string; kind: string; depth: number; end: number }[] = [];
  const typeRe = new RegExp(`^\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*((?:${JVM_MODS}\\s+)*)(class|interface|enum|record|struct|object)\\s+(\\w+)`);
  const kotlinFun = new RegExp(`^\\s*((?:${JVM_MODS}\\s+)*)fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>]+\\.)?(\\w+)\\s*\\(`);
  const methodRe = new RegExp(`^\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*((?:${JVM_MODS}\\s+)*)(?:<[^>]*>\\s+)?([\\w.?]+(?:\\s*<[^()]*>)?(?:\\[\\])*\\??)\\s+(\\w+)\\s*(?:<[^()]*>)?\\s*\\(`);
  const ctorRe = new RegExp(`^\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*((?:${JVM_MODS}\\s+)*)(\\w+)\\s*\\(`);
  const modWord = new RegExp(`^${JVM_MODS}$`);
  const isPublic = (mods: string, inInterface: boolean) => (lang === 'kotlin' ? !/\b(private|internal)\b/.test(mods) : /\b(public|protected)\b/.test(mods) || inInterface);
  for (let i = 0; i < lines.length; i++) {
    const c = sc.clean[i];
    if (!c.trim()) continue;
    const d = sc.depth[i];
    while (containers.length && containers[containers.length - 1].end < i) containers.pop();
    const top = containers[containers.length - 1];
    let m: RegExpExecArray | null;
    if (lang === 'java' && (m = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/.exec(c))) {
      imports.push({ spec: m[1], line: i + 1 });
      continue;
    }
    if (lang === 'kotlin' && (m = /^\s*import\s+([\w.]+(?:\.\*)?)/.exec(c))) {
      imports.push({ spec: m[1], line: i + 1 });
      continue;
    }
    if (lang === 'csharp' && (m = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/.exec(c))) {
      imports.push({ spec: m[1], line: i + 1 });
      continue;
    }
    if ((m = typeRe.exec(c)) && !(m[2] === 'object' && /\bcompanion\b/.test(m[1]))) {
      const end = endOf(sc, i);
      const kind = m[2] === 'object' ? 'object' : m[2];
      symbols.push({ name: m[3], kind, line: i + 1, end: end + 1, signature: sig(lines[i]), exported: lang === 'kotlin' ? !/\b(private|internal)\b/.test(m[1]) : /\bpublic\b/.test(m[1]) || (top?.kind === 'interface'), ...(top ? { parent: top.name } : {}) });
      containers.push({ name: m[3], kind, depth: d, end });
      continue;
    }
    if (lang === 'kotlin' && (m = kotlinFun.exec(c))) {
      const inside = top && d === top.depth + 1;
      symbols.push({ name: m[2], kind: inside ? 'method' : 'function', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: isPublic(m[1], false), ...(inside ? { parent: top.name } : {}) });
      continue;
    }
    if (lang !== 'kotlin' && top && d === top.depth + 1) {
      const decl = !/;\s*$/.test(c) || top.kind === 'interface' || /\babstract\b|\bextern\b/.test(c);
      if ((m = methodRe.exec(c)) && decl && !KEYWORDS.has(m[3]) && !KEYWORDS.has(m[2]) && !modWord.test(m[2]) && !/[=]/.test(c.slice(0, c.indexOf('(')))) {
        symbols.push({ name: m[3], kind: 'method', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: isPublic(m[1], top.kind === 'interface'), parent: top.name });
        continue;
      }
      if ((m = ctorRe.exec(c)) && m[2] === top.name && decl) symbols.push({ name: m[2], kind: 'constructor', line: i + 1, end: endOf(sc, i) + 1, signature: sig(lines[i]), exported: isPublic(m[1], false), parent: top.name });
    }
  }
  return { symbols, imports };
}

// ---------- C / C++ ----------

function extractC(lines: string[], lang: 'c' | 'cpp'): Extracted {
  const sc = scan(lines, { charQuote: true });
  const symbols: Sym[] = [];
  const imports: Imp[] = [];
  // Depths where functions may be defined: the top, namespaces, extern "C" blocks.
  const scopes: { depth: number; end: number; name?: string; kind: 'ns' | 'class' }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const c = sc.clean[i];
    if (!c.trim()) continue;
    const d = sc.depth[i];
    while (scopes.length && scopes[scopes.length - 1].end < i) scopes.pop();
    const top = scopes[scopes.length - 1];
    let m: RegExpExecArray | null;
    if ((m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(raw))) {
      imports.push({ spec: m[1] === '"' ? m[2] : `<${m[2]}>`, line: i + 1 });
      continue;
    }
    if ((m = /^\s*#\s*define\s+(\w+)/.exec(c))) {
      symbols.push({ name: m[1], kind: 'macro', line: i + 1, end: i + 1, signature: sig(raw), exported: true });
      continue;
    }
    if (/^\s*#/.test(c)) continue;
    if (/^\s*extern\s+"C"\s*\{?\s*$/.test(c)) {
      scopes.push({ depth: d, end: endOf(sc, i), kind: 'ns' });
      continue;
    }
    if ((m = /^\s*(typedef\s+)?(?:template\s*<[^>]*>\s*)?(struct|class|union|enum(?:\s+class)?|namespace)\s+(\w+)\s*(?::[^{;]*)?(\{.*)?$/.exec(c)) && !/;\s*$/.test(c.replace(/\{.*\}\s*\w*\s*;\s*$/, '{'))) {
      const end = endOf(sc, i);
      const kind = m[2].startsWith('enum') ? 'enum' : m[2];
      symbols.push({ name: m[3], kind, line: i + 1, end: end + 1, signature: sig(raw), exported: true, ...(top?.name ? { parent: top.name } : {}) });
      scopes.push({ depth: d, end, name: m[3], kind: kind === 'namespace' ? 'ns' : 'class' });
      continue;
    }
    if (d > 0 && (m = /^\s*\}\s*(\w+)\s*;/.exec(c))) {
      symbols.push({ name: m[1], kind: 'type', line: i + 1, end: i + 1, signature: sig(raw), exported: true });
      continue;
    }
    if ((m = /^\s*typedef\b[^;{]*?\b(\w+)\s*;\s*$/.exec(c)) || (m = /^\s*typedef\b.*\(\s*\*\s*(\w+)\s*\)/.exec(c))) {
      symbols.push({ name: m[1], kind: 'type', line: i + 1, end: i + 1, signature: sig(raw), exported: true });
      continue;
    }
    const atScope = d === 0 || (top && d === top.depth + 1);
    if (!atScope) continue;
    m = /^\s*((?:[\w:*&<>,~]+[\s*&]+)*?)([*&]*)\s*((?:\w+::)*~?\w+|operator\s*\S+)\s*\((.*)$/.exec(c);
    if (!m) continue;
    // A semicolon before any brace: a prototype or a statement, not a definition.
    const semi = m[4].indexOf(';');
    const brace = m[4].indexOf('{');
    if (semi >= 0 && (brace < 0 || semi < brace) && !(top?.kind === 'class' && d === top.depth + 1)) continue;
    const name = m[3].replace(/\s+/g, '');
    const typePart = m[1].trim();
    const simple = name.split('::').pop() ?? name;
    if (KEYWORDS.has(simple) || /^(return|else|case|goto|delete|new|throw|co_return|using|typedef|if|while|for|switch|do)\b/.test(typePart)) continue;
    const inClass = top?.kind === 'class' && d === top.depth + 1;
    if (!typePart && !name.includes('::') && !(inClass && (simple === top.name || simple === `~${top.name}`))) continue; // a macro call or a statement
    const end = endOf(sc, i, 4);
    const body = end > i || sc.opens[i].length > 0;
    if (!body && !inClass) continue; // a prototype: the definition is elsewhere
    symbols.push({ name: simple, kind: inClass || name.includes('::') ? 'method' : 'function', line: i + 1, end: end + 1, signature: sig(raw), exported: !/\bstatic\b/.test(typePart) || inClass, ...(inClass ? { parent: top.name } : name.includes('::') ? { parent: name.split('::').slice(-2, -1)[0] } : {}) });
  }
  return { symbols, imports };
}

// ---------- Markdown ----------

function extractMarkdown(lines: string[]): Extracted {
  const symbols: Sym[] = [];
  let fence = false;
  const heads: { i: number; level: number; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ i, level: m[1].length, name: m[2].slice(0, 120) });
  }
  heads.forEach((h, k) => {
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    symbols.push({ name: h.name, kind: 'heading', line: h.i + 1, end: next ? next.i : lines.length, signature: sig(lines[h.i]), exported: false });
  });
  return { symbols, imports: [] };
}

/** Symbols and imports of one file. */
export function extract(lang: Lang, text: string): Extracted {
  const lines = text.split(/\r?\n/);
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return extractJs(text.replace(/\r\n/g, '\n'), lines);
    case 'python':
      return extractPython(lines);
    case 'go':
      return extractGo(lines);
    case 'rust':
      return extractRust(lines);
    case 'java':
    case 'kotlin':
    case 'csharp':
      return extractJvm(lines, lang);
    case 'c':
    case 'cpp':
      return extractC(lines, lang);
    case 'markdown':
      return extractMarkdown(lines);
    default:
      return { symbols: [], imports: [] };
  }
}

// ---------- chunks for search ----------

export interface Chunk {
  start: number;
  end: number;
  symbol: string | null;
}

export const WINDOW_LINES = 60;
const MAX_CHUNK_LINES = 120;

/**
 * Splits a file into search chunks along symbol boundaries: each top-level function or class is a
 * chunk (with the comments just above it); a long class is split by its methods; everything else
 * goes in ~60-line windows. Chunks cover every line exactly once, in order.
 */
export function chunkLines(total: number, symbols: Sym[], lines: string[] = []): Chunk[] {
  const out: Chunk[] = [];
  const windows = (from: number, to: number, symbol: string | null) => {
    for (let s = from; s <= to; s += WINDOW_LINES) out.push({ start: s, end: Math.min(to, s + WINDOW_LINES - 1), symbol });
  };
  const isNote = (l: string | undefined) => l !== undefined && /^\s*(\/\/|\/\*|\*|#\[|#!|@\w|"""|'''|#(?!include|define|if|endif|else|pragma)|--)/.test(l);
  const place = (items: Sym[], from: number, to: number, label: string | null, nested: boolean) => {
    let pos = from;
    const sorted = items.filter((s) => s.line >= from && s.end <= to && s.end >= s.line).sort((a, b) => a.line - b.line);
    for (const s of sorted) {
      if (s.line < pos) continue; // inside the previous one
      let start = s.line;
      while (start - 1 >= pos && isNote(lines[start - 2])) start--;
      if (start > pos) windows(pos, start - 1, label);
      const size = s.end - start + 1;
      if (size <= MAX_CHUNK_LINES || nested) {
        if (size <= MAX_CHUNK_LINES) out.push({ start, end: s.end, symbol: s.parent ? `${s.parent}.${s.name}` : s.name });
        else windows(start, s.end, s.parent ? `${s.parent}.${s.name}` : s.name);
      } else {
        const kids = symbols.filter((k) => k.parent === s.name && k.line > s.line && k.end <= s.end);
        if (kids.length) place(kids, start, s.end, s.name, true);
        else windows(start, s.end, s.name);
      }
      pos = s.end + 1;
    }
    if (pos <= to) windows(pos, to, label);
  };
  const tops = symbols.filter((s) => !s.parent && s.kind !== 'heading' && s.end > s.line);
  const heads = symbols.filter((s) => s.kind === 'heading');
  if (heads.length && !tops.length) {
    // Markdown: one chunk per section (long ones in windows).
    let pos = 1;
    for (const h of heads) {
      if (h.line < pos) continue;
      if (h.line > pos) windows(pos, h.line - 1, null);
      const next = heads.find((x) => x.line > h.line);
      const end = next ? next.line - 1 : total;
      windows(h.line, end, h.name);
      pos = end + 1;
    }
    if (pos <= total) windows(pos, total, null);
  } else place(tops, 1, total, null, false);
  return out.filter((c) => c.end >= c.start);
}

/** Words of identifiers and paths for search: "readPdfFile" → "read pdf file", "snake_case" → "snake case". */
export function identWords(text: string, max = 400): string {
  const seen = new Set<string>();
  for (const id of text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) {
    if (id.length < 4) continue;
    for (const part of id.split('_')) {
      for (const w of part.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []) {
        const lw = w.toLowerCase();
        if (lw.length >= 3 && lw !== id.toLowerCase()) seen.add(lw);
        if (seen.size >= max) return [...seen].join(' ');
      }
    }
  }
  return [...seen].join(' ');
}
