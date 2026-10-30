// Gmail organizing: natural dates → Gmail search words, in the owner's time zone. Pure (no I/O).
//
// Gmail's date words are easy to get wrong: `before:` is EXCLUSIVE and `after:` is inclusive, so
// "Oct 1st or older" is before:2026/10/02 (everything up to the end of Oct 1), while "before Oct 1"
// is before:2026/10/01. The API also reads YYYY/MM/DD dates as midnight Pacific time, so for the
// exact search Sara sends the same boundaries as epoch seconds of midnight in the owner's zone
// (`exactDates`); the readable form is what the owner sees on the card and in the Gmail link.

export interface DateTerms {
  /** What the owner reads (and the Gmail web link uses), e.g. "before:2026/10/02". */
  readable: string;
  /** What is sent to the Gmail API: the same boundaries as midnight in the owner's zone. */
  exact: string;
  /** One plain line on how it was read, e.g. "up to the end of Oct 1, 2026". */
  meaning: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

type Ymd = { y: number; m: number; d: number };

/** Year, month, day of a moment in a time zone (bad zone → UTC). */
export function ymdIn(at: Date, tz: string | undefined): Ymd {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  }
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n('year'), m: n('month'), d: n('day') };
}

/** Milliseconds the zone is ahead of UTC at a moment. */
function offsetMs(at: number, tz: string): number {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch {
    return 0;
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Epoch seconds of midnight at the start of a day in a time zone. */
export function midnightIn(d: Ymd, tz: string | undefined): number {
  const guess = Date.UTC(d.y, d.m - 1, d.d);
  let t = guess - offsetMs(guess, tz ?? 'UTC');
  // Daylight-saving edges: check once more with the offset at the found moment.
  t = guess - offsetMs(t, tz ?? 'UTC');
  return Math.round(t / 1000);
}

const norm = (d: Ymd): Ymd => {
  const x = new Date(Date.UTC(d.y, d.m - 1, d.d));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
};
const addDays = (d: Ymd, n: number): Ymd => norm({ ...d, d: d.d + n });
const addMonths = (d: Ymd, n: number): Ymd => norm({ y: d.y, m: d.m + n, d: 1 });
const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;
const slash = (d: Ymd) => `${d.y}/${String(d.m).padStart(2, '0')}/${String(d.d).padStart(2, '0')}`;
const pretty = (d: Ymd) => `${MONTHS[d.m - 1][0].toUpperCase()}${MONTHS[d.m - 1].slice(1)} ${d.d}, ${d.y}`;

/** A date (or a whole month, or a whole year) named in the phrase: its first day and the day after it ends. */
type Span = { from: Ymd; to: Ymd; label: string };

function findSpan(s: string, today: Ymd): Span | undefined {
  let m: RegExpExecArray | null;
  // 2026-10-01 or 2026/10/01
  if ((m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(s))) return day({ y: +m[1], m: +m[2], d: +m[3] });
  // 10/1/2026 (month first, as written in the US; 13+ in the first place means day first)
  if ((m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/.exec(s))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const [a, b] = [+m[1], +m[2]];
    return day(a > 12 ? { y, m: b, d: a } : { y, m: a, d: b });
  }
  // Oct 1st, 2026 / October 1 / Oct 1 2026
  if ((m = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`).exec(s))) return day(withYear(monthNo(m[1]), +m[2], m[3]));
  // 1 Oct 2026 / 1st of October
  if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`).exec(s))) return day(withYear(monthNo(m[2]), +m[1], m[3]));
  // September / September 2026 (the whole month)
  if ((m = new RegExp(`\\b${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`).exec(s))) {
    const first = withYear(monthNo(m[1]), 1, m[2]);
    return { from: first, to: addMonths(first, 1), label: `${MONTHS[first.m - 1][0].toUpperCase()}${MONTHS[first.m - 1].slice(1)} ${first.y}` };
  }
  // 2025 (the whole year)
  if ((m = /\b(19\d{2}|20\d{2})\b/.exec(s))) {
    const y = +m[1];
    return { from: { y, m: 1, d: 1 }, to: { y: y + 1, m: 1, d: 1 }, label: String(y) };
  }
  return undefined;

  function day(d: Ymd): Span {
    return { from: d, to: addDays(d, 1), label: pretty(d) };
  }
  function monthNo(name: string): number {
    return MONTHS.indexOf(name.slice(0, 3)) + 1;
  }
  /** No year given: the most recent such date that isn't in the future. */
  function withYear(mo: number, d: number, y?: string): Ymd {
    if (y) return { y: +y, m: mo, d };
    const guess = { y: today.y, m: mo, d };
    return cmp(guess, today) > 0 ? { ...guess, y: today.y - 1 } : guess;
  }
}

/**
 * Natural date words → Gmail search words, read in the owner's time zone. Returns undefined when
 * the phrase has no date it understands (the model should then write Gmail words itself).
 */
export function gmailDates(phrase: string, tz: string | undefined, now: Date = new Date()): DateTerms | undefined {
  const s = ` ${phrase.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()} `;
  const today = ymdIn(now, tz);
  const range = (from: Ymd | undefined, to: Ymd | undefined, meaning: string): DateTerms => {
    const r = [from ? `after:${slash(from)}` : '', to ? `before:${slash(to)}` : ''].filter(Boolean).join(' ');
    const e = [from ? `after:${midnightIn(from, tz)}` : '', to ? `before:${midnightIn(to, tz)}` : ''].filter(Boolean).join(' ');
    return { readable: r, exact: e, meaning };
  };
  let m: RegExpExecArray | null;
  // Relative amounts Gmail understands itself (no time zone involved).
  const unit = (u: string, n: number) => (u.startsWith('y') ? `${n}y` : u.startsWith('mo') ? `${n}m` : u.startsWith('w') ? `${n * 7}d` : `${n}d`);
  if ((m = /\bolder than (\d{1,4}) (days?|weeks?|months?|years?)\b/.exec(s))) {
    const t = `older_than:${unit(m[2], +m[1])}`;
    return { readable: t, exact: t, meaning: `older than ${m[1]} ${m[2]}` };
  }
  if ((m = /\b(?:last|past|newer than|within the last|in the last) (\d{1,4}) (days?|weeks?|months?|years?)\b/.exec(s))) {
    const t = `newer_than:${unit(m[2], +m[1])}`;
    return { readable: t, exact: t, meaning: `from the last ${m[1]} ${m[2]}` };
  }
  // Named periods (weeks start on Monday).
  const monday = addDays(today, -((new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() + 6) % 7));
  const firstOfMonth = { y: today.y, m: today.m, d: 1 };
  const period: [RegExp, () => [Ymd, Ymd, string]][] = [
    [/\btoday\b/, () => [today, addDays(today, 1), 'today']],
    [/\byesterday\b/, () => [addDays(today, -1), today, 'yesterday']],
    [/\bthis week\b/, () => [monday, addDays(today, 1), 'this week (since Monday)']],
    [/\blast week\b/, () => [addDays(monday, -7), monday, `last week (Monday ${pretty(addDays(monday, -7))} to Sunday ${pretty(addDays(monday, -1))})`]],
    [/\bthis month\b/, () => [firstOfMonth, addDays(today, 1), 'this month']],
    [/\blast month\b/, () => [addMonths(firstOfMonth, -1), firstOfMonth, 'last month']],
    [/\bthis year\b/, () => [{ y: today.y, m: 1, d: 1 }, addDays(today, 1), 'this year']],
    [/\blast year\b/, () => [{ y: today.y - 1, m: 1, d: 1 }, { y: today.y, m: 1, d: 1 }, `last year (${today.y - 1})`]],
  ];
  for (const [re, f] of period) {
    if (!re.test(s)) continue;
    const [from, to, what] = f();
    // "before last week" / "older than this month": everything before the period starts.
    if (/\b(before|older than|prior to|earlier than)\b/.test(s)) return range(undefined, from, `before ${what}`);
    if (/\b(since|after)\b/.test(s)) return range(from, undefined, `since ${what}`);
    return range(from, to, what);
  }
  // Between two dates (both days included).
  if ((m = /\bbetween (.+?) and (.+)$/.exec(s.trim())) || (m = /\bfrom (.+?) (?:to|until|through|-) (.+)$/.exec(s.trim()))) {
    const a = findSpan(m[1], today);
    const b = findSpan(m[2], today);
    if (a && b) return range(a.from, b.to, `from ${a.label} through ${b.label}`);
  }
  const span = findSpan(s, today);
  if (!span) return undefined;
  // Up to and including the date ("Oct 1st or older", "older than Oct 1", "until Oct 1").
  if (/\b(or|and) (older|earlier|before)\b|\bon or before\b|\buntil\b|\btill\b|\bthrough\b|\bup to\b|\bno later than\b|\bolder than\b/.test(s)) return range(undefined, span.to, `up to the end of ${span.label}`);
  // Before it started ("before Oct 1", "before September").
  if (/\b(before|prior to|earlier than)\b/.test(s)) return range(undefined, span.from, `before ${span.label}`);
  // From the date on ("since Oct 1", "Oct 1 or newer").
  if (/\b(or|and) (newer|later|after)\b|\bon or after\b|\bsince\b|\bstarting\b|\bfrom\b.*\bon\b/.test(s)) return range(span.from, undefined, `from ${span.label} on`);
  // After it ended ("after Oct 1", "newer than September").
  if (/\b(after|newer than|later than)\b/.test(s)) return range(span.to, undefined, `after ${span.label}`);
  // Just the date, month or year.
  return range(span.from, span.to, span.label);
}

/**
 * The exact search sent to Gmail: before:/after: dates (YYYY/MM/DD, which the API reads as Pacific
 * time) become epoch seconds of midnight in the owner's zone. Everything else is left as written.
 */
export function exactDates(query: string, tz: string | undefined): string {
  return query.replace(/\b(before|after|older|newer):(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/gi, (_, word: string, y: string, mo: string, d: string) => {
    const w = word.toLowerCase();
    const key = w === 'older' ? 'before' : w === 'newer' ? 'after' : w;
    return `${key}:${midnightIn({ y: +y, m: +mo, d: +d }, tz)}`;
  });
}
