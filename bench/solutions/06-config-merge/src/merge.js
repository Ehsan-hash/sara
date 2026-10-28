const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function copy(v) {
  if (Array.isArray(v)) return v.map(copy);
  if (isPlainObject(v)) return merge({}, v);
  return v;
}

export function merge(base, override) {
  const out = {};
  for (const [k, v] of Object.entries(base ?? {})) out[k] = copy(v);
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else if (isPlainObject(v) && isPlainObject(out[k])) out[k] = merge(out[k], v);
    else out[k] = copy(v);
  }
  return out;
}
