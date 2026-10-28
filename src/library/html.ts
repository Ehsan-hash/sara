// Turns web pages (and EPUB chapters, which are XHTML) into plain text blocks. Scripts, styles,
// navigation and other non-reading parts are dropped; block elements become paragraph breaks;
// h1-h6 become Markdown-style headings; list items get a dash; table cells are joined by " | ".
// Also holds the shared helper that groups blocks into parts by heading.

import type { DocPart } from './read.ts';

export interface Block {
  text: string;
  level?: number; // heading level 1-6, when this block is a heading
}

export interface HtmlText {
  title?: string;
  blocks: Block[];
}

// Elements whose content is never part of the reading text.
const SKIP = new Set(['script', 'style', 'nav', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'canvas', 'select', 'button', 'footer']);
// Elements that start a new paragraph.
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'aside', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'figcaption', 'address', 'hr', 'body', 'html', 'details', 'summary',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'center', 'fieldset', 'legend',
]);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);

const NAMED: Record<string, string> = {
  nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', bull: '•',
  middot: '·', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', para: '¶', sect: '§',
  cent: '¢', pound: '£', yen: '¥', euro: '€', curren: '¤', iexcl: '¡', iquest: '¿', szlig: 'ß', aelig: 'æ',
  AElig: 'Æ', oelig: 'œ', OElig: 'Œ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', ccedil: 'ç', Ccedil: 'Ç',
  eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', minus: '−', le: '≤', ge: '≥',
  ne: '≠', asymp: '≈', infin: '∞', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009', not: '¬', ordf: 'ª', ordm: 'º', macr: '¯', acute: '´', cedil: '¸', uml: '¨', brvbar: '¦',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', sigma: 'σ', mu: 'μ', lambda: 'λ', omega: 'ω', Omega: 'Ω',
  hearts: '♥', check: '✓', star: '☆', quest: '?', excl: '!', num: '#', dollar: '$', percnt: '%', lpar: '(',
  rpar: ')', ast: '*', plus: '+', comma: ',', period: '.', sol: '/', colon: ':', semi: ';', equals: '=', commat: '@',
  lsqb: '[', rsqb: ']', bsol: '\\', lowbar: '_', grave: '`', lcub: '{', rcub: '}', verbar: '|', tilde: '~', Tab: '\t',
  NewLine: '\n',
};
// Accented letters: &eacute; &Uuml; &ntilde; ... built from a base letter plus a combining mark.
const MARKS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', ring: '\u030a', cedil: '\u0327', caron: '\u030c', macr: '\u0304' };

function namedEntity(name: string): string | undefined {
  if (name in NAMED) return NAMED[name];
  const m = /^([a-zA-Z])(acute|grave|circ|uml|tilde|ring|cedil|caron|macr)$/.exec(name);
  if (m) return (m[1] + MARKS[m[2]]).normalize('NFC');
  return undefined;
}

export function decodeHtmlEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (all, e: string) => {
    if (e[0] === '#') {
      let code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (code >= 0x80 && code <= 0x9f) code = CP1252_C1[code - 0x80] || code; // browsers treat these as Windows-1252
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all;
      return String.fromCodePoint(code);
    }
    const v = namedEntity(e);
    return v ?? all;
  });
}

const CP1252_C1 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

