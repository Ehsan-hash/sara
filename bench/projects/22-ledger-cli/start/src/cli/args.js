// The shared option parser (since 1.4). spec = { options: { name: { type, short?, multiple? } } }
// with type 'string' | 'boolean'. Returns { values, positionals }. Rules: docs/CLI.md "Options".
import { UsageError } from './errors.js';

function lookup(spec, name) {
  const opt = spec.options[name];
  if (!opt) throw new UsageError(`unknown option --${name}`);
  return opt;
}

function lookupShort(spec, ch) {
  for (const [name, opt] of Object.entries(spec.options)) if (opt.short === ch) return [name, opt];
  throw new UsageError(`unknown option -${ch}`);
}

function store(values, name, opt, value) {
  if (opt.multiple) (values[name] ??= []).push(value);
  else values[name] = value;
}

export function parseArgs(argv, spec) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (name.startsWith('no-') && spec.options[name.slice(3)]?.type === 'boolean') {
        values[name.slice(3)] = false;
        continue;
      }
      const opt = lookup(spec, name);
      if (opt.type === 'boolean') {
        values[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`option --${name} needs a value`);
      store(values, name, opt, next);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const letters = arg.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const [name, opt] = lookupShort(spec, letters[k]);
        if (opt.type === 'boolean') {
          values[name] = true;
          continue;
        }
        // A value-taking short option: the rest of the group, or the next argument.
        const rest = letters.slice(k + 1);
        const value = rest || argv[++i];
        if (value === undefined) throw new UsageError(`option -${letters[k]} needs a value`);
        store(values, name, opt, value);
        break;
      }
      continue;
    }
    positionals.push(arg);
  }
  for (const [name, opt] of Object.entries(spec.options)) if (values[name] === undefined && opt.default !== undefined) values[name] = opt.default;
  return { values, positionals };
}
