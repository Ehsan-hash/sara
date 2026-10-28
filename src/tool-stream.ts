// Phase 63: tool calls shown while the model is still writing them. Providers pass on the raw
// argument pieces (`tool_delta`); this file reads the half-finished JSON as far as it goes and
// turns it into a small, throttled `tool_building` event for the app: the tool's name, the file
// path once it can be read, and the newest part of the text being written (a file's content, an
// edit's new text, a command). Nothing here runs anything: the real call still only exists once the
// provider has sent it whole, and then goes through approvals and the safety checks as before.

/** What the half-written arguments say so far. */
export interface PartialArgs {
  /** Every top-level field read so far: strings decoded (possibly cut short), other values as raw JSON. */
  values: Record<string, string>;
  /** The string field still being written, if the text stops inside one. */
  open?: string;
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Reads a JSON string starting at `i` (just after the opening quote). Returns the decoded text and
 * the index after the closing quote, or `end: -1` when the text stops before the string ends
 * (then `text` is everything decodable so far; a half escape at the very end is left out).
 */
function readString(s: string, i: number): { text: string; end: number } {
  let out = '';
  let run = i;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 34 /* " */) return { text: out + s.slice(run, i), end: i + 1 };
    if (c !== 92 /* \ */) {
      i++;
      continue;
    }
    out += s.slice(run, i);
    const e = s[i + 1];
    if (e === undefined) return { text: out, end: -1 };
    if (e === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) return { text: out, end: -1 };
      const code = Number.parseInt(hex, 16);
      out += Number.isNaN(code) ? '' : String.fromCharCode(code);
      i += 6;
    } else {
      out += ESCAPES[e] ?? e;
      i += 2;
    }
    run = i;
  }
  return { text: out + s.slice(run), end: -1 };
}

/** Skips a non-string value (number, true/false/null, object, array). -1 when it isn't finished. */
function skipValue(s: string, i: number): number {
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      const r = readString(s, i + 1);
      if (r.end < 0) return -1;
      i = r.end;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      if (depth === 0) return i;
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === ',' && depth === 0) return i;
    i++;
  }
  return -1;
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

/** Reads the top-level fields of a JSON object that may still be arriving. Never throws. */
export function partialArgs(json: string): PartialArgs {
  const values: Record<string, string> = {};
  let i = 0;
  const ws = () => {
    while (isSpace(json[i])) i++;
  };
  ws();
  if (json[i] !== '{') return { values };
  i++;
  for (;;) {
    ws();
    if (json[i] === ',') {
      i++;
      ws();
    }
    if (json[i] !== '"') return { values };
    const key = readString(json, i + 1);
    if (key.end < 0) return { values };
    i = key.end;
    ws();
    if (json[i] !== ':') return { values };
    i++;
    ws();
    if (i >= json.length) return { values };
    if (json[i] === '"') {
      const v = readString(json, i + 1);
      values[key.text] = v.text;
      if (v.end < 0) return { values, open: key.text };
      i = v.end;
    } else {
      const end = skipValue(json, i);
      if (end < 0) return { values };
      values[key.text] = json.slice(i, end).trim();
      i = end;
    }
  }
}

/** The field whose text is the point of a tool (shown growing in the app), by tool name. */
const BODY_FIELD: Record<string, string> = { write_file: 'content', edit_file: 'new_string', shell: 'command', start_job: 'command' };
const FILE_TOOLS = new Set(['write_file', 'edit_file']);
const PATH_FIELDS = ['path', 'file', 'filename'];

/** A tool call taking shape, as the app gets it. */
export interface ToolBuilding {
  type: 'tool_building';
  /** Position of the call in this model step (several can be written at once). */
  index: number;
  /** The provider's call id, once known (the finished call usually has the same one). */
  id?: string;
  name: string;
  /** 'file': a file being written (show the text in a code view); 'other': a short live preview. */
  kind: 'file' | 'other';
  path?: string;
  /** The newest part of the text (a file's tail, cut at a line start), or short "field: value" lines. */
  preview: string;
  /** Lines written so far (file tools), else 0. */
  lines: number;
  /** Characters of arguments received so far. */
  chars: number;
  /** True when `preview` is only the end of a longer text. */
  cut: boolean;
}

