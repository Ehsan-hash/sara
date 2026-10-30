// Phase 50: a simple .gitignore reader for the code map. It understands plain names and globs
// ("*.log", "secret?.txt"), folder entries ("build/"), anchored paths ("/out", "docs/tmp") and
// "**", including ordered negations ("!keep.txt").

interface Rule {
  re: RegExp;
  dirOnly: boolean;
  /** Matched against the path from the .gitignore's folder (true) or just the name (false). */
  anchored: boolean;
  negate: boolean;
}

function globToRe(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // "**/" = any folders (or none), "/**" = everything inside, "**" alone = anything.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i++;
        }
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close > i) {
        out += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = close;
      } else out += '\\[';
    } else out += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return out;
}

export class IgnoreRules {
  readonly #rules: Rule[] = [];

  constructor(text: string) {
    for (const raw of text.split(/\r?\n/)) {
      let line = raw.replace(/\s+$/, '');
      if (!line || line.startsWith('#')) continue;
      let negate = false;
      if (line.startsWith('\\')) line = line.slice(1);
      else if (line.startsWith('!')) {
        negate = true;
        line = line.slice(1);
      }
      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.replace(/\/+$/, '');
      const anchored = line.includes('/');
      line = line.replace(/^\//, '');
      if (!line) continue;
      try {
        this.#rules.push({ re: new RegExp(`^${globToRe(line)}${anchored ? '(?:/.*)?' : ''}$`), dirOnly, anchored, negate });
      } catch {
        /* an odd line: skipped */
      }
    }
  }

  get size(): number {
    return this.#rules.length;
  }

  /** Returns the last matching rule: true for ignored, false for included, undefined for no match. */
  decision(rel: string, isDir: boolean): boolean | undefined {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    let result: boolean | undefined;
    for (const r of this.#rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? rel : name)) result = !r.negate;
    }
    return result;
  }

  /** Is `rel` (a path from this .gitignore's folder, with "/") ignored? */
  ignores(rel: string, isDir: boolean): boolean {
    return this.decision(rel, isDir) === true;
  }
}
