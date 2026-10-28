// Phase 50: the code tools: code_map (an outline), code_find (symbols, words, meaning),
// code_refs (where a name is defined and used) and code_deps (what a file imports and what imports
// it). All read-only and small on purpose: a few lines per hit with file:line, and a hint for more.
import { join, posix } from 'node:path';
import { num, str, ToolError, type Tool } from '../tools/types.ts';
import type { CodeMaps } from './index.ts';
import type { CodeMapStore, FileRow, SymbolRow, TextHit } from './store.ts';
import { normRel } from './store.ts';
import { isPlainFileInside, readTextInside } from './safe-read.ts';

/** How long a code tool waits for the map to finish building (in steps; the server keeps running). */
const WAIT_MS = 8000;
const PAGE = 10;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const kindShort: Record<string, string> = { function: 'fn', method: 'method', class: 'class', interface: 'interface', type: 'type', const: 'const', struct: 'struct', enum: 'enum', trait: 'trait', impl: 'impl', heading: '#', constructor: 'ctor', macro: 'macro' };
const symLabel = (s: SymbolRow) => `${kindShort[s.kind] ?? s.kind} ${s.parent ? `${s.parent}.` : ''}${s.name}`;

/** Reads a small workspace file, never through a link and never outside the workspace ('' if refused). */
function readSmall(root: string, path: string, max = 20_000): string {
  return readTextInside(root, path, max, 2_000_000);
}

