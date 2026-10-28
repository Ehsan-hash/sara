import { normalize } from './text.js';

function trimSep(s, sep) {
  while (s.startsWith(sep)) s = s.slice(sep.length);
  while (s.endsWith(sep)) s = s.slice(0, -sep.length);
  return s;
}

export function slugify(text, opts = {}) {
  const sep = opts.separator ?? '-';
  const max = opts.maxLength ?? 60;
  let s = trimSep(normalize(text).replace(/[^a-z0-9]+/g, sep), sep);
  if (max && s.length > max) {
    let cut = s.slice(0, max);
    if (!s.startsWith(sep, max)) {
      const at = cut.lastIndexOf(sep);
      if (at > 0) cut = cut.slice(0, at);
    }
    s = trimSep(cut, sep);
  }
  return s;
}

export function uniqueSlug(text, taken, opts = {}) {
  const base = slugify(text, opts);
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}
