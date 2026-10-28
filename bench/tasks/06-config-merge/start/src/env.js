/** Settings from environment variables: PREFIX_A__B=1 becomes { a: { b: 1 } } (see SPEC.md). */
export function fromEnv(env, prefix) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(`${prefix}_`)) continue;
    const path = name.slice(prefix.length + 1).toLowerCase().split('_');
    let o = out;
    for (const p of path.slice(0, -1)) o = o[p] ??= {};
    o[path.at(-1)] = value;
  }
  return out;
}
