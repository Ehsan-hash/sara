// Phase 54: publish the benchmark and eval results. The raw result files in evals/results/ stay
// private (they hold whole replies); this writes short, sanitised summaries to docs/results/:
// scores, models, dates, timings and per-item pass/fail, with no model replies or transcripts.
// Then it prints the Markdown table used in docs/RESULTS.md and the README.
//   node scripts/publish-results.ts            (newest result of each kind)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'evals', 'results');
const OUT = join(ROOT, 'docs', 'results');

/** Newest file in evals/results/ whose name is <date>-<kind>.json. */
export function newest(files: string[], kind: string): string | undefined {
  return files.filter((f) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${kind}\\.json$`).test(f)).sort().at(-1);
}

const asList = <T>(j: unknown): T[] => (Array.isArray(j) ? (j as T[]) : [j as T]);

interface CodingRun {
  benchmark: string;
  mode: string;
  model: string;
  at: string;
  finished: string;
  python: string;
  platform: string;
  first?: string;
  tasks: number;
  pass: number;
  pass1: number;
  seconds: number;
  runs: { task: string; pass: boolean; seconds: number; toolCalls: number; error?: string }[];
}

export function codingSummary(r: CodingRun, source: string) {
  return {
    benchmark: r.benchmark,
    mode: r.mode,
    model: r.model,
    started: r.at,
    finished: r.finished,
    python: r.python,
    platform: r.platform,
    tasks: r.tasks,
    passed: r.pass,
    pass1: r.pass1,
    minutes: Math.round(r.seconds / 6) / 10,
    failed: r.runs.filter((x) => !x.pass).map((x) => x.task),
    stopped: r.runs.filter((x) => x.error).map((x) => ({ task: x.task, error: x.error })),
    runs: r.runs.map((x) => ({ task: x.task, pass: x.pass, seconds: x.seconds, toolCalls: x.toolCalls })),
    source,
  };
}

/** Phase 58: the repository-task benchmark (scripts/bench-tasks.ts): the coding summary plus each task's kind and language. */
type TaskRun = CodingRun['runs'][number] & { title?: string; kind?: string; lang?: string; filesChanged?: number };
export function tasksSummary(r: Omit<CodingRun, 'runs'> & { runs: TaskRun[] }, source: string, all: { at: string; pass: number; tasks: number; runs: TaskRun[] }[] = [r]) {
  const base = codingSummary(r, source);
  const byKind: Record<string, { passed: number; of: number }> = {};
  for (const x of r.runs) {
    const k = (byKind[x.kind ?? 'other'] ??= { passed: 0, of: 0 });
    k.of++;
    if (x.pass) k.passed++;
  }
  // Every run in the file, so a better run never hides a worse one.
  const everyRun = all.map((x) => ({ started: x.at, passed: x.pass, of: x.tasks, failed: x.runs.filter((y) => !y.pass).map((y) => y.task) }));
  return { ...base, byKind, everyRun, runs: r.runs.map((x) => ({ task: x.task, title: x.title, kind: x.kind, lang: x.lang, pass: x.pass, seconds: x.seconds, toolCalls: x.toolCalls, filesChanged: x.filesChanged })) };
}

export function memorySummary(j: { date: string; model: string; sara: string; rows: { step: string; failures?: string[] }[] }, source: string) {
  const checks = j.rows.map((r) => ({ check: r.step, pass: !r.failures?.length }));
  return { eval: 'memory golden set (scripts/eval-memory.ts)', date: j.date, model: j.model, sara: j.sara, passed: checks.filter((c) => c.pass).length, of: checks.length, checks, source };
}

export function librarySummary(j: { model: string; embed: string | null; pass: string; results: { run: number; ask: string; ok: boolean; tools?: string[] }[] }, source: string) {
  const runs = [...new Set(j.results.map((r) => r.run))].map((run) => {
    const rs = j.results.filter((r) => r.run === run);
    return { run, passed: rs.filter((r) => r.ok).length, of: rs.length, questions: rs.map((r) => ({ ask: r.ask, pass: r.ok })) };
  });
  return { eval: 'library (scripts/eval-library.ts)', date: source.slice(0, 10), model: j.model, embed: j.embed, passMark: j.pass, runs, source };
}

export function codemapSummary(all: { at: string; model: string; embed: string | null; files: number; with?: Mode; without?: Mode }[], source: string) {
  // The newest run that has both modes, else the newest run.
  const r = [...all].reverse().find((x) => x.with && x.without) ?? all.at(-1)!;
  const mode = (m?: Mode) => m && { passed: m.pass, of: m.of, toolCalls: m.toolCalls, filesRead: m.filesRead, seconds: m.seconds, questions: m.runs.map((q) => ({ ask: q.ask, pass: q.pass, toolCalls: q.toolCalls })) };
  return { eval: 'code map (scripts/eval-codemap.ts)', date: r.at, model: r.model, embed: r.embed, files: r.files, withoutCodeTools: mode(r.without), withCodeTools: mode(r.with), everyRunThatDay: all.map((x) => ({ at: x.at, with: x.with ? `${x.with.pass}/${x.with.of}` : null, without: x.without ? `${x.without.pass}/${x.without.of}` : null })), source };
}
type Mode = { pass: number; of: number; toolCalls: number; filesRead: number; seconds: number; runs: { ask: string; pass: boolean; toolCalls: number }[] };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = existsSync(RAW) ? readdirSync(RAW) : [];
  mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];
  const write = (name: string, data: unknown) => writeFileSync(join(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
  const read = (f: string) => JSON.parse(readFileSync(join(RAW, f), 'utf8')) as unknown;

  for (const mode of ['agent', 'raw']) {
    const f = newest(files, `coding-${mode}`);
    if (!f) continue;
    const r = asList<CodingRun>(read(f)).sort((a, b) => b.tasks - a.tasks || b.at.localeCompare(a.at))[0];
    const s = codingSummary(r, f);
    write(`humaneval-${mode}.json`, s);
    rows.push(`| HumanEval (${mode === 'agent' ? 'her agent loop: tools + tests' : 'plain completion, no tools'}) | ${s.model} | **${s.passed}/${s.tasks}** (pass@1 ${s.pass1}%) | ${s.started.slice(0, 10)} | \`node scripts/bench-coding.ts --mode ${mode}\` |`);
  }
  for (const mode of ['agent', 'raw']) {
    const f = newest(files, `tasks-${mode}`);
    if (!f) continue;
    const all = asList<Parameters<typeof tasksSummary>[0]>(read(f));
    const r = [...all].sort((a, b) => b.tasks - a.tasks || b.at.localeCompare(a.at))[0];
    const s = tasksSummary(r, f, all);
    write(`tasks-${mode}.json`, s);
    rows.push(`| Repository tasks (${mode === 'agent' ? 'her agent loop: reads, runs the tests, edits' : 'plain completion, every file in one prompt, no tools'}) | ${s.model} | **${s.passed}/${s.tasks}** | ${s.started.slice(0, 10)} | \`node scripts/bench-tasks.ts --mode ${mode}\` |`);
  }
  const mem = newest(files, 'memory');
  if (mem) {
    const s = memorySummary(read(mem) as Parameters<typeof memorySummary>[0], mem);
    write('memory.json', s);
    rows.push(`| Memory across sessions | ${s.model} | **${s.passed}/${s.of}** checks | ${s.date} | \`node scripts/eval-memory.ts --model <model>\` |`);
  }
  for (const kind of ['library', 'library-meaning']) {
    const f = newest(files, kind);
    if (!f) continue;
    const s = librarySummary(read(f) as Parameters<typeof librarySummary>[0], f);
    write(`${kind}.json`, s);
    rows.push(`| Library (documents${s.embed ? ' + meaning search' : ''}) | ${s.model} | **${s.runs.map((r) => `${r.passed}/${r.of}`).join(', ')}** per run | ${s.date} | \`node scripts/eval-library.ts --model <model>${s.embed ? ` --embed ${s.embed}` : ''}\` |`);
  }
  const cm = newest(files, 'codemap');
  if (cm) {
    const s = codemapSummary(asList(read(cm)), cm);
    write('codemap.json', s);
    const w = s.withCodeTools;
    const wo = s.withoutCodeTools;
    rows.push(`| Code map (questions about Sara's own code) | ${s.model} | **${w ? `${w.passed}/${w.of}` : '–'}** with code tools, ${wo ? `${wo.passed}/${wo.of}` : '–'} without | ${s.date.slice(0, 10)} | \`node scripts/eval-codemap.ts --embed nomic-embed-text\` |`);
  }
  console.log(['| Benchmark | Model | Score | Date | Re-run |', '|---|---|---|---|---|', ...rows].join('\n'));
  console.log(`\nWrote ${readdirSync(OUT).length} summary file(s) to docs/results/.`);
}
