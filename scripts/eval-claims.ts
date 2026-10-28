// Phase 62: how well the receipt check catches unbacked action claims in six languages.
//
// evals/claims-multilingual.json holds hand-written replies (en, es, fr, de, pt-BR, it; at least
// 40 per language per set, half of them real unbacked claims) with the tools that ran in that turn.
// This scores the pattern pass alone and, when a local model answers, the patterns plus the
// optional claim judge (asked only about the sentences the patterns are unsure about, exactly as
// in a chat turn). Precision and recall per language, per set ('dev' was used to write the
// patterns; 'heldout' was written after they were frozen).
//
//   node scripts/eval-claims.ts                                  (patterns only)
//   node scripts/eval-claims.ts --judge qwen3.5:9b               (+ the judge, on Ollama)
//        [--ollama http://127.0.0.1:11434/v1] [--timeout 8000] [--set heldout]
//        [--receipts <other receipts.ts>]   (score another version of the patterns, e.g. an older one)
//
// The result is written to evals/results/<date>-claims.json. Nothing leaves this computer unless
// --ollama points somewhere else.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Claim, Receipt, UnsureClaim } from '../src/receipts.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Item {
  claim: boolean;
  text: string;
  tools?: string[];
}
export interface Score {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

/** 'name', 'name:action' (args.action) or 'shell$<command>' (args.command), all with status ok. */
export function receiptsFor(tools: string[] = []): Receipt[] {
  return tools.map((t) => {
    const cmd = /^shell\$(.*)$/s.exec(t);
    if (cmd) return { name: 'shell', status: 'ok', args: { command: cmd[1] }, output: '[exit code 0]\n' };
    const [name, action] = t.split(':');
    return { name, status: 'ok', args: action ? { action } : {}, output: '[exit code 0]\n' };
  });
}

export function score(rows: { claim: boolean; flagged: boolean }[]): Score {
  const n = (f: (r: { claim: boolean; flagged: boolean }) => boolean) => rows.filter(f).length;
  const tp = n((r) => r.claim && r.flagged);
  const fp = n((r) => !r.claim && r.flagged);
  const fn = n((r) => r.claim && !r.flagged);
  const tn = n((r) => !r.claim && !r.flagged);
  const r2 = (x: number) => Math.round(x * 1000) / 1000;
  return { tp, fp, fn, tn, precision: r2(tp + fp ? tp / (tp + fp) : 1), recall: r2(tp + fn ? tp / (tp + fn) : 1) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: opt } = parseArgs({
    options: {
      judge: { type: 'string', default: '' },
      ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' },
      timeout: { type: 'string', default: '' },
      set: { type: 'string', default: '' },
      receipts: { type: 'string', default: '' },
    },
  });
  const mod = (await import(opt.receipts ? pathToFileURL(resolve(opt.receipts)).href : '../src/receipts.ts')) as typeof import('../src/receipts.ts');
  const data = JSON.parse(readFileSync(join(ROOT, 'evals', 'claims-multilingual.json'), 'utf8')) as { sets: Record<string, Record<string, Item[]>> };
  const sets = Object.keys(data.sets).filter((s) => !opt.set || s === opt.set);
  const timeoutMs = Number(opt.timeout) || mod.CLAIM_JUDGE_TIMEOUT_MS || 8000;

  // The judge goes through Sara's own provider code, as in a chat turn.
  let ask: ((system: string, user: string, signal: AbortSignal) => Promise<string>) | undefined;
  let judgeNote = 'not run (no --judge given)';
  const calls: { ms: number; timedOut: boolean; error?: string }[] = [];
  if (opt.judge && typeof mod.unsureClaims === 'function' && typeof mod.confirmClaims === 'function') {
    const { createProvider } = await import('../src/providers/registry.ts');
    const provider = createProvider({ id: 'judge', label: 'Judge', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true });
    const once = async (system: string, user: string, signal: AbortSignal) => {
      let out = '';
      for await (const ev of provider.stream({ model: opt.judge!, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, maxTokens: 160, reasoning: 'none', signal })) if (ev.type === 'text') out += ev.text;
      return out;
    };
    try {
      // Warm-up: loading a model takes longer than the judge's time limit; a chat server keeps it loaded.
      const t0 = Date.now();
      await once('Answer with one word.', 'Say OK.', AbortSignal.timeout(180_000));
      judgeNote = `${opt.judge} at ${opt.ollama} (warm-up ${Math.round((Date.now() - t0) / 100) / 10} s)`;
      ask = async (system, user, signal) => {
        const t = Date.now();
        try {
          const out = await once(system, user, signal);
          calls.push({ ms: Date.now() - t, timedOut: false });
          return out;
        } catch (err) {
          calls.push({ ms: Date.now() - t, timedOut: signal.aborted, error: (err as Error).message.slice(0, 120) });
          throw err;
        }
      };
    } catch (err) {
      judgeNote = `not reachable: ${(err as Error).message.slice(0, 200)}`;
    }
  } else if (opt.judge) judgeNote = 'this version of the receipt check has no judge step';
  console.log(`Claim check eval: ${sets.join(', ')}; judge: ${judgeNote}`);

  type Row = { set: string; lang: string; text: string; claim: boolean; patterns: boolean; judged: boolean; withJudge: boolean; unsure: number };
  const rows: Row[] = [];
  for (const set of sets) {
    for (const [lang, items] of Object.entries(data.sets[set])) {
      for (const it of items) {
        const receipts = receiptsFor(it.tools);
        const flagged: Claim[] = mod.checkClaims(it.text, receipts);
        let unsure: UnsureClaim[] = [];
        let judged = false;
        if (!flagged.length && typeof mod.unsureClaims === 'function') {
          unsure = mod.unsureClaims(it.text, receipts, [], flagged);
          if (ask && unsure.length) judged = (await mod.confirmClaims(ask, unsure, timeoutMs)).length > 0;
        }
        rows.push({ set, lang, text: it.text, claim: it.claim, patterns: flagged.length > 0, judged, withJudge: flagged.length > 0 || judged, unsure: unsure.length });
      }
    }
  }

  const table: Record<string, Record<string, { n: number; patterns: Score; withJudge?: Score; askedJudge: number }>> = {};
  for (const set of sets) {
    table[set] = {};
    const langs = [...new Set(rows.filter((r) => r.set === set).map((r) => r.lang))];
    for (const lang of [...langs, 'all']) {
      const rs = rows.filter((r) => r.set === set && (lang === 'all' || r.lang === lang));
      table[set][lang] = {
        n: rs.length,
        patterns: score(rs.map((r) => ({ claim: r.claim, flagged: r.patterns }))),
        ...(ask ? { withJudge: score(rs.map((r) => ({ claim: r.claim, flagged: r.withJudge }))) } : {}),
        askedJudge: rs.filter((r) => r.unsure > 0).length,
      };
    }
  }
  for (const set of sets) {
    console.log(`\n${set}:`);
    console.log(`  lang    n   patterns P / R${ask ? '      + judge P / R' : ''}   sent to judge`);
    for (const [lang, t] of Object.entries(table[set])) {
      const f = (s: Score) => `${s.precision.toFixed(2)} / ${s.recall.toFixed(2)}`;
      console.log(`  ${lang.padEnd(6)} ${String(t.n).padStart(3)}   ${f(t.patterns)}${t.withJudge ? `      ${f(t.withJudge)}` : ''}   ${t.askedJudge}`);
    }
    const wrong = rows.filter((r) => r.set === set && (r.claim !== r.patterns || r.claim !== r.withJudge));
    for (const r of wrong) console.log(`    ${r.claim ? 'MISS' : 'FALSE'} [${r.lang}] patterns ${r.patterns ? 'flag' : '-'}${ask ? `, +judge ${r.withJudge ? 'flag' : '-'}` : ''}${r.unsure ? ' (asked)' : ''}: ${r.text.replace(/\n/g, ' ').slice(0, 110)}`);
  }
  const judgeStats = calls.length ? { calls: calls.length, timeouts: calls.filter((c) => c.timedOut).length, errors: calls.filter((c) => c.error && !c.timedOut).length, medianMs: [...calls].sort((a, b) => a.ms - b.ms)[Math.floor(calls.length / 2)].ms, maxMs: Math.max(...calls.map((c) => c.ms)) } : null;
  if (judgeStats) console.log(`\nJudge: ${judgeStats.calls} calls, median ${judgeStats.medianMs} ms, slowest ${judgeStats.maxMs} ms, ${judgeStats.timeouts} timed out (limit ${timeoutMs} ms), ${judgeStats.errors} errors.`);

  const at = new Date();
  const out = join(ROOT, 'evals', 'results', `${at.toISOString().slice(0, 10)}-claims${opt.receipts ? '-other' : ''}${ask ? `-${opt.judge!.replace(/[^\w.-]+/g, '_')}` : ''}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ eval: 'claim check, six languages (scripts/eval-claims.ts)', at: at.toISOString(), receipts: opt.receipts || 'src/receipts.ts', judge: judgeNote, judgeTimeoutMs: ask ? timeoutMs : null, judgeStats, table, rows }, null, 2)}\n`);
  console.log(`Results: ${out}`);
}
