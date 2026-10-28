// A small, forgiving XML reader for the files inside Word, Excel, PowerPoint and EPUB
// documents. It understands elements, attributes, text, CDATA, comments, the five standard
// entities and numeric character references. It never expands DTD or custom entities, so a
// "billion laughs" file can't blow up memory. Broken markup is tolerated: unknown closing tags
// are ignored and anything left open at the end is closed for you.

import { ReadError } from './read.ts';

export interface XmlElement {
  name: string; // the full name, with any prefix ("w:p")
  local: string; // the name without its prefix ("p")
  attrs: Record<string, string>;
  children: XmlChild[];
}
export type XmlChild = XmlElement | string;

export interface XmlHandlers {
  open?: (name: string, attrs: Record<string, string>, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

const MAX_DEPTH = 1000;

/** Signals a handler wants to stop scanning early (used for row caps). */
export class StopScan extends Error {}

export function localName(name: string): string {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
}

/** Turns &amp; &lt; &#233; &#x2014; and friends back into characters. Unknown entities stay as written. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (all, e: string) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return validCodePoint(code) ? String.fromCodePoint(code) : all;
  });
}

function validCodePoint(code: number): boolean {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1]] = decodeEntities(value);
  }
  return attrs;
}

/** Walks the XML calling the handlers in document order (a "SAX" style scan). */
export function scanXml(src: string, h: XmlHandlers): void {
  let i = 0;
  const n = src.length;
  let depth = 0;
  try {
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) {
        if (h.text) h.text(decodeEntities(src.slice(i)));
        break;
      }
      if (lt > i && h.text) h.text(decodeEntities(src.slice(i, lt)));
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        i = end < 0 ? n : end + 3;
      } else if (src.startsWith('<![CDATA[', lt)) {
        const end = src.indexOf(']]>', lt + 9);
        if (h.text) h.text(src.slice(lt + 9, end < 0 ? n : end));
        i = end < 0 ? n : end + 3;
      } else if (src[lt + 1] === '?') {
        const end = src.indexOf('?>', lt + 2);
        i = end < 0 ? n : end + 2;
      } else if (src[lt + 1] === '!') {
        // <!DOCTYPE ...> possibly with an internal [ ... ] subset. Skipped, never expanded.
        let j = lt + 2;
        let bracket = 0;
        for (; j < n; j++) {
          const c = src[j];
          if (c === '[') bracket++;
          else if (c === ']') bracket--;
          else if (c === '>' && bracket <= 0) break;
        }
        i = j + 1;
      } else if (src[lt + 1] === '/') {
        const end = src.indexOf('>', lt + 2);
        const name = src.slice(lt + 2, end < 0 ? n : end).trim();
        if (depth > 0) depth--;
        if (h.close) h.close(name);
        i = end < 0 ? n : end + 1;
      } else {
        // Find the end of the tag, skipping over quoted attribute values.
        let j = lt + 1;
        let quote = '';
        for (; j < n; j++) {
          const c = src[j];
          if (quote) {
            if (c === quote) quote = '';
          } else if (c === '"' || c === "'") quote = c;
          else if (c === '>') break;
        }
        let body = src.slice(lt + 1, j);
        const selfClosing = body.endsWith('/');
        if (selfClosing) body = body.slice(0, -1);
        const sp = body.search(/[\s]/);
        const name = sp < 0 ? body : body.slice(0, sp);
        if (!name || /^[\s<]/.test(name)) {
          // A stray "<" in text: keep it as text.
          if (h.text) h.text('<');
          i = lt + 1;
          continue;
        }
        const attrs = sp < 0 ? {} : parseAttrs(body.slice(sp + 1));
        if (!selfClosing && ++depth > MAX_DEPTH) {
          throw new ReadError('This document is nested too deeply to read safely. It may be damaged.');
        }
        if (h.open) h.open(name, attrs, selfClosing);
        if (selfClosing && h.close) h.close(name);
        i = j + 1;
      }
    }
  } catch (err) {
    if (err instanceof StopScan) return;
    throw err;
  }
}

/** Builds a tree. The returned root is a pseudo-element named "#document". */
export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  scanXml(src, {
    open(name, attrs, selfClosing) {
      const el: XmlElement = { name, local: localName(name), attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
    },
    close(name) {
      if (stack.length <= 1) return;
      if (stack[stack.length - 1].name === name) {
        stack.pop();
        return;
      }
      // Mismatched close: pop back to the matching open tag if there is one, else ignore it.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          return;
        }
      }
    },
    text(t) {
      const top = stack[stack.length - 1];
      const last = top.children[top.children.length - 1];
      if (typeof last === 'string') top.children[top.children.length - 1] = last + t;
      else top.children.push(t);
    },
  });
  return root;
}

/** Child elements with this local name (or all child elements when no name is given). */
export function kids(el: XmlElement | undefined, local?: string): XmlElement[] {
  if (!el) return [];
  const out: XmlElement[] = [];
  for (const c of el.children) if (typeof c !== 'string' && (!local || c.local === local)) out.push(c);
  return out;
}

export function kid(el: XmlElement | undefined, local: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (typeof c !== 'string' && c.local === local) return c;
  return undefined;
}

/** The first descendant with this local name, searching depth-first in document order. */
export function find(el: XmlElement | undefined, local: string): XmlElement | undefined {
  if (!el) return undefined;
  const stack: XmlElement[] = [el];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur !== el && cur.local === local) return cur;
    for (let i = cur.children.length - 1; i >= 0; i--) {
      const c = cur.children[i];
      if (typeof c !== 'string') stack.push(c);
    }
  }
  return undefined;
}

export function findAll(el: XmlElement | undefined, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  if (!el) return out;
  const stack: XmlElement[] = [el];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur !== el && cur.local === local) out.push(cur);
    for (let i = cur.children.length - 1; i >= 0; i--) {
      const c = cur.children[i];
      if (typeof c !== 'string') stack.push(c);
    }
  }
  return out;
}

/** All the text inside an element, joined as-is. */
export function textOf(el: XmlElement | undefined): string {
  if (!el) return '';
  let out = '';
  const stack: XmlChild[] = [el];
  while (stack.length) {
    const cur = stack.pop()!;
    if (typeof cur === 'string') {
      out += cur;
      continue;
    }
    for (let i = cur.children.length - 1; i >= 0; i--) stack.push(cur.children[i]);
  }
  return out;
}

/** Reads an attribute by local name, ignoring its prefix ("w:val" matches "val"). */
export function attr(el: XmlElement | undefined, local: string): string | undefined {
  if (!el) return undefined;
  if (local in el.attrs) return el.attrs[local];
  for (const k of Object.keys(el.attrs)) if (localName(k) === local) return el.attrs[k];
  return undefined;
}