/** package.json scripts and main, Python/Rust/Go entry points, Makefile targets, README's first lines. */
export function entryPoints(root: string, dir: string, store: CodeMapStore): string[] {
  const at = (f: string) => join(root, dir, f);
  const out: string[] = [];
  const pkg = readSmall(root, at('package.json'));
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as { name?: string; main?: string; module?: string; bin?: string | Record<string, string>; scripts?: Record<string, string> };
      const scripts = Object.entries(j.scripts ?? {}).slice(0, 8).map(([k, v]) => `${k}=${v.length > 60 ? `${v.slice(0, 57)}…` : v}`);
      const bin = typeof j.bin === 'string' ? j.bin : Object.values(j.bin ?? {}).join(', ');
      out.push(`package.json${j.name ? ` "${j.name}"` : ''}${j.main ? ` · main ${j.main}` : ''}${j.module ? ` · module ${j.module}` : ''}${bin ? ` · bin ${bin}` : ''}${scripts.length ? ` · scripts: ${scripts.join('; ')}` : ''}`);
    } catch {
      out.push('package.json (not valid JSON)');
    }
  }
  const py = readSmall(root, at('pyproject.toml'));
  if (py) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(py)?.[1];
    const scripts = /\[project\.scripts\]([\s\S]*?)(\n\[|$)/.exec(py)?.[1].trim().split('\n').slice(0, 4).join('; ');
    out.push(`pyproject.toml${name ? ` "${name}"` : ''}${scripts ? ` · scripts: ${scripts}` : ''}`);
  }
  const cargo = readSmall(root, at('Cargo.toml'));
  if (cargo) out.push(`Cargo.toml "${/^\s*name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? '?'}"${isPlainFileInside(root, at('src/main.rs')) ? ' · src/main.rs' : ''}${isPlainFileInside(root, at('src/lib.rs')) ? ' · src/lib.rs' : ''}`);
  const gomod = readSmall(root, at('go.mod'));
  if (gomod) out.push(`go.mod ${/^module\s+(\S+)/m.exec(gomod)?.[1] ?? ''}`);
  const make = readSmall(root, at('Makefile'));
  if (make) {
    const targets = [...make.matchAll(/^([\w.-]+):(?!=)/gm)].map((m) => m[1]).filter((t) => !t.startsWith('.')).slice(0, 8);
    if (targets.length) out.push(`Makefile targets: ${targets.join(', ')}`);
  }
  // Programs: Go/Rust/C main functions, Python __main__ guards.
  const mains = (store.db.prepare("SELECT f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name = 'main' AND s.kind = 'function' AND (? = '' OR f.path LIKE ? || '%') ORDER BY f.path LIMIT 6").all(dir, dir ? `${dir}/` : '') as { path: string }[]).map((r) => r.path);
  if (mains.length) out.push(`main(): ${mains.join(', ')}`);
  for (const name of ['README.md', 'README', 'readme.md', 'README.rst', 'README.txt']) {
    const t = readSmall(root, at(name), 4000);
    if (!t) continue;
    const lines = t
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim())
      .filter((l) => l && !/^(\[!\[|<|!\[|---|===)/.test(l))
      .slice(0, 3);
    if (lines.length) out.push(`${name}: ${lines.join(' / ').slice(0, 240)}`);
    break;
  }
  return out;
}

/** The outline: folders with file and symbol counts, entry points, the most-imported files and their top symbols. */
export function outline(store: CodeMapStore, path = '', depth = 2): string {
  const st = store.status();
  const all = store.files();
  const rel = normRel(path);
  if (rel) {
    const exact = store.findPath(rel);
    if (exact.path && all.some((f) => f.path === exact.path)) return fileOutline(store, exact.path);
  }
  const files = rel ? all.filter((f) => f.path.startsWith(`${rel}/`)) : all;
  if (!files.length) {
    if (rel) {
      const c = store.findPath(rel).candidates;
      return c.length ? `No folder "${rel}". Did you mean: ${c.slice(0, 5).join(', ')}?` : `Nothing mapped under "${rel}". Try code_map with no path.`;
    }
    return 'The workspace has no source files yet.';
  }
  const imported = store.importCounts();
  const langs = new Map<string, number>();
  for (const f of files) langs.set(f.lang, (langs.get(f.lang) ?? 0) + 1);
  const symCount = files.reduce((n, f) => n + f.symbols, 0);
  const lines: string[] = [];
  lines.push(`${rel ? `${rel}/` : 'Workspace'}: ${files.length} files (${[...langs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${n} ${l}`).join(', ')}), ${symCount} symbols${st.building ? ' (map still updating)' : ''}${st.truncated ? ' (big workspace: first 20,000 files mapped)' : ''}`);
  const entries = entryPoints(store.root, rel, store);
  if (entries.length) lines.push('Entry points:', ...entries.map((e) => `- ${e}`));
  // Folder tree to the depth asked.
  const base = rel ? rel.split('/').length : 0;
  const folders = new Map<string, { files: number; symbols: number }>();
  const rootFiles: FileRow[] = [];
  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length - 1 === base) rootFiles.push(f);
    for (let d = base + 1; d <= Math.min(parts.length - 1, base + depth); d++) {
      const k = parts.slice(0, d).join('/');
      const v = folders.get(k) ?? { files: 0, symbols: 0 };
      v.files++;
      v.symbols += f.symbols;
      folders.set(k, v);
    }
  }
  const tree = [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (tree.length) {
    lines.push('Folders (files · symbols):');
    const shown = tree.slice(0, 40);
    for (const [k, v] of shown) lines.push(`${'  '.repeat(k.split('/').length - base - 1)}${k}/ (${v.files} · ${v.symbols})`);
    if (tree.length > shown.length) lines.push(`  … ${tree.length - shown.length} more folders (code_map path="<folder>" to look inside)`);
  }
  if (rootFiles.length) {
    const shown = rootFiles.sort((a, b) => (imported.get(b.path) ?? 0) - (imported.get(a.path) ?? 0) || b.symbols - a.symbols).slice(0, rel ? 25 : 12);
    lines.push(`Files here: ${shown.map((f) => `${posix.basename(f.path)} (${f.symbols})`).join(', ')}${rootFiles.length > shown.length ? `, … ${rootFiles.length - shown.length} more` : ''}`);
  }
  const key = files.filter((f) => imported.has(f.path)).sort((a, b) => (imported.get(b.path) ?? 0) - (imported.get(a.path) ?? 0)).slice(0, 8);
  if (key.length) lines.push(`Most imported: ${key.map((f) => `${f.path} (${imported.get(f.path)})`).join(', ')}`);
  const top: string[] = [];
  for (const f of key.slice(0, 5)) {
    const syms = store.symbolsIn(f.path).filter((s) => s.exported && !s.parent && s.kind !== 'heading').slice(0, 5);
    if (syms.length) top.push(`- ${f.path}: ${syms.map((s) => `${s.name} (${kindShort[s.kind] ?? s.kind} L${s.line})`).join(', ')}`);
  }
  if (top.length) lines.push('Key symbols:', ...top);
  lines.push(`More: code_map path="<folder or file>" · code_find query="…" · code_refs symbol="…" · code_deps file="…"`);
  return lines.join('\n');
}

function fileOutline(store: CodeMapStore, path: string): string {
  const f = store.files().find((x) => x.path === path)!;
  const syms = store.symbolsIn(path);
  const d = store.deps(path);
  const lines = [`${path} (${f.lang}, ${f.lines} lines, ${fmtSize(f.size)}): ${syms.length} symbols`];
  const shown = syms.slice(0, 60);
  for (const s of shown) lines.push(`  L${s.line}${s.end > s.line ? `-${s.end}` : ''} ${symLabel(s)}${s.exported ? ' (exported)' : ''}`);
  if (syms.length > shown.length) lines.push(`  … ${syms.length - shown.length} more (read_file with offset to see them)`);
  if (d.imports.length) lines.push(`Imports: ${d.imports.slice(0, 20).map((i) => i.resolved ?? i.spec).join(', ')}${d.imports.length > 20 ? ', …' : ''}`);
  if (d.importedBy.length) lines.push(`Imported by: ${d.importedBy.slice(0, 15).map((i) => i.path).join(', ')}${d.importedBy.length > 15 ? `, … ${d.importedBy.length - 15} more (code_deps)` : ''}`);
  return lines.join('\n');
}

const hitLine = (h: TextHit) => `${h.path}:${h.line}${h.symbol ? `  [${h.symbol}]` : ''}  ${h.snippet}`;

export async function codeFind(maps: CodeMaps, store: CodeMapStore, query: string, kind: string, page = 0): Promise<string> {
  const offset = page * PAGE;
  const ident = /^[\w$.:#]+(\(\))?$/.test(query) && !/^\d+$/.test(query);
  const mode = kind === 'symbol' || kind === 'text' || kind === 'meaning' ? kind : ident ? 'symbol' : maps.target ? 'meaning' : 'text';
  const out: string[] = [];
  const more = (n: number, k: string) => (n > offset + PAGE ? `(more: code_find query="${query}" kind="${k}" page=${page + 1})` : '');
  if (mode === 'symbol') {
    const r = store.findSymbols(query, PAGE, offset);
    if (r.hits.length) {
      out.push(`Symbols matching "${query}" (${r.total}):`, ...r.hits.map((s) => `${s.path}:${s.line}  ${symLabel(s)}  — ${s.signature}`));
      const m = more(r.total, 'symbol');
      if (m) out.push(m);
      return out.join('\n');
    }
    if (kind === 'symbol') return `No symbol named like "${query}". Try kind="text" for any mention.`;
  }
  let hits: TextHit[];
  let note = '';
  if (mode === 'meaning') {
    if (!maps.target) note = "(Meaning search isn't set up: the Meaning search job in Settings → Which model does what. Word search used.)\n";
    hits = maps.target ? await store.findMeaning(maps.target, query, PAGE + 1, offset) : store.findWords(query, PAGE + 1, offset);
    if (maps.target && !hits.some((h) => h.by !== 'words') && !note) note = '(No meaning matches yet: vectors may still be in the making. Word matches shown.)\n';
  } else hits = store.findWords(query, PAGE + 1, offset);
  if (!hits.length) return `${note}Nothing found for "${query}". Try other words, kind="symbol" for a name, or code_map for the layout.`;
  const shown = hits.slice(0, PAGE);
  return `${note}${shown.map(hitLine).join('\n')}${hits.length > PAGE ? `\n(more: code_find query="${query}" kind="${mode}" page=${page + 1})` : ''}`;
}

export function codeRefs(store: CodeMapStore, symbol: string): string {
  const name = symbol.trim();
  const r = store.refs(name, 30);
  if (!r.defs.length && !r.total) return `"${name}" isn't defined or used in the mapped files. Check the spelling with code_find query="${name}".`;
  const lines: string[] = [];
  if (r.defs.length) lines.push(`Defined: ${r.defs.slice(0, 6).map((d) => `${d.path}:${d.line} ${symLabel(d)}${d.exported ? ' (exported)' : ''}`).join('; ')}${r.defs.length > 6 ? ` … ${r.defs.length - 6} more` : ''}`);
  else lines.push(`No definition found in the map (it may come from a library).`);
  if (r.total) {
    lines.push(`Used ${r.total} time${r.total === 1 ? '' : 's'} in ${r.files} file${r.files === 1 ? '' : 's'}:`);
    for (const u of r.uses) lines.push(`${u.path}:${u.line}  ${u.text}`);
    if (r.total > r.uses.length) lines.push(`… ${r.total - r.uses.length} more (search for them with the search tool, or code_deps on the defining file)`);
  } else lines.push('No uses found outside its definition.');
  const defFiles = [...new Set(r.defs.map((d) => d.path))].slice(0, 3);
  for (const f of defFiles) {
    const by = store.deps(f).importedBy.filter((i) => !i.names || new RegExp(`(^|[^\\w$])${name.split(/[.:#]/).pop()!.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(i.names) || /\*/.test(i.names));
    if (by.length) lines.push(`${f} is imported (with this name) by: ${by.slice(0, 12).map((b) => b.path).join(', ')}${by.length > 12 ? ', …' : ''}`);
  }
  return lines.join('\n');
}

export function codeDeps(store: CodeMapStore, file: string): string {
  const p = store.findPath(file);
  if (!p.path) return p.candidates.length ? `Which file? ${p.candidates.slice(0, 8).join(', ')}` : `"${file}" isn't in the map (code_map shows what is).`;
  const d = store.deps(p.path);
  const inside = d.imports.filter((i) => i.resolved);
  const outside = d.imports.filter((i) => !i.resolved);
  const lines = [`${p.path}`];
  lines.push(inside.length ? `Imports from this workspace (${inside.length}): ${inside.map((i) => `${i.resolved} (L${i.line})`).join(', ')}` : 'Imports nothing from this workspace.');
  if (outside.length) lines.push(`Other imports (${outside.length}): ${[...new Set(outside.map((i) => i.spec))].slice(0, 25).join(', ')}${outside.length > 25 ? ', …' : ''}`);
  lines.push(d.importedBy.length ? `Imported by (${d.importedBy.length}): ${d.importedBy.slice(0, 30).map((i) => `${i.path}:${i.line}`).join(', ')}${d.importedBy.length > 30 ? `, … ${d.importedBy.length - 30} more` : ''}` : 'Nothing in the workspace imports it.');
  return lines.join('\n');
}

/** Brings the map of the conversation's workspace up to date (briefly) and returns it. */
async function mapFor(maps: () => CodeMaps | undefined, dir: string): Promise<{ maps: CodeMaps; store: CodeMapStore; note: string }> {
  const m = maps();
  if (!m) throw new ToolError('The code map is not available here.');
  const r = await m.until(dir, WAIT_MS);
  const note = r.done ? '' : `(The map is still being built: ${r.store.status().files} files so far. Results may be incomplete; try again in a moment.)\n`;
  return { maps: m, store: r.store, note };
}

export function createCodeTools(maps: () => CodeMaps | undefined): Tool[] {
  const available = () => Boolean(maps());
  return [
    {
      defaultPermission: 'auto',
      isAvailable: available,
      spec: {
        name: 'code_map',
        description:
          'An outline of the code in your workspace: folders with file and symbol counts, entry points (package.json scripts, main files, README), the most-imported files and their key functions and classes. Give a folder to look inside it, or a file to list its functions, classes and imports with line numbers. Start unfamiliar work here instead of reading many files.',
        parameters: obj({ path: { type: 'string', description: 'Optional folder or file, e.g. "src/library" or "src/chat.ts". Default: the whole workspace.' }, depth: { type: 'integer', description: 'Folder levels to show (1-4, default 2).' } }),
      },
      summarize: (a) => `code map${a.path ? ` of ${String(a.path)}` : ''}`,
      async run(args, ctx) {
        const { store, note } = await mapFor(maps, ctx.workspaceDir);
        return note + outline(store, str(args, 'path', false), Math.min(4, Math.max(1, Math.floor(num(args, 'depth', 2)))));
      },
    },
    {
      defaultPermission: 'auto',
      isAvailable: available,
      spec: {
        name: 'code_find',
        description:
          "Find code in your workspace. kind 'symbol' finds functions, classes, methods and types by name; 'text' finds code with these words; 'meaning' finds code that does what you describe (e.g. 'where the owner token is checked'). Default: 'symbol' for a single name, else 'meaning' (or 'text'). Returns file:line with a short snippet.",
        parameters: obj(
          {
            query: { type: 'string', description: 'A name (runTurn, Store.save) or words describing the code.' },
            kind: { type: 'string', enum: ['symbol', 'text', 'meaning'] },
            page: { type: 'integer', description: 'For more results: 1, 2, …' },
          },
          ['query'],
        ),
      },
      summarize: (a) => `find code “${String(a.query ?? '').slice(0, 60)}”${a.kind ? ` (${String(a.kind)})` : ''}`,
      async run(args, ctx) {
        const query = str(args, 'query').trim().slice(0, 300);
        const { maps: m, store, note } = await mapFor(maps, ctx.workspaceDir);
        return note + (await codeFind(m, store, query, str(args, 'kind', false), Math.max(0, Math.floor(num(args, 'page', 0)))));
      },
    },
    {
      defaultPermission: 'auto',
      isAvailable: available,
      spec: {
        name: 'code_refs',
        description: 'Where a function, class, method or variable is defined and every place that uses it (file:line and the line), plus which files import it. Use before renaming or changing how something is called.',
        parameters: obj({ symbol: { type: 'string', description: 'The name, e.g. disclosureText or Store.addMessage.' } }, ['symbol']),
      },
      summarize: (a) => `who uses ${String(a.symbol ?? '').slice(0, 60)}`,
      async run(args, ctx) {
        const { store, note } = await mapFor(maps, ctx.workspaceDir);
        return note + codeRefs(store, str(args, 'symbol').slice(0, 120));
      },
    },
    {
      defaultPermission: 'auto',
      isAvailable: available,
      spec: {
        name: 'code_deps',
        description: 'What a file imports (inside the workspace and outside) and which files import it.',
        parameters: obj({ file: { type: 'string', description: 'A file path, e.g. src/chat.ts (a unique file name alone also works).' } }, ['file']),
      },
      summarize: (a) => `imports of ${String(a.file ?? '').slice(0, 80)}`,
      async run(args, ctx) {
        const { store, note } = await mapFor(maps, ctx.workspaceDir);
        return note + codeDeps(store, str(args, 'file'));
      },
    },
  ];
}

/** Tools whose use means files in the workspace may have changed (the map looks again). */
export const CHANGES_FILES = (name: string) => name === 'write_file' || name === 'edit_file' || name === 'shell' || name.startsWith('git_') || name === 'delegate_task' || name === 'apply_patch';