export interface ToolStreamOptions {
  /** Smallest gap between two events (default 100 ms: at most ~10 a second). */
  minIntervalMs?: number;
  /** Most characters of preview text in one event (default 3000). */
  previewChars?: number;
  /** Hides secrets in what is shown (the app's Redactor). */
  redact?: (s: string) => string;
  /** True when the text must not be shown (the same pattern check her replies get). */
  withhold?: (s: string) => boolean;
  now?: () => number;
}

interface Building {
  id?: string;
  name: string;
  args: string;
  /** Changed since it was last sent. */
  dirty: boolean;
  sent: boolean;
  withheld?: boolean;
}

/** Builds the throttled `tool_building` events of one model step from the providers' `tool_delta` pieces. */
export class ToolStreamTracker {
  readonly #calls = new Map<number, Building>();
  readonly #gap: number;
  readonly #max: number;
  readonly #redact: (s: string) => string;
  readonly #withhold: (s: string) => boolean;
  readonly #now: () => number;
  #last = -Infinity;

  constructor(opts: ToolStreamOptions = {}) {
    this.#gap = opts.minIntervalMs ?? 100;
    this.#max = opts.previewChars ?? 3000;
    this.#redact = opts.redact ?? ((s) => s);
    this.#withhold = opts.withhold ?? (() => false);
    this.#now = opts.now ?? (() => Date.now());
  }

  /** Adds one piece. Returns an event when it is time to show something (the first sight of a call always shows). */
  add(piece: { index: number; id?: string; name?: string; args?: string }): ToolBuilding | undefined {
    const b = this.#calls.get(piece.index) ?? { name: '', args: '', dirty: false, sent: false };
    this.#calls.set(piece.index, b);
    if (piece.id) b.id = piece.id;
    if (piece.name) b.name = piece.name;
    if (piece.args) b.args += piece.args;
    b.dirty = true;
    if (!b.name) return undefined;
    const now = this.#now();
    if (b.sent && now - this.#last < this.#gap) return undefined;
    this.#last = now;
    return this.#event(piece.index, b);
  }

  /** Whatever changed since it was last shown (call when the model step's stream ends). */
  flush(): ToolBuilding[] {
    const out: ToolBuilding[] = [];
    for (const [index, b] of this.#calls) if (b.dirty && b.name) out.push(this.#event(index, b));
    return out;
  }

  #event(index: number, b: Building): ToolBuilding {
    b.dirty = false;
    b.sent = true;
    const { values, open } = partialArgs(b.args);
    const kind = FILE_TOOLS.has(b.name) ? 'file' : 'other';
    const pathField = PATH_FIELDS.find((f) => typeof values[f] === 'string' && values[f] && open !== f);
    const path = pathField ? this.#redact(values[pathField].slice(0, 300)) : undefined;
    const body = BODY_FIELD[b.name] ?? (open && !PATH_FIELDS.includes(open) ? open : undefined);
    let preview = '';
    let lines = 0;
    let cut = false;
    if (kind === 'file' || body) {
      const text = values[body ?? ''] ?? '';
      if (kind === 'file' && text) lines = text.split('\n').length;
      if (text.length > this.#max) {
        cut = true;
        const tail = text.slice(-this.#max);
        const nl = tail.indexOf('\n');
        preview = nl >= 0 && nl < tail.length - 1 ? tail.slice(nl + 1) : tail;
      } else preview = text;
      if (kind === 'other' && preview.length > 300) {
        preview = preview.slice(-300);
        cut = true;
      }
    } else {
      // Anything else: its fields so far as short "name: value" lines.
      preview = Object.entries(values)
        .filter(([k]) => !PATH_FIELDS.includes(k))
        .map(([k, v]) => `${k}: ${v.replace(/\s+/g, ' ').slice(0, 120)}`)
        .join('\n')
        .slice(0, 300);
    }
    // The same check her replies get: text that fails it is never shown (she is stopped later anyway).
    if (b.withheld || (preview && this.#withhold(preview))) {
      b.withheld = true;
      preview = '';
    }
    return { type: 'tool_building', index, ...(b.id ? { id: b.id } : {}), name: b.name, kind, ...(path ? { path } : {}), preview: this.#redact(preview), lines, chars: b.args.length, cut };
  }
}
