import { HttpError } from '../http/errors.js';

const bad = (message) => new HttpError(400, 'invalid', message);

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Expected a JSON object.');
  return body;
}

export function requireString(body, key, { min = 1, max = 1000 } = {}) {
  const v = body[key];
  if (typeof v !== 'string') throw bad(`${key} must be a string.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${key} must be ${min} to ${max} characters.`);
  return s;
}

export function optionalString(body, key, opts = {}) {
  if (body[key] === undefined) return undefined;
  return requireString(body, key, { min: 0, ...opts });
}

export function optionalTags(body, key = 'tags') {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 10) throw bad(`${key} must be a list of at most 10 tags.`);
  return [...new Set(v.map((t) => {
    if (typeof t !== 'string' || !t.trim() || t.trim().length > 30) throw bad('Each tag is 1 to 30 characters.');
    return t.trim().toLowerCase();
  }))];
}

export function oneOf(body, key, allowed) {
  const v = body[key];
  if (!allowed.includes(v)) throw bad(`${key} must be one of: ${allowed.join(', ')}.`);
  return v;
}
