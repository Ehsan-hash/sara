import { normalize } from './text.js';

export function slugify(text, opts = {}) {
  const sep = opts.separator ?? '-';
  return normalize(text).trim().replace(/\s+/g, sep);
}

export function uniqueSlug(text, taken, opts = {}) {
  const base = slugify(text, opts);
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}
