// Phase 2 exit gate item 3: overhead baseline. Compares a raw local model call with the same user
// prompt as Sara sends it (persona + tool definitions), and measures Sara's own per-turn code
// overhead with an instant fake model.
//
//   node scripts/bench-overhead.ts [--model gemma4:12b] [--ollama http://127.0.0.1:11434] [--runs 5]
//
// Budget (ROADMAP Phase 2 exit item 3): generation speed through Sara >= 90 % of raw; Sara code
// overhead per step <= 50 ms; warm time-to-first-token increase <= 1000 ms.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTurn, type AppContext } from '../src/chat.ts';
import { buildSystemPrompt, loadPersona } from '../src/persona.ts';
import type { Provider, StreamEvent } from '../src/providers/types.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: {
    model: { type: 'string', default: 'gemma4:12b' },
    ollama: { type: 'string', default: 'http://127.0.0.1:11434' },
    runs: { type: 'string', default: '5' },
  },
});
const RUNS = Number(opt.runs);
const PROMPT = 'Tell me about your favourite place to go running, in about 150 words.';

interface Stat {
  genTps: number;
  promptTokens: number;
  ttftMs: number;
}

async function ollamaChat(messages: unknown[], tools?: unknown[]): Promise<Stat> {
  const res = await fetch(`${opt.ollama}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: opt.model, messages, ...(tools ? { tools } : {}), stream: false, options: { num_predict: 200, temperature: 0.7 } }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { eval_count: number; eval_duration: number; prompt_eval_count: number; prompt_eval_duration: number; load_duration: number };
  return { genTps: j.eval_count / (j.eval_duration / 1e9), promptTokens: j.prompt_eval_count, ttftMs: (j.load_duration + j.prompt_eval_duration) / 1e6 };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Interleaves raw and Sara runs (raw, sara, raw, sara, ...) so both see the same GPU conditions;
 * other work on a shared GPU otherwise skews whichever path happens to run during it.
 */
async function samplePair(rawFn: () => Promise<Stat>, saraFn: () => Promise<Stat>) {
  await rawFn();
  await saraFn(); // warm up both (model load + prompt cache)
  const raw: Stat[] = [];
  const sara: Stat[] = [];
  for (let i = 0; i < RUNS; i++) {
    raw.push(await rawFn());
    sara.push(await saraFn());
  }
  const sum = (label: string, s: Stat[]) => {
    const tps = s.map((x) => x.genTps);
    const r = { label, genTps: median(tps), minTps: Math.min(...tps), maxTps: Math.max(...tps), ttftMs: median(s.map((x) => x.ttftMs)), promptTokens: s[0].promptTokens };
    console.log(`${label}: ${r.genTps.toFixed(1)} tok/s (range ${r.minTps.toFixed(0)}-${r.maxTps.toFixed(0)}), warm TTFT ${r.ttftMs.toFixed(0)} ms, prompt ${r.promptTokens} tokens`);
    return r;
  };
  // Per-pair ratio is the fairest overhead measure.
  const ratio = median(raw.map((r, i) => sara[i].genTps / r.genTps));
  return { raw: sum('raw model', raw), sara: sum('through Sara (persona + tools)', sara), ratio };
}

async function saraCodeOverheadMs(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'sara-bench-'));
  try {
    const vault = new Vault(dir);
    const instant: Provider = {
      config: { id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' },
      listModels: async () => [],
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'text', text: 'ok' };
      },
    };
    const app: AppContext = {
      store: new Store(join(dir, 'sara.db')),
      settings: new SettingsStore(dir),
      vault,
      persona: loadPersona(join(ROOT, 'persona', 'sara.json')),
      now: () => new Date(),
      dataDir: dir,
      tools: new ToolRegistry(),
      approvals: new ApprovalBroker(),
      sandbox: { mode: 'none', network: true, detail: '' },
      redactor: new Redactor(() => vault.values()),
      snapshots: new SnapshotStore(dir),
      providerFactory: () => instant,
    };
    app.settings.update({ providers: [instant.config], defaultProviderId: 'p', defaultModel: 'm' });
    const conv = app.store.createConversation();
    // Build some history first so the measurement includes history loading.
    for (let i = 0; i < 40; i++) for await (const _ of runTurn(app, conv.id, `message ${i}`));
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      for await (const _ of runTurn(app, conv.id, `timed ${i}`));
      times.push(performance.now() - t0);
    }
    app.store.close();
    return median(times);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const persona = loadPersona(join(ROOT, 'persona', 'sara.json'));
const tools = new ToolRegistry().list();
const system = buildSystemPrompt(persona, { now: new Date(), ownerName: 'Alex', timeZone: 'America/Chicago', tools: tools.map((t) => t.spec.name), workspace: 'main' });
const toolDefs = tools.map((t) => ({ type: 'function', function: { name: t.spec.name, description: t.spec.description, parameters: t.spec.parameters } }));

const { raw, sara, ratio } = await samplePair(
  () => ollamaChat([{ role: 'user', content: PROMPT }]),
  () => ollamaChat([{ role: 'system', content: system }, { role: 'user', content: PROMPT }], toolDefs),
);
const codeMs = await saraCodeOverheadMs();
console.log(`Sara code overhead per turn (instant model, 40-turn history): ${codeMs.toFixed(1)} ms`);

const genRatio = ratio;
const ttftDelta = sara.ttftMs - raw.ttftMs;
const checks = [
  { name: 'generation speed through Sara >= 90 % of raw (median per-pair ratio)', ok: genRatio >= 0.9, value: `${(genRatio * 100).toFixed(1)} %` },
  { name: 'Sara code overhead per turn <= 50 ms', ok: codeMs <= 50, value: `${codeMs.toFixed(1)} ms` },
  { name: 'warm TTFT increase <= 1000 ms', ok: ttftDelta <= 1000, value: `${ttftDelta.toFixed(0)} ms` },
];
const date = new Date().toISOString().slice(0, 10);
const gpu = process.env.SARA_BENCH_HW ?? 'unspecified hardware';
const md = [
  `# Overhead baseline: ${date}`,
  '',
  `Model \`${opt.model}\` (local Ollama) on ${gpu}; ${RUNS} interleaved warm pairs (raw, Sara), median, 200 generated tokens.`,
  '',
  '| Path | Generation tok/s (median, range) | Warm TTFT | Prompt tokens |',
  '|---|---|---|---|',
  `| Raw model | ${raw.genTps.toFixed(1)} (${raw.minTps.toFixed(0)}-${raw.maxTps.toFixed(0)}) | ${raw.ttftMs.toFixed(0)} ms | ${raw.promptTokens} |`,
  `| Through Sara (persona + ${toolDefs.length} tool definitions) | ${sara.genTps.toFixed(1)} (${sara.minTps.toFixed(0)}-${sara.maxTps.toFixed(0)}) | ${sara.ttftMs.toFixed(0)} ms | ${sara.promptTokens} |`,
  '',
  `Sara's own code per turn (instant fake model, 40-turn history): ${codeMs.toFixed(1)} ms.`,
  '',
  '| Budget | Result | Value |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.value} |`),
  '',
].join('\n');
mkdirSync(join(ROOT, 'evals', 'results'), { recursive: true });
writeFileSync(join(ROOT, 'evals', 'results', `${date}-overhead.md`), md);
writeFileSync(join(ROOT, 'evals', 'results', `${date}-overhead.json`), JSON.stringify({ date, model: opt.model, hw: gpu, raw, sara, codeMs, checks, sara_version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version }, null, 2) + '\n');
console.log(md);
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
