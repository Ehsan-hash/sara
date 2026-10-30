// Phase 77 (harness track M2, docs/design/HARNESS_TRACK.md §3 M2, §2.3, risk 9, §7 #4): before a
// tool call runs, it is checked against the owner's stored decisions (and facts that read as rules).
//
// Code decides: a note is BINDING only when it has a clear shape (a negation + something the call
// names: a branch, a path, a program, a flag), and the call is matched against that shape in code
// (no model call, the same answer on every model). Those are "clear" conflicts, and only clear
// conflicts may stop a call. Fuzzy cases (a rule that shares words with the call but has no shape
// code can match) are only FLAGGED, quoted, never stopped; the optional judge (the owner's claim
// judge model) may drop a fuzzy flag, never add a stop. See risk 9: measured with
// scripts/eval-contradict.ts before anything beyond the clear shapes may stop.
//
// The result is a structured object (`Contradiction`) kept on the reply's meta (`contradictions`)
// and on the tool message: shaped like the design's Finding (§2.5: source, severity, quote, rule,
// title, advice, status) so M3 run snapshots and the findings table can take it over unchanged.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Memory, MemoryKind } from './memory.ts';
import { bracketNote, queryWords, rankMemories, stem, type Confidence, type RankSource, type RankedPick } from './memory-rank.ts';

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** 'stop': clear conflicts stop with an approval card (coding and work conversations); 'mention': only mention them. */
export type ContradictMode = 'stop' | 'mention';
export interface ContradictSettings {
  /** Settings → Tools and approvals → "Check her plans against what you decided" (default on). */
  on: boolean;
  mode: ContradictMode;
}
export const DEFAULT_CONTRADICT: ContradictSettings = { on: true, mode: 'stop' };
export const CONTRADICT_MODES: ContradictMode[] = ['stop', 'mention'];
export function contradictSettings(s: { contradict?: Partial<ContradictSettings> } | undefined): ContradictSettings {
  const c = s?.contradict;
  return { on: c?.on !== false, mode: CONTRADICT_MODES.includes(c?.mode as ContradictMode) ? (c!.mode as ContradictMode) : DEFAULT_CONTRADICT.mode };
}

// ---------------------------------------------------------------------------------------------
// Binding rules read from a note (code only)
// ---------------------------------------------------------------------------------------------

export type RuleShape = 'push-branch' | 'no-push' | 'force-push' | 'tests-first' | 'path' | 'package-manager' | 'command';
export interface BindingRule {
  shape: RuleShape;
  /** push-branch: branch names; no-push: remotes ('*' = any); path: path tokens; package-manager: banned programs; command: the words in order. */
  target: string[];
  /** tests-first: what needs tests first. */
  verb?: 'push' | 'commit';
  /** path: true when the object is a real path/file token (clear); false = only words ("the prod config"), flag only. */
  exact?: boolean;
}

const NEG = String.raw`(?:never|not|no|don'?t|do\s+not|doesn'?t|does\s+not|didn'?t|won'?t|will\s+not|shouldn'?t|should\s+not|mustn'?t|must\s+not|can'?t|cannot|can\s+not|stop|avoid|without|nobody|nothing|forbid|forbids|forbidden|ban|bans|banned|quit)`;
/** Words that make a negation not a rule ("doesn't mind pushing to main", "not sure whether to push"). */
const NOT_A_RULE = /\b(mind|minds|care|cares|worr\w*|sure|matter|matters|problem|issue|hesitate|forget|forgot|remember|know|knew|think|wonder\w*|ask\w*|realiz\w*|notic\w*|like|likes|liked|enjoy\w*|only|just\s+once|sometimes|usually|until)\b/;
const OFF_LIMITS = String.raw`(?:is|are|stays?|remains?|must\s+stay|should\s+stay)\s+(?:not\s+allowed|forbidden|off[- ]limits|banned|prohibited|a\s+no[- ]go|not\s+ok(?:ay)?|not\s+fine|read[- ]only|frozen|untouchable|not\s+to\s+be\s+(?:touched|changed|edited))`;

/** Lower case, straight quotes, single spaces. */
export function norm(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Is `verb` (a regex source) negated in the same clause? Returns where the verb starts (or -1). */
function negatedAt(t: string, verb: string): { at: number; end: number }[] {
  const out: { at: number; end: number }[] = [];
  const re = new RegExp(String.raw`\b${NEG}\b((?:\s+[\w'-]+){0,4}?)\s+(${verb})`, 'g');
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (NOT_A_RULE.test(m[1] ?? '')) continue;
    const at = m.index + m[0].length - m[2].length;
    out.push({ at, end: m.index + m[0].length });
  }
  const off = new RegExp(String.raw`(${verb})[^.;!?]{0,60}?\b${OFF_LIMITS}`, 'g');
  for (let m = off.exec(t); m; m = off.exec(t)) out.push({ at: m.index, end: m.index + m[1].length });
  return out;
}

/** The rest of the clause after position `i` (to the next . ; ! ? or "but"). */
function clauseAfter(t: string, i: number): string {
  const rest = t.slice(i);
  const m = /[.;!?]\s|[.;!?]$|\s(?:but|unless|except)\s/.exec(rest);
  return m ? rest.slice(0, m.index) : rest;
}

const REMOTE_WORDS = new Set(['github', 'gitlab', 'bitbucket', 'remote', 'the remote', 'origin', 'upstream', 'anywhere', 'it', 'anything', 'them', 'there', 'codeberg']);
const BRANCHY = /^(main|master|trunk|develop|dev|release|prod|production|staging|stable|gh-pages)$|^(release|hotfix)[/-][\w.-]+$/;
const PMS = ['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'pipenv', 'poetry', 'uv', 'conda'];
const PM_RE = String.raw`(?:npm|pnpm|yarn|bun|pip3?|pipenv|poetry|uv|conda)`;
/** Programs whose name after "never use / run" starts a command rule. */
// (No program names that are everyday words: "service", "make", "go", "kill" would turn
// "never deploy the billing service" into a command rule.)
const PROGRAMS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'pip', 'pip3', 'docker', 'kubectl', 'helm', 'terraform', 'rm', 'sudo', 'chmod', 'chown', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'cargo', 'python3', 'mvn', 'gradle', 'dotnet', 'psql', 'mysql', 'redis-cli', 'systemctl', 'pkill', 'killall', 'mkfs', 'brew', 'apt-get', 'dnf', 'yum', 'pacman', 'heroku', 'vercel', 'netlify', 'flyctl', 'firebase', 'gcloud', 'eslint', 'prettier']);
const CMD_STOP = new Set(['on', 'in', 'at', 'for', 'the', 'a', 'an', 'without', 'unless', 'when', 'if', 'again', 'anymore', 'ever', 'please', 'or', 'and', 'to', 'from', 'with', 'into', 'here', 'there', 'commands', 'command']);

