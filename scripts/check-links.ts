// Phase 54: link checker for the Markdown docs. Every relative link and picture in every .md file
// must point at a file or folder that exists in the checked tree, and a #section must match a
// heading in the target file. Web addresses are not fetched (no network). Run it on the public
// copy so links to private files (left out of the public repository) show up as broken:
//   node scripts/public-export.ts && node scripts/check-links.ts outputs/public-export
//   node scripts/check-links.ts            (this checkout)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './build-docs.ts';

export interface Broken {
  file: string;
  line: number;
  link: string;
  why: string;
}

/** Links and pictures in Markdown (inline links, images, and src/href in inline HTML), outside code. */
export function linksIn(md: string): { line: number; href: string }[] {
  const out: { line: number; href: string }[] = [];
  let fence: string | undefined;
  md.split('\n').forEach((raw, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = undefined;
      return;
    }
    if (fence) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ line: i + 1, href: m[1] });
    for (const m of line.matchAll(/\b(?:src|href)="([^"]+)"/g)) out.push({ line: i + 1, href: m[1] });
  });
  return out;
}

/** Heading anchors of a Markdown file (GitHub style, numbered when repeated). */
export function anchorsOf(md: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const l of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (!h) continue;
    const base = slug(h[1].replace(/`/g, ''));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

function mdFiles(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || (dir === root && e.name === 'outputs')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(root, p));
    else if (/\.md$/i.test(e.name)) out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

export function checkLinks(root: string, files = mdFiles(root)): Broken[] {
  const broken: Broken[] = [];
  const cache = new Map<string, Set<string>>();
  const anchors = (f: string) => {
    if (!cache.has(f)) cache.set(f, anchorsOf(readFileSync(join(root, f), 'utf8')));
    return cache.get(f)!;
  };
  for (const file of files) {
    const md = readFileSync(join(root, file), 'utf8');
    for (const { line, href } of linksIn(md)) {
      if (/^(https?:|mailto:|data:|tel:)/i.test(href)) continue;
      if (href.startsWith('/')) continue; // in-app links (e.g. /#view=settings) and site-absolute paths
      const [path, hash] = href.split('#');
      let target = file;
      if (path) {
        target = posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(path)));
        if (target.startsWith('..')) {
          broken.push({ file, line, link: href, why: 'points outside the repository' });
          continue;
        }
        const abs = join(root, target);
        if (!existsSync(abs)) {
          broken.push({ file, line, link: href, why: 'no such file' });
          continue;
        }
        if (statSync(abs).isDirectory()) continue;
      }
      if (hash && /\.md$/i.test(target) && !anchors(target).has(hash.toLowerCase())) broken.push({ file, line, link: href, why: `no heading #${hash} in ${target}` });
    }
  }
  return broken;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = resolve(process.argv[2] ?? ROOT);
  const files = mdFiles(root);
  const broken = checkLinks(root, files);
  for (const b of broken) console.log(`BROKEN ${b.file}:${b.line} ${b.link} (${b.why})`);
  console.log(`${files.length} Markdown files checked in ${root}: ${broken.length ? `${broken.length} broken link(s).` : 'every relative link resolves.'}`);
  process.exit(broken.length ? 1 : 0);
}
