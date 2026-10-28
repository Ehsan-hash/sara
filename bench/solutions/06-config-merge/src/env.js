function value(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** Settings from environment variables: PREFIX_A__B=1 becomes { a: { b: 1 } } (see SPEC.md). */
export function fromEnv(env, prefix) {
  const out = {};
  for (const [name, text] of Object.entries(env)) {
    if (!name.startsWith(`${prefix}_`)) continue;
    const path = name.slice(prefix.length + 1).toLowerCase().split('__');
    let o = out;
    for (const p of path.slice(0, -1)) o = o[p] ??= {};
    o[path.at(-1)] = value(text);
  }
  return out;
}