const PATH_VERB = String.raw`(?:touch\w*|edit\w*|chang\w*|modif\w*|delet\w*|remov\w*|writ(?:e|es|ing)\s+(?:to|in|into)|overwrit\w*|renam\w*|mov(?:e|es|ed|ing)|alter\w*|mess\w*\s+with|reformat\w*|refactor\w*|tamper\w*\s+with)`;
/** One clause's text where a dot inside a token (prod.json) doesn't end it. */
const OBJ = String.raw`((?:[^.;!?]|\.(?=[\w/]))`;
/** A token that names a path: has a slash, a file extension, starts with a dot, or was quoted. */
function pathToken(tok: string): string | null {
  const t = tok.replace(/^[('"`]+|[)'"`,:]+$/g, '').replace(/^\.\//, '');
  if (!t || t.length > 120) return null;
  if (/^https?:/.test(t)) return null;
  if (t.includes('/') && /[a-z0-9_]/.test(t)) return t.replace(/\/+$/, '');
  if (/^\.[a-z0-9_][\w.-]*$/.test(t)) return t; // .env, .github
  if (/^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9]{0,5}$/.test(t) && !/^(e\.g|i\.e|etc)$/.test(t)) return t; // prod.json, README.md
  return null;
}
const GENERIC_WORDS = new Set(['code', 'file', 'files', 'folder', 'folders', 'directory', 'dir', 'thing', 'things', 'stuff', 'project', 'repo', 'repository', 'anything', 'everything', 'sara', 'her', 'your', 'own', 'whole', 'entire', 'any', 'old', 'new', 'one', 'ones']);

/** The binding rules in one note's text (empty = not binding). */
export function parseRules(textIn: string): BindingRule[] {
  const t = norm(textIn);
  const rules: BindingRule[] = [];
  const add = (r: BindingRule) => {
    if (!rules.some((x) => x.shape === r.shape && x.target.join('|') === r.target.join('|') && x.verb === r.verb)) rules.push(r);
  };

  // Tests before pushing / committing ("tests before every push", "push only after the tests pass",
  // "never push without running the tests").
  const tf =
    /\btests?\b[^.;!?]{0,50}?\bbefore\b[^.;!?]{0,30}?\b(push|commit)\w*/.exec(t) ??
    /\b(push|commit)\w*[^.;!?]{0,40}?\b(?:only\s+)?(?:after|once|when)\b[^.;!?]{0,30}?\btests?\b/.exec(t) ??
    new RegExp(String.raw`\b${NEG}\b(?:\s+[\w'-]+){0,3}?\s+(push|commit)\w*[^.;!?]{0,40}?\b(?:without|before)\b[^.;!?]{0,25}?\btests?\b`).exec(t);
  if (tf) add({ shape: 'tests-first', target: [], verb: tf[1] === 'commit' ? 'commit' : 'push' });

  // Pushes: to a branch, to a remote, or forced.
  for (const n of negatedAt(t, String.raw`push(?:ing|es|ed)?|force[- ]?push\w*`)) {
    const clause = clauseAfter(t, n.at);
    const before = t.slice(Math.max(0, n.at - 30), n.at);
    if (/^force[- ]?push/.test(clause) || /\bforce[- ]?$/.test(before) || /^push\w*\s+(?:with\s+)?(?:--force\b|-f\b|force\b)/.test(clause)) {
      add({ shape: 'force-push', target: [] });
      continue;
    }
    // "never push without the tests" is the tests rule, not a ban on pushing.
    if (/\b(without|unless|before|until)\b[^.;!?]{0,30}?\b(tests?|ci|checks?|build|lint)\b/.test(clause)) continue;
    const to = /^push\w*(?:\s+(?:anything|code|changes|commits|directly|straight|stuff|it|work))*\s+(?:to|into|onto|on)\s+(?:the\s+)?["'`]?([\w./-]+)["'`]?/.exec(clause);
    const direct = /^push\w*\s+(?:directly\s+)?["'`]?([\w./-]+)["'`]?/.exec(clause);
    const target = to?.[1] ?? (direct && BRANCHY.test(direct[1]) ? direct[1] : undefined);
    if (target && !REMOTE_WORDS.has(target) && target !== 'branch') add({ shape: 'push-branch', target: [target.replace(/^refs\/heads\//, '')] });
    else if (target && REMOTE_WORDS.has(target)) add({ shape: 'no-push', target: [['origin', 'upstream'].includes(target) ? target : '*'] });
    // "never push anything", "don't push" (the clause ends right after the verb).
    else if (!target && /^push\w*(?:\s+(?:anything|it|them|code|changes|commits|yourself|at\s+all|on\s+(?:your|her)\s+own|without\s+asking))*\s*$/.test(clause.trim())) add({ shape: 'no-push', target: ['*'] });
  }
  // "No force pushes", "--force is off-limits".
  if (new RegExp(String.raw`\b${NEG}\b(?:\s+[\w'-]+){0,3}?\s+(?:force[- ]?push\w*|--force\b|force\s+push\w*)`).test(t) || new RegExp(String.raw`(?:force[- ]?push\w*|--force)[^.;!?]{0,40}?\b${OFF_LIMITS}`).test(t)) add({ shape: 'force-push', target: [] });
  // "Changes to main only through pull requests".
  const pr = /\b(main|master|trunk|develop)\b[^.;!?]{0,50}?\bonly\s+(?:via|through|with|by)\s+(?:a\s+)?(?:pull[- ]requests?|prs?|merge[- ]requests?)/.exec(t) ?? /\b(?:pull[- ]requests?|prs?)\s+only\b[^.;!?]{0,30}?\b(?:for|to|into|on)\s+(main|master|trunk|develop)\b/.exec(t);
  if (pr) add({ shape: 'push-branch', target: [pr[1]] });

  // Package managers: "use pnpm, not npm", "pnpm instead of npm", "never use npm", "no npm".
  for (const m of t.matchAll(new RegExp(String.raw`\b${PM_RE}\b[^.;!?]{0,30}?\b(?:not|instead\s+of|rather\s+than|over)\s+(${PM_RE})\b`, 'g'))) add({ shape: 'package-manager', target: [m[1]] });
  for (const m of t.matchAll(new RegExp(String.raw`\binstead\s+of\s+(${PM_RE})\b`, 'g'))) add({ shape: 'package-manager', target: [m[1]] });
  for (const n of negatedAt(t, String.raw`(?:use\s+|using\s+|run\s+|running\s+)?${PM_RE}\b`)) {
    const pm = new RegExp(String.raw`${PM_RE}\b`).exec(t.slice(n.at))?.[0];
    // "don't npm publish" is a command rule, not a ban on npm.
    const after = t.slice(n.at).replace(/^(?:use|using|run|running)\s+/, '').split(/\s+/);
    if (pm && PMS.includes(pm) && !(after[1] && /^[a-z][\w-]*$/.test(after[1]) && !CMD_STOP.has(after[1]) && !/^(for|in|here|anymore|again|ever|please|at)$/.test(after[1]) && ['publish', 'unpublish', 'link', 'audit', 'deprecate'].includes(after[1]))) add({ shape: 'package-manager', target: [pm] });
  }

  // Paths: "don't touch infra/", "never edit config/prod.json", "leave vendor/ alone", "stay out of legacy/".
  // [object text, words-only objects allowed?]
  const objects: [string, boolean][] = [];
  for (const n of negatedAt(t, PATH_VERB)) objects.push([clauseAfter(t, n.end), true]);
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:leave|let)\s+${OBJ}{1,60}?)\s+alone\b`, 'g'))) objects.push([m[1], true]);
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:stay|keep(?:\s+your\s+hands)?)\s+(?:out|away|off)\s+(?:of|from)?\s*${OBJ}{1,60})`, 'g'))) objects.push([m[1], true]);
  for (const m of t.matchAll(new RegExp(String.raw`\bhands\s+off\s+${OBJ}{1,60})`, 'g'))) objects.push([m[1], true]);
  // "X is off-limits": only a real path or a named folder/file ("pushes to main are not allowed" isn't a path).
  for (const m of t.matchAll(new RegExp(String.raw`(?:^|[\s,:(])((?:the\s+)?[^\s;!?,]+(?:\s+(?:folder|directory|dir|file))?)\s+${OFF_LIMITS}`, 'g'))) objects.push([m[1].replace(/\.$/, ''), false]);
  for (const [obj, wordsOk] of objects) {
    const toks = obj.split(/\s+/).slice(0, 8);
    const quoted = /["'`]([^"'`]{2,80})["'`]/.exec(obj)?.[1];
    let exact = quoted ? pathToken(quoted.includes('/') || quoted.includes('.') ? quoted : `${quoted}/`) ?? quoted : null;
    for (let i = 0; !exact && i < toks.length; i++) {
      exact = pathToken(toks[i]);
      // "the legacy folder", "the scripts directory"
      if (!exact && /^(folder|directory|dir)$/.test(toks[i + 1] ?? '') && /^[\w.-]+$/.test(toks[i]) && !GENERIC_WORDS.has(toks[i]) && toks[i] !== 'the') exact = toks[i];
      if (/^(unless|but|except|without|when|if)$/.test(toks[i])) break;
    }
    if (exact) {
      add({ shape: 'path', target: [exact.replace(/\/+$/, '')], exact: true });
      continue;
    }
    if (!wordsOk) continue;
    const words = queryWords(obj.split(/\b(?:unless|but|except|without|when|if|because|since)\b/)[0]).filter((w) => !GENERIC_WORDS.has(w) && !/^(touch|edit|change|alone)$/.test(w)).slice(0, 4);
    if (words.length) add({ shape: 'path', target: words, exact: false });
  }

  // Commands and flags: "never run git reset --hard", "don't use sudo", "no --no-verify", "never use `rm -rf`".
  for (const n of negatedAt(t, String.raw`(?:use|using|run|running|call|calling|type|execute|do)\s+[^\s]+|(?:--[\w-]+|\x60[^\x60]+\x60)|(?:${[...PROGRAMS].join('|')})\b`)) {
    let rest = t.slice(n.at).replace(/^(?:use|using|run|running|call|calling|type|execute|do)\s+/, '');
    const q = /^`([^`]+)`/.exec(rest);
    if (q) {
      const words = q[1].trim().split(/\s+/).slice(0, 5);
      if (words.length && !(PMS.includes(words[0]) && words.length === 1)) add({ shape: 'command', target: words });
      continue;
    }
    rest = rest.replace(/^(?:the\s+)?/, '');
    const words: string[] = [];
    for (const w of rest.split(/\s+/)) {
      const clean = w.replace(/[.,;:!?)"']+$/, '');
      if (!clean || CMD_STOP.has(clean) || !/^(-{1,2}[\w-]+(=\S+)?|[\w./:@~+-]+)$/.test(clean)) break;
      words.push(clean);
      if (/[.,;:!?]$/.test(w) || words.length >= 4) break;
    }
    if (!words.length) continue;
    const first = words[0];
    if (!(PROGRAMS.has(first) || first.startsWith('-'))) continue;
    if (PMS.includes(first) && words.length === 1) continue; // that's the package-manager rule
    // "never push --force" etc. are push rules (above); "never use git" alone is too broad to stop on.
    if (first === 'git' && words.length === 1) continue;
    add({ shape: 'command', target: words });
  }
  return rules;
}

/** The binding words of a rule-like note (for the fuzzy check): only notes that read as rules. */
const RULE_CUE = /\b(?:always|only|must|should\s+(?:always|never)|make\s+sure|has\s+to|have\s+to|rule|policy)\b/;
const NEG_CUE = new RegExp(String.raw`\b${NEG}\b((?:\s+[\w'-]+){0,3})`, 'g');
/** A note that reads as a rule: "always / only / must …", or a negation that isn't "doesn't mind …". */
export function readsAsRule(text: string): boolean {
  const t = norm(text);
  if (RULE_CUE.test(t)) return true;
  for (const m of t.matchAll(NEG_CUE)) if (!NOT_A_RULE.test(m[1] ?? '')) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// The planned action (what the tool call would do), read in code
// ---------------------------------------------------------------------------------------------

export interface PushPlan {
  remote: string | null;
  /** Branches it would update (lower case). */
  branches: string[];
  force: boolean;
  /** --all / --mirror (every branch). */
  all: boolean;
  /** The branch isn't named and the current one couldn't be read. */
  unknown: boolean;
  /** An earlier `&&` step of the same command runs the tests. */
  testedFirst: boolean;
  text: string;
}
export interface Segment {
  /** All words (quotes removed). */
  words: string[];
  /** The program (after env assignments, sudo, time…), lower case without .exe. */
  prog: string;
  /** Words from the program on. */
  cmd: string[];
  /** Folder it runs in, relative to the workspace ('' = the workspace). */
  cwd: string;
  /** How it is joined to the previous one ('&&', '||', ';', '|', '&', '' for the first). */
  join: string;
  text: string;
}
export interface PlannedAction {
  tool: string;
  segments: Segment[];
  pushes: PushPlan[];
  commits: { text: string; testedFirst: boolean }[];
  /** Workspace-relative paths it would change (forward slashes, lower case). */
  changes: string[];
  /** Every word of the call (summary + string arguments) for the fuzzy check. */
  text: string;
}

/** Tools that only read or look: never checked (nothing they do can go against a rule). */
export const READ_ONLY_TOOLS = new Set([
  'list_dir', 'read_file', 'search', 'git', 'code_map', 'code_find', 'code_refs', 'code_deps', 'recall', 'search_library', 'library', 'search_memory', 'list_facts', 'list_notes', 'list_tasks', 'list_recent_conversations', 'read_note', 'get_today', 'settings_guide', 'web_search', 'web_fetch', 'job_status', 'recipe_find', 'gmail_search', 'gmail_thread', 'gmail_needs_answer', 'calendar_events', 'calendar', 'home_status', 'github_list', 'github_read', 'ssh_servers', 'browser_open', 'browser_read', 'browser_screenshot', 'browser_check', 'browser_click', 'browser_type', 'review_code', 'moments', 'scrapbook',
]);

const TEST_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|node\s+--test|pytest|py\.test|go\s+test|cargo\s+test|vitest|jest|mocha|make\s+(?:test|check)|dotnet\s+test|mvn\s+(?:\S+\s+)?test|gradlew?\s+test|phpunit|rspec|python3?\s+-m\s+(?:unittest|pytest)|tox|deno\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?check)\b/i;
export const isTestCommand = (cmd: string) => TEST_RE.test(cmd);

/** Splits a shell command into simple commands (quotes respected, no expansion). */
export function shellSegments(command: string): Segment[] {
  const out: Segment[] = [];
  let words: string[] = [];
  let cur = '';
  let has = false;
  let quote = '';
  let joinNext = '';
  let start = 0;
  let cwd = '';
  const endWord = () => {
    if (has) words.push(cur);
    cur = '';
    has = false;
  };
  const endSeg = (j: string, i: number) => {
    endWord();
    if (words.length) {
      const text = command.slice(start, i).trim();
      let k = 0;
      while (k < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]) || ['sudo', 'time', 'command', 'exec', 'nohup', 'env', 'doas'].includes(words[k]) || (words[k - 1] === 'sudo' && words[k].startsWith('-')))) k++;
      const cmd = words.slice(k);
      const prog = (cmd[0] ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '').replace(/^.*[/\\]/, '');
      out.push({ words, prog, cmd, cwd, join: joinNext, text });
      if ((prog === 'cd' || prog === 'pushd') && cmd[1] && !cmd[1].startsWith('-')) cwd = joinRel(cwd, cmd[1]);
    }
    words = [];
    joinNext = j;
    start = i + j.length;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = '';
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      if (command[i + 1] === '\n') i++;
      else {
        cur += command[++i];
        has = true;
      }
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      endSeg(two, i);
      i++;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      endSeg(ch === '\n' ? ';' : ch, i);
      continue;
    }
    if (/\s/.test(ch)) {
      endWord();
      continue;
    }
    cur += ch;
    has = true;
  }
  endSeg('', command.length);
  return out;
}

/** Joins a relative folder onto a workspace-relative one (no escaping above the workspace). */
function joinRel(base: string, p: string): string {
  if (!p || p === '.') return base;
  if (isAbsolute(p) || /^[a-z]:[\\/]/i.test(p) || p.startsWith('~')) return base;
  const parts = [...(base ? base.split('/') : [])];
  for (const x of p.replace(/\\/g, '/').split('/')) {
    if (!x || x === '.') continue;
    if (x === '..') parts.pop();
    else parts.push(x);
  }
  return parts.join('/');
}

/** The current branch of the repository in `dir` (reads .git/HEAD; undefined when it can't). */
export function currentBranch(workspaceDir: string, rel: string): string | undefined {
  try {
    const root = resolve(workspaceDir);
    let dir = resolve(root, rel || '.');
    for (let i = 0; i < 12; i++) {
      const r = relative(root, dir);
      if (r.startsWith('..') || isAbsolute(r)) return undefined;
      const g = join(dir, '.git');
      if (existsSync(g)) {
        let gitDir = g;
        if (statSync(g).isFile()) {
          const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, 'utf8'));
          if (!m) return undefined;
          gitDir = resolve(dir, m[1].trim());
        }
        const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
        const b = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return b ? b[1].trim().toLowerCase() : undefined;
      }
      if (dir === root) return undefined;
      dir = resolve(dir, '..');
    }
  } catch {
    // unreadable: unknown
  }
  return undefined;
}

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, '').replace(/^heads\//, '').toLowerCase();

/** One `git push` (from a shell segment's words after `push`). */
function parsePush(args: string[], current: () => string | undefined, text: string, testedFirst: boolean): PushPlan | null {
  let force = false;
  let all = false;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run' || a === '-n') return null;
    if (a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes') force = true;
    else if (a === '--all' || a === '--mirror' || a === '--branches') all = true;
    else if (a === '-o' || a === '--push-option' || a === '--repo' || a === '--receive-pack' || a === '--exec') i++;
    else if (a.startsWith('--')) continue;
    else if (/^-[a-zA-Z]+$/.test(a)) {
      if (a.includes('f')) force = true;
    } else pos.push(a);
  }
  const remote = pos[0] ?? null;
  const specs = pos.slice(1);
  const branches: string[] = [];
  let unknown = false;
  if (!specs.length && !all) {
    const b = current();
    if (b) branches.push(b);
    else unknown = true;
  }
  for (let s of specs) {
    if (s.startsWith('+')) {
      force = true;
      s = s.slice(1);
    }
    const [src, dst] = s.includes(':') ? [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)] : [s, ''];
    const target = dst || src;
    if (!target) continue;
    if (/^head$/i.test(target)) {
      const b = current();
      if (b) branches.push(b);
      else unknown = true;
    } else if (!target.startsWith('refs/tags/')) branches.push(branchOf(target));
  }
  return { remote, branches: [...new Set(branches)], force, all, unknown, testedFirst, text };
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/** Reads what a tool call would do (pure apart from reading .git/HEAD inside the workspace). */
export function planOf(tool: string, args: Record<string, unknown>, opts: { workspaceDir?: string; summary?: string } = {}): PlannedAction {
  const plan: PlannedAction = { tool, segments: [], pushes: [], commits: [], changes: [], text: '' };
  const cur = (rel: string) => () => (opts.workspaceDir ? currentBranch(opts.workspaceDir, rel) : undefined);
  const strings: string[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (depth > 3 || strings.join(' ').length > 4000) return;
    if (typeof v === 'string') strings.push(v.slice(0, 2000));
    else if (Array.isArray(v)) for (const x of v.slice(0, 40)) walk(x, depth + 1);
    else if (v && typeof v === 'object') for (const x of Object.values(v).slice(0, 40)) walk(x, depth + 1);
  };
  // File contents are not the plan (a README that says "push to main" isn't pushing).
  walk(Object.fromEntries(Object.entries(args).filter(([k]) => !['content', 'new_text', 'old_text', 'text', 'body', 'message'].includes(k))));
  plan.text = [opts.summary ?? '', tool, ...strings].join(' ').slice(0, 6000);
  const relPath = (p: string, base = '') => joinRel(base, p.replace(/\\/g, '/')).toLowerCase();

  const command = tool === 'shell' || tool === 'start_job' || tool === 'ssh_run' ? s(args.command) : '';
  if (command) {
    plan.segments = shellSegments(command);
    const remote = tool === 'ssh_run';
    let tested = false;
    for (const [i, seg] of plan.segments.entries()) {
      const prevJoin = seg.join;
      if (i > 0 && prevJoin !== '&&') tested = false;
      if (seg.prog === 'git' && !remote) {
        let k = 1;
        let dir = seg.cwd;
        while (k < seg.cmd.length && seg.cmd[k].startsWith('-')) {
          if (seg.cmd[k] === '-C') dir = joinRel(dir, seg.cmd[++k] ?? '');
          else if (seg.cmd[k] === '-c') k++;
          k++;
        }
        const sub = seg.cmd[k];
        if (sub === 'push') {
          const p = parsePush(seg.cmd.slice(k + 1), cur(dir), seg.text, tested);
          if (p) plan.pushes.push(p);
        } else if (sub === 'commit') plan.commits.push({ text: seg.text, testedFirst: tested });
        else if (sub === 'rm' || sub === 'mv' || sub === 'checkout' || sub === 'restore') for (const w of seg.cmd.slice(k + 1)) if (!w.startsWith('-') && w !== '--') plan.changes.push(relPath(w, dir));
      } else if (!remote) {
        // Files a command would change: rm/mv/cp targets, sed -i, tee, touch, > and >> redirects.
        const c = seg.cmd;
        const inPlace = (seg.prog === 'sed' && c.some((w) => /^-[a-z]*i/.test(w))) || (seg.prog === 'perl' && c.some((w) => /^-[a-z]*i/.test(w)));
        if (['rm', 'rmdir', 'mv', 'cp', 'touch', 'truncate', 'chmod', 'chown', 'unlink', 'shred', 'tee', 'mkdir', 'ln'].includes(seg.prog) || inPlace) {
          const args = c.slice(1).filter((w) => !w.startsWith('-') && !/^\d+$/.test(w) && !/^[ugoa]*[+-=][rwx]+$/.test(w));
          // sed/perl: the first word is the script (unless given with -e).
          for (const w of inPlace && !c.includes('-e') ? args.slice(1) : args) plan.changes.push(relPath(w, seg.cwd));
        }
        const redirect = /(?:^|[^>0-9&])>{1,2}\s*([^\s;&|]+)/g;
        for (const m of seg.text.matchAll(redirect)) if (!/^\/dev\//.test(m[1]) && !m[1].startsWith('&')) plan.changes.push(relPath(m[1].replace(/^["']|["']$/g, ''), seg.cwd));
      }
      if (isTestCommand(seg.text)) tested = true;
    }
  }
  if (tool === 'git_push') {
    const dir = s(args.path);
    const branch = s(args.branch);
    const b = branch ? branchOf(branch) : cur(dir)();
    plan.pushes.push({ remote: s(args.remote) || 'origin', branches: b ? [b] : [], force: false, all: false, unknown: !b, testedFirst: false, text: `git push ${s(args.remote) || 'origin'} ${branch || 'HEAD'}`.trim() });
    // As a command, so command rules ("never git push") see it.
    plan.segments.push({ words: ['git', 'push', s(args.remote) || 'origin', branch || 'HEAD'], prog: 'git', cmd: ['git', 'push', s(args.remote) || 'origin', branch || 'HEAD'], cwd: dir, join: '', text: `git push ${s(args.remote) || 'origin'} ${branch || 'HEAD'}` });
  }
  if (tool === 'git_commit') {
    plan.commits.push({ text: `git commit -m ${s(args.message).slice(0, 80)}`, testedFirst: false });
    const dir = s(args.path);
    const paths = Array.isArray(args.paths) ? (args.paths as unknown[]).map(String) : [];
    for (const p of paths) plan.changes.push(relPath(p, dir));
    if (s(args.new_branch)) plan.segments.push({ words: ['git', 'switch', '-c', s(args.new_branch)], prog: 'git', cmd: ['git', 'switch', '-c', s(args.new_branch)], cwd: dir, join: '', text: `git switch -c ${s(args.new_branch)}` });
  }
  if (['write_file', 'edit_file', 'delete_file', 'project_note'].includes(tool) && s(args.path)) plan.changes.push(relPath(s(args.path)));
  plan.changes = [...new Set(plan.changes.filter(Boolean))];
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Matching a plan against a rule
// ---------------------------------------------------------------------------------------------

/** Something this run did before (a tool receipt). */
export interface PriorRun {
  name: string;
  status: string;
  args: Record<string, unknown>;
  output: string;
}

/** Did the tests run (and pass) since the last push? */
export function testedSincePush(prior: PriorRun[]): boolean {
  let tested = false;
  for (const r of prior) {
    const cmd = s(r.args?.command);
    if (r.status !== 'ok') continue;
    if (r.name === 'git_push' || (cmd && /\bgit\b[^;&|]*\bpush\b/.test(cmd))) tested = false;
    if (cmd && isTestCommand(cmd) && !/\bexit code [1-9]\d*|\btimed out\b/i.test(r.output.slice(0, 200))) tested = true;
  }
  return tested;
}

/** Does `path` (workspace-relative, lower case) fall under the rule's path token? */
function pathHits(token: string, path: string): boolean {
  const t = token.toLowerCase().replace(/^\.\//, '').replace(/\/+$/, '');
  const p = path.replace(/^\.\//, '');
  if (!t || !p) return false;
  if (p === t || p.startsWith(`${t}/`) || p.endsWith(`/${t}`) || p.includes(`/${t}/`)) return true;
  // A bare file name ("prod.json", ".env") matches that file anywhere.
  if (!t.includes('/')) return p.split('/').includes(t);
  return false;
}

/** The matched part of a plan, or null. Pure. */
export function matchRule(rule: BindingRule, plan: PlannedAction, prior: PriorRun[] = []): { matched: string; clear: boolean } | null {
  switch (rule.shape) {
    case 'push-branch': {
      for (const p of plan.pushes) {
        const hit = p.all ? rule.target[0] : p.branches.find((b) => rule.target.includes(b));
        if (hit) return { matched: `${p.text}${p.all ? '' : p.branches.length && !p.text.includes(hit) ? ` (branch ${hit})` : ''}`, clear: true };
      }
      return null;
    }
    case 'no-push': {
      const p = plan.pushes.find((x) => rule.target[0] === '*' || x.remote === rule.target[0] || (!x.remote && rule.target[0] === 'origin'));
      return p ? { matched: p.text, clear: true } : null;
    }
    case 'force-push': {
      const p = plan.pushes.find((x) => x.force);
      return p ? { matched: p.text, clear: true } : null;
    }
    case 'tests-first': {
      const acts = rule.verb === 'commit' ? plan.commits : plan.pushes;
      const a = acts.find((x) => !x.testedFirst);
      if (!a) return null;
      if (testedSincePush(prior)) return null;
      return { matched: a.text, clear: true };
    }
    case 'path': {
      if (rule.exact) {
        const p = plan.changes.find((c) => pathHits(rule.target[0], c));
        return p ? { matched: p, clear: true } : null;
      }
      // Only words ("the prod config"): every word in one changed path → a flag, never a stop.
      for (const c of plan.changes) {
        const have = new Set(c.split(/[^a-z0-9]+/).filter(Boolean).map(stem));
        if (rule.target.every((w) => have.has(stem(w)))) return { matched: c, clear: false };
      }
      return null;
    }
    case 'package-manager': {
      const seg = plan.segments.find((x) => rule.target.includes(x.prog));
      return seg ? { matched: seg.text, clear: true } : null;
    }
    case 'command': {
      const want = rule.target.map((w) => w.toLowerCase());
      for (const seg of plan.segments) {
        const words = seg.words.map((w) => w.toLowerCase());
        if (want.length === 1) {
          if (want[0].startsWith('-') ? words.includes(want[0]) : seg.prog === want[0] || words.includes(want[0])) return { matched: seg.text, clear: true };
          continue;
        }
        // In order, next to each other; flags anywhere after the program.
        const head = want.filter((w) => !w.startsWith('-'));
        const flags = want.filter((w) => w.startsWith('-'));
        for (let i = 0; i + head.length <= words.length; i++) {
          if (head.every((w, j) => words[i + j] === w) && flags.every((f) => words.slice(i).some((x) => x === f || (/^-[a-z]+$/.test(f) && /^-[a-z]+$/.test(x) && [...f.slice(1)].every((ch) => x.includes(ch)))))) return { matched: seg.text, clear: true };
        }
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------

/** What happened with it (Finding status words, §2.5). */
export type ContradictionStatus = 'open' | 'flagged' | 'overridden' | 'declined' | 'update';

/**
 * One contradiction: the structured object kept on the reply's meta (`contradictions`) and on the
 * tool message (`contradiction`). Shaped like the design's Finding (§2.5) so M3 run snapshots and
 * the findings table take it over: source, severity, quote, rule, title, advice, status.
 */
export interface Contradiction {
  source: 'contradiction';
  /** The note it goes against. */
  memoryId: number;
  kind: MemoryKind;
  /** The note's text, quoted as stored. */
  note: string;
  /** The owner's own words the note came from (when the note has them). */
  quote: string | null;
  /** Local day the note was made. */
  decidedOn: string;
  /** Which code rule matched ('fuzzy' = shared words only). */
  rule: RuleShape | 'fuzzy';
  /** The rule's object (branches, path, program, command words; fuzzy: the shared words). */
  target: string[];
  /** Query words the note matched (M1's word match), for the why line. */
  words: string[];
  /** Code-matched (may stop) or fuzzy (flag only). */
  clear: boolean;
  /** The part of the call that matched (a command, a path, "branch main"). */
  matched: string;
  tool: string;
  callId: string;
  /** The approval card / step line words for the call. */
  summary: string;
  /** M1's why/sure for the note (the same bracket format as her memory lines). */
  why: string[];
  sure: Confidence;
  bracket: string;
  policyId: string;
  /** 'stop' = an approval card stopped the call; 'flag' = she was told and mentions it. */
  act: 'stop' | 'flag';
  severity: 'high' | 'low';
  title: string;
  advice: string;
  status: ContradictionStatus;
  /** The owner's answer on the card: Do it anyway / Don't / Update the note. */
  answer?: 'override' | 'deny' | 'update';
  /** The optional judge looked at this fuzzy flag. */
  judged?: boolean;
  at: string;
}

const RULE_TITLE: Record<RuleShape | 'fuzzy', string> = {
  'push-branch': 'Push to a branch you ruled out',
  'no-push': 'A push you ruled out',
  'force-push': 'A force push you ruled out',
  'tests-first': 'Push or commit before the tests ran',
  path: 'Changes a place you ruled out',
  'package-manager': 'A package manager you ruled out',
  command: 'A command you ruled out',
  fuzzy: 'May go against a note',
};

/** Parsed rules per note text (keyed by the text itself: ids repeat across spaces and databases). */
const RULE_CACHE = new Map<string, BindingRule[]>();
export function rulesOf(m: Memory): BindingRule[] {
  const key = `${m.content}\u0000${m.evidence ?? ''}`;
  const hit = RULE_CACHE.get(key);
  if (hit) return hit;
  let rules = parseRules(m.content);
  if (!rules.length && m.evidence && m.evidence !== 'You added this.') rules = parseRules(m.evidence);
  if (RULE_CACHE.size > 20_000) RULE_CACHE.clear();
  RULE_CACHE.set(key, rules);
  return rules;
}

export interface CheckInput {
  tool: string;
  args: Record<string, unknown>;
  callId: string;
  summary: string;
  conversationId: string;
  workspaceDir?: string;
  /** This turn's receipts plus earlier ones in the conversation (tests-first). */
  prior?: PriorRun[];
  /** Hardening M3: what another app's turn may draw on. */
  allow?: (m: Memory) => boolean;
  today?: string;
  now?: Date;
  /** Rules not to use here (team helpers don't share the turn's receipts: 'tests-first'). */
  skipShapes?: RuleShape[];
}

/** Notes the check reads (MemoryStore has them all). */
export type CheckSource = RankSource & { list(opts: { kind?: MemoryKind; limit?: number }): Memory[] };

/** Words that say nothing about a plan (fuzzy check). */
const FUZZY_SKIP = new Set(['alex', 'sara', 'wants', 'want', 'decided', 'agreed', 'together', 'always', 'never', 'only', 'should', 'must', 'make', 'sure', 'use', 'using', 'run', 'running', 'file', 'files', 'code', 'change', 'changes', 'thing', 'things', 'work', 'workspace', 'project', 'git', 'shell', 'command', 'commands', 'new', 'old', 'first', 'before', 'after', 'every', 'each', 'time', 'times', 'without', 'write', 'edit', 'read', 'add', 'test', 'tests', 'the', 'and', 'for']);

/**
 * Checks one planned tool call against the stored decisions (and rule-like facts). Pure apart from
 * the note store and reading .git/HEAD. Returns clear conflicts first, then fuzzy ones; at most
 * one per note.
 */
export function checkPlan(mem: CheckSource, input: CheckInput): Contradiction[] {
  if (READ_ONLY_TOOLS.has(input.tool)) return [];
  const plan = planOf(input.tool, input.args, { workspaceDir: input.workspaceDir, summary: input.summary });
  // Candidates: M1's ranking with the call as the query, decisions and facts only, matches only
  // (no standing pool), notes in this conversation's history included (oldestHistoryId: max).
  const ranked = rankMemories(mem, { query: plan.text, conversationId: input.conversationId, oldestHistoryId: Number.MAX_SAFE_INTEGER, standing: false, kinds: ['decision', 'fact'], ...(input.allow ? { allow: input.allow } : {}) });
  const byId = new Map<number, RankedPick | undefined>(ranked.map((p) => [p.memoryId, p]));
  // Decisions are few and binding: every current one is a candidate even when no word matched
  // ("tests before every push" vs `git push`). Newest first.
  for (const m of mem.list({ kind: 'decision', limit: 300 })) if (!byId.has(m.id) && m.supersededBy === null && (!input.allow || input.allow(m))) byId.set(m.id, undefined);
  const out: Contradiction[] = [];
  const planWords = new Set(queryWords(plan.text).map(stem));
  const at = (input.now ?? new Date()).toISOString();
  for (const [id, pick] of byId) {
    const m = pick?.memory ?? mem.get(id);
    if (!m || m.supersededBy !== null || (m.kind !== 'decision' && m.kind !== 'fact')) continue;
    const rules = rulesOf(m).filter((r) => !input.skipShapes?.includes(r.shape));
    let hit: { rule: BindingRule; matched: string; clear: boolean } | null = null;
    for (const r of rules) {
      const x = matchRule(r, plan, input.prior ?? []);
      if (x && (!hit || (x.clear && !hit.clear))) hit = { rule: r, ...x };
      if (hit?.clear) break;
    }
    let shape: RuleShape | 'fuzzy' | null = hit ? hit.rule.shape : null;
    let clear = hit?.clear ?? false;
    let matched = hit?.matched ?? '';
    if (!hit) {
      // Fuzzy: a rule-like note (negation / always / only) that shares two or more real words with
      // the call, and has no shape code could check. Flag only.
      if (!pick || pick.standing || rules.length || !readsAsRule(m.content)) continue;
      const shared = queryWords(m.content).filter((w) => !FUZZY_SKIP.has(w) && planWords.has(stem(w)));
      if (new Set(shared.map(stem)).size < 2) continue;
      shape = 'fuzzy';
      clear = false;
      matched = shared.slice(0, 4).join(', ');
    }
    const why = pick ? [...pick.why] : [`standing ${m.kind === 'decision' ? 'decision' : 'fact'}`];
    if (shape !== 'fuzzy') why.push(`rule: ${ruleWords(hit!.rule)}`);
    const sure: Confidence = clear ? 'high' : pick?.confidence === 'high' ? 'medium' : 'low';
    const bracket = pick ? bracketNote({ ...pick, why, confidence: sure }) : `[why: ${why.join(' + ')}; sure: ${sure}]`;
    out.push({
      source: 'contradiction',
      memoryId: m.id,
      kind: m.kind,
      note: m.content,
      quote: m.evidence && m.evidence !== 'You added this.' ? m.evidence : null,
      decidedOn: m.happenedOn,
      rule: shape!,
      target: shape === 'fuzzy' ? matched.split(', ') : hit!.rule.target.length ? hit!.rule.target : hit!.rule.verb ? [hit!.rule.verb] : [],
      words: pick?.words.slice(0, 6) ?? [],
      clear,
      matched: matched.slice(0, 300),
      tool: input.tool,
      callId: input.callId,
      summary: input.summary.slice(0, 300),
      why,
      sure,
      bracket,
      policyId: pick?.policyId ?? '',
      act: 'flag',
      severity: clear ? 'high' : 'low',
      title: RULE_TITLE[shape!],
      advice: clear ? 'Do it anyway, don\u2019t, or update the note if it has changed.' : 'She mentions it; nothing was stopped.',
      status: 'open',
      at,
    });
  }
  // Clear first; among them the most specific rule (a push to main reads better on the card than
  // "tests first"), decisions before facts, then newest.
  const rank = (c: Contradiction) => SHAPE_ORDER.indexOf(c.rule);
  return out.sort((a, b) => Number(b.clear) - Number(a.clear) || rank(a) - rank(b) || (a.kind === 'decision' ? -1 : 1) - (b.kind === 'decision' ? -1 : 1) || b.memoryId - a.memoryId).slice(0, 3);
}

const SHAPE_ORDER: (RuleShape | 'fuzzy')[] = ['push-branch', 'force-push', 'no-push', 'path', 'command', 'package-manager', 'tests-first', 'fuzzy'];

/** A rule in plain words (for the "why"). */
export function ruleWords(r: BindingRule): string {
  switch (r.shape) {
    case 'push-branch':
      return `no push to ${r.target.join(', ')}`;
    case 'no-push':
      return r.target[0] === '*' ? 'no push' : `no push to ${r.target[0]}`;
    case 'force-push':
      return 'no force push';
    case 'tests-first':
      return `tests before every ${r.verb ?? 'push'}`;
    case 'path':
      return r.exact ? `hands off ${r.target[0]}` : `hands off the ${r.target.join(' ')}`;
    case 'package-manager':
      return `not ${r.target[0]}`;
    case 'command':
      return `never ${r.target.join(' ')}`;
  }
}

// ---------------------------------------------------------------------------------------------
// What the turn does with it (the policy gate's decision, §2.3)
// ---------------------------------------------------------------------------------------------

export interface GateContext {
  settings: ContradictSettings;
  /** A coding conversation or a work channel (bridges' work chats). */
  work: boolean;
  /** A group chat: no approvals mid-round, so flags only. */
  group: boolean;
}

/**
 * Stop or flag (design §2.3 + §7 #4): a stop only for a CLEAR conflict, only in coding and work
 * conversations, only with strictness "Stop on clear conflicts". It can only ADD a stop: the
 * caller turns 'auto' into 'ask' and never touches 'ask' or 'never'.
 */
export function gateAct(found: Contradiction[], g: GateContext): 'stop' | 'flag' | 'none' {
  if (!g.settings.on || !found.length) return 'none';
  if (g.settings.mode === 'stop' && g.work && !g.group && found.some((c) => c.clear)) return 'stop';
  return 'flag';
}

/** The approval card's extra section (sent on the approval event, kept with the turn's approvals). */
export interface ContradictionCard {
  memoryId: number;
  note: string;
  quote: string | null;
  decidedOn: string;
  matched: string;
  rule: RuleShape | 'fuzzy';
  target: string[];
  words: string[];
  /** The English bracket note (`[why: …; sure: …]`); the app builds the same in its language from rule/target/words/sure. */
  bracket: string;
  sure: Confidence;
  /** Other clear conflicts of the same call (the answer applies to all of them). */
  also?: { memoryId: number; note: string; decidedOn: string }[];
}
export const cardOf = (c: Contradiction, others: Contradiction[] = []): ContradictionCard => ({
  memoryId: c.memoryId,
  note: c.note,
  quote: c.quote,
  decidedOn: c.decidedOn,
  matched: c.matched,
  rule: c.rule,
  target: c.target,
  words: c.words,
  bracket: c.bracket,
  sure: c.sure,
  ...(others.length ? { also: others.map((o) => ({ memoryId: o.memoryId, note: o.note, decidedOn: o.decidedOn })) } : {}),
});

/** Her short system note (flags, and every stop's outcome). The note is quoted as stored. */
export function contradictionNote(c: Contradiction, owner: string): string {
  const said = c.quote ? ` (${owner}'s words: "${c.quote}")` : '';
  const head = `[Note from the app: your planned action (${c.summary}) may go against what ${owner} decided on ${c.decidedOn}: "${c.note}"${said} ${c.bracket}.`;
  if (c.act === 'flag') return `${head} It was not stopped. Mention this to ${owner} briefly and plainly in your reply, quoting the note, and ask whether it still holds. Don't invent anything about the note.]`;
  if (c.answer === 'override') return `${head} ${owner} saw this and chose to do it anyway, so it ran. No need to bring it up again.]`;
  if (c.answer === 'update') return `${head} ${owner} stopped it to update the note first. Don't try it again in another way; wait for ${owner}.]`;
  return `${head} ${owner} said don't, so it did not run. Don't try the same thing another way; say what you'll do instead or ask.]`;
}

/** The plain tool result when a contradiction stop was declined. */
export function declinedOutput(c: Contradiction, owner: string): string {
  return c.answer === 'update'
    ? `${owner} stopped this to update the note first: "${c.note}". Do not run it another way; wait for ${owner}.`
    : `${owner} declined this action: it goes against what ${owner} decided on ${c.decidedOn}: "${c.note}".`;
}

// ---------------------------------------------------------------------------------------------
// Optional judge for fuzzy flags (the owner's claim-judge model; time-limited; fails open to flag)
// ---------------------------------------------------------------------------------------------

/** The judge's question (yes/no). Only ever drops a fuzzy flag; never adds a stop. */
export function judgePrompt(c: Contradiction): { system: string; user: string } {
  return {
    system: 'You check whether a planned action goes against a rule the user set. Answer with exactly YES or NO on the first line. YES only if doing the action would clearly break the rule as written; NO if it is unrelated, allowed by the rule, or unclear.',
    user: `Rule (the user's note): "${c.note}"\nPlanned action: ${c.summary}\nWhat matched: ${c.matched}`,
  };
}
export const judgeSaysNo = (out: string) => /^\s*no\b/i.test(out);
