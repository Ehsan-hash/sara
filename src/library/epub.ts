// Reads EPUB e-books. An EPUB is a zip: META-INF/container.xml names the package file (OPF),
// whose manifest lists the files and whose spine gives the reading order. Each spine document
// is XHTML, turned into text by html.ts; every chapter with text becomes one part.

import { type Block, blockText, htmlToText } from './html.ts';
import { resolvePath } from './ooxml.ts';
import type { DocPart, ReadResult } from './read.ts';
import { ReadError } from './read.ts';
import { attr, find, findAll, kids, parseXml, textOf } from './xml.ts';
import type { Zip } from './zip.ts';

export function readEpub(zip: Zip, opts: { signal?: AbortSignal } = {}): ReadResult {
  const warnings: string[] = [];
  const container = zip.text('META-INF/container.xml');
  let opfPath = container ? attr(find(parseXml(container), 'rootfile'), 'full-path') : undefined;
  if (!opfPath || !zip.has(opfPath)) opfPath = [...zip.entries.keys()].find((k) => k.toLowerCase().endsWith('.opf'));
  if (!opfPath) throw new ReadError('This e-book is missing its table of contents file, so it may be damaged.');
  const opf = parseXml(zip.text(opfPath) ?? '');
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = textOf(find(find(opf, 'metadata'), 'title')).replace(/\s+/g, ' ').trim() || undefined;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of findAll(find(opf, 'manifest'), 'item')) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (id && href) manifest.set(id, { href: resolvePath(dir, href.split('#')[0]), type: attr(item, 'media-type') ?? '', props: attr(item, 'properties') ?? '' });
  }
  let order: string[] = [];
  for (const ref of kids(find(opf, 'spine'), 'itemref')) {
    const m = manifest.get(attr(ref, 'idref') ?? '');
    if (m && !m.props.split(/\s+/).includes('nav')) order.push(m.href);
  }
  if (!order.length) {
    order = [...manifest.values()].filter((m) => /html/.test(m.type)).map((m) => m.href);
    if (order.length) warnings.push('This e-book has no reading order, so the chapters may be out of order.');
  }

  const parts: DocPart[] = [];
  const seen = new Set<string>();
  for (const href of order) {
    if (opts.signal?.aborted) throw new ReadError('Reading was stopped before it finished.');
    if (seen.has(href) || !zip.has(href)) continue;
    seen.add(href);
    const { blocks } = htmlToText(zip.text(href) ?? '');
    if (!blocks.length) continue;
    const head = blocks.find((b: Block) => b.level === 1 || b.level === 2) ?? blocks.find((b) => b.level);
    const text = blocks.map(blockText).join('\n\n');
    const where = `chapter ${parts.length + 1}`;
    parts.push(head ? { text, where, heading: head.text } : { text, where });
  }
  if (!parts.length) warnings.push('This e-book has no text in it (it may be all pictures).');
  return { kind: 'epub', title, parts, images: [], warnings };
}