// hidden, aria-hidden="true" or style="display:none" mean the reader never sees it.
function isHidden(tagSrc: string): boolean {
  if (/\saria-hidden\s*=\s*["']?true/i.test(tagSrc) || /display\s*:\s*none/i.test(tagSrc)) return true;
  return /\shidden(?=[\s/>=])/i.test(tagSrc.replace(/"[^"]*"|'[^']*'/g, '""'));
}

/** Converts HTML (or XHTML) markup into a title and reading-order text blocks. */
export function htmlToText(html: string): HtmlText {
  const blocks: Block[] = [];
  let title: string | undefined;
  let cur = '';
  let level: number | undefined;
  let skipDepth = 0;
  let skipTag = '';
  let pre = 0;
  let inTitle = false;
  let titleText = '';
  let cellIndex = 0;

  const flush = (): void => {
    const text = (pre ? cur.replace(/^\n+|\s+$/g, '') : cur.replace(/[ \t\r\f\u00a0]*\n[ \t\r\f\u00a0]*/g, '\n').replace(/[ \t\r\f]+/g, ' ').trim())
      .replace(/\u00ad/g, '');
    if (text) blocks.push(level ? { text: text.replace(/\s+/g, ' '), level } : { text });
    cur = '';
    level = undefined;
  };

  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const raw = html.slice(i, textEnd);
      if (inTitle) titleText += raw;
      else if (!skipDepth) {
        const t = decodeHtmlEntities(raw);
        cur += pre ? t : t.replace(/[\s]+/g, ' ');
      }
    }
    if (lt < 0) break;
    // Comments, CDATA, doctype and processing instructions.
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const e = html.indexOf(']]>', lt + 9);
      if (!skipDepth) cur += html.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const e = html.indexOf('>', lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) {
      if (!skipDepth && !inTitle) cur += '<';
      i = lt + 1;
      continue;
    }
    // Find the end of the tag, respecting quoted attributes.
    let j = lt + m[0].length;
    let quote = '';
    for (; j < n; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const tagSrc = html.slice(lt, j + 1);
    i = j + 1;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase().replace(/^[a-z0-9]+:/, '');
    const selfClosing = tagSrc.endsWith('/>');

    if (skipDepth) {
      if (tag === skipTag) {
        if (closing) skipDepth--;
        else if (!selfClosing) skipDepth++;
      }
      continue;
    }
    if (tag === 'title' && !closing && !selfClosing) {
      inTitle = true;
      titleText = '';
      continue;
    }
    if (tag === 'title' && closing) {
      inTitle = false;
      if (title === undefined) title = decodeHtmlEntities(titleText).replace(/\s+/g, ' ').trim() || undefined;
      continue;
    }
    if (inTitle) continue;
    if (!closing && (tag === 'script' || tag === 'style')) {
      // Raw text elements: jump straight to the closing tag.
      const e = html.toLowerCase().indexOf('</' + tag, i);
      i = e < 0 ? n : html.indexOf('>', e) + 1 || n;
      continue;
    }
    if (!closing && SKIP.has(tag) && !selfClosing) {
      skipDepth = 1;
      skipTag = tag;
      continue;
    }
    if (!closing && !VOID.has(tag) && !selfClosing && isHidden(tagSrc)) {
      skipDepth = 1;
      skipTag = tag;
      continue;
    }
    if (tag === 'br') {
      cur += '\n';
      continue;
    }
    if (tag === 'img' && !closing) {
      const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tagSrc);
      const a = alt ? decodeHtmlEntities(alt[1] ?? alt[2] ?? '').trim() : '';
      if (a) cur += ` [image: ${a}] `;
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (!closing) {
        if (cellIndex > 0) cur += ' | ';
        cellIndex++;
      }
      continue;
    }
    if (tag === 'pre') {
      flush();
      pre = closing ? Math.max(0, pre - 1) : pre + 1;
      continue;
    }
    if (BLOCK.has(tag)) {
      if (tag === 'tr') cellIndex = 0;
      flush();
      if (!closing) {
        const h = /^h([1-6])$/.exec(tag);
        if (h) level = Number(h[1]);
        if (tag === 'li') cur = '- ';
      }
      continue;
    }
  }
  flush();
  // Drop list dashes left on their own (an <li> that only held a nested list).
  return { title, blocks: blocks.filter((b) => b.text !== '-') };
}

/** Writes a block as text, with "# " style prefixes for headings. */
export function blockText(b: Block): string {
  return b.level ? '#'.repeat(b.level) + ' ' + b.text : b.text;
}

/**
 * Groups blocks into parts: a new part starts at every level 1-2 heading (and at level 3 once the
 * current part is getting long), and very long stretches are split at paragraph boundaries.
 */
export function blocksToParts(blocks: Block[], where = '', maxPart = 30_000): DocPart[] {
  const parts: DocPart[] = [];
  let buf: string[] = [];
  let size = 0;
  let heading: string | undefined;
  let partHeading: string | undefined;
  const push = (): void => {
    const text = buf.join('\n\n').trim();
    if (text) parts.push(partHeading ? { text, where, heading: partHeading } : { text, where });
    buf = [];
    size = 0;
    partHeading = heading;
  };
  for (const b of blocks) {
    if (b.level && (b.level <= 2 || (b.level === 3 && size > 4000)) && size > 0) {
      heading = b.text;
      push();
    }
    if (b.level && b.level <= 3) {
      heading = b.text;
      if (size === 0) partHeading = b.text;
    }
    const t = blockText(b);
    if (size > 0 && size + t.length > maxPart) push();
    // A single block longer than a part is cut into pieces.
    if (t.length > maxPart) {
      for (let k = 0; k < t.length; k += maxPart) {
        buf.push(t.slice(k, k + maxPart));
        size += maxPart;
        push();
      }
      continue;
    }
    buf.push(t);
    size += t.length + 2;
  }
  push();
  return parts;
}
