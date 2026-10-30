// Phase 84 (harness track M9): the eval loop's routes. Owner-only: `evals` is not a member route
// family (src/household.ts MEMBER_ROUTES), so a household member gets 403 ownerOnly; the demo refuses
// (not in DEMO_READS). The work itself is src/evals.ts.
//   GET    /api/evals                 the list, the pick-lists, the schedule, the settings history
//   POST   /api/evals                 picks + freezes the tasks, checks the variants → the estimate (draft)
//                                     ({ from: id } = the same tasks and variants again)
//   GET    /api/evals/:id             one eval: tasks, runs, progress, result (live: the `eval` event)
//   POST   /api/evals/:id/start       { ceiling?: { tokens, usd } } the owner's yes to the estimate
//   POST   /api/evals/:id/stop
//   POST   /api/evals/:id/apply       { variant } "Use this setting" | { keep: true } "Keep mine"
//   DELETE /api/evals/:id
//   GET|PUT /api/evals/schedule       "Re-check monthly" (off by default)
import { HttpError, readJson, send } from '../http.ts';
import { ReplayError } from '../replay.ts';
import { sandboxGateSettings } from '../sandbox-run.ts';
import { BUDGET_PRESETS, CEILING_CHOICES, CONCURRENCY_CHOICES, DEFAULT_CONCURRENCY, DEFAULT_SCHEDULE, DEFAULT_TASKS, evalSchedule, EVAL_KINDS, HALF_LIFE_CHOICES, MAX_VARIANTS, MEMORY_PRESETS, SCHEDULE_BUDGETS, TASK_COUNTS, variantWords, WEIGHTS, type EvalView } from '../evals.ts';
import { SANDBOX_GATE_MODES } from '../sandbox-run.ts';
import { memorySettings } from '../memory-worker.ts';
import { recallMode } from '../triggers.ts';
import { turnBudgetSettings } from '../budget.ts';
import { NEXT, type RouteCtx, type RouteHandler } from './context.ts';

export function createEvalRoutes(ctx: RouteCtx): RouteHandler {
  const { app } = ctx;
  const asHttp = (err: unknown): never => {
    if (err instanceof ReplayError) throw new HttpError(err.status, err.key, err.params ? { params: err.params } : undefined);
    throw err;
  };
  /** The list view: the tasks without their long texts. */
  const brief = (e: EvalView) => ({ ...e, tasks: e.tasks.map((t) => ({ idx: t.idx, runId: t.runId, title: t.title, coding: t.coding, private: t.private, feedback: t.feedback.kind, tests: t.tests })), result: e.result ? { winner: e.result.winner, headline: e.result.headline, variants: e.result.variants } : null, words: e.variants.map(variantWords), running: app.evals?.running(e.id) ?? false });
  return async (req, res, method, parts) => {
    const [a, b, c] = parts;
    if (a !== 'evals') return NEXT;
    const evals = app.evals;
    if (!evals || !app.runs) {
      if (method !== 'GET') await readJson(req).catch(() => ({}));
      throw new HttpError(404, 'Evals are not available here.');
    }
    if (b === 'schedule' && !c) {
      if (method === 'PUT') {
        const body = await readJson(req);
        const cur = evalSchedule(app.settings.get());
        const next = { ...cur };
        if (typeof body.monthly === 'boolean') next.monthly = body.monthly;
        if (body.budgetTokens !== undefined) {
          if (!(SCHEDULE_BUDGETS as readonly number[]).includes(Number(body.budgetTokens))) throw new HttpError(400, 'Pick one of the listed budgets.');
          next.budgetTokens = Number(body.budgetTokens);
        }
        app.settings.update({ evalSchedule: next });
        if (next.monthly !== cur.monthly) evals.store.addHistory({ source: 'owner', ref: null, what: next.monthly ? 'Evals: re-check monthly switched on' : 'Evals: re-check monthly switched off', changes: [{ key: 'evalSchedule.monthly', before: cur.monthly, after: next.monthly }] });
      } else if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      return send(res, 200, { ...evalSchedule(app.settings.get()), choices: SCHEDULE_BUDGETS, defaults: DEFAULT_SCHEDULE });
    }
    if (!b) {
      if (method === 'GET') {
        const s = app.settings.get();
        const mem = memorySettings(app);
        return send(res, 200, {
          evals: evals.store.list(30).map(brief),
          choices: { kinds: EVAL_KINDS, counts: TASK_COUNTS, count: DEFAULT_TASKS, maxVariants: MAX_VARIANTS, memory: MEMORY_PRESETS, halfLife: HALF_LIFE_CHOICES, sandbox: SANDBOX_GATE_MODES, budgets: BUDGET_PRESETS, concurrency: CONCURRENCY_CHOICES, defaultConcurrency: DEFAULT_CONCURRENCY, ceilings: CEILING_CHOICES, models: evals.models() },
          now: { fade: mem.fade ?? 'never', halfLifeDays: mem.decay?.halfLifeDays ?? null, sandbox: sandboxGateSettings(s).mode, budget: turnBudgetSettings(s).coding, recall: recallMode(mem) },
          judgeModel: Boolean(s.routes?.review || s.routes?.coding),
          weights: WEIGHTS,
          schedule: evalSchedule(s),
          history: evals.store.history(20),
        });
      }
      if (method === 'POST') {
        const body = await readJson(req);
        try {
          return send(res, 201, { eval: evals.create(body) });
        } catch (err) {
          return asHttp(err);
        }
      }
      throw new HttpError(405, 'Method not allowed');
    }
    if (!/^\d{1,12}$/.test(b)) {
      if (method !== 'GET') await readJson(req).catch(() => ({}));
      throw new HttpError(404, 'No such eval.');
    }
    const id = Number(b);
    if (!c) {
      if (method === 'GET') {
        const ev = evals.store.get(id);
        if (!ev) throw new HttpError(404, 'No such eval.');
        const runs = evals.store.runs(id).map((r) => ({ ...r, answer: r.answer.length > 600 ? `${r.answer.slice(0, 600)}…` : r.answer }));
        return send(res, 200, { eval: { ...ev, words: ev.variants.map(variantWords), running: evals.running(id) }, runs });
      }
      if (method === 'DELETE') {
        if (evals.running(id)) throw new HttpError(409, 'Stop the eval first.');
        if (!evals.store.delete(id)) throw new HttpError(404, 'No such eval.');
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed');
    }
    if (method === 'POST' && !parts[3] && (c === 'start' || c === 'stop' || c === 'apply')) {
      const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
      try {
        if (c === 'start') {
          const ceil = body.ceiling && typeof body.ceiling === 'object' ? (body.ceiling as Record<string, unknown>) : undefined;
          if (body.confirm !== true) throw new HttpError(400, 'Confirm the estimate and the ceiling first.');
          return send(res, 202, { eval: evals.start(id, ceil ? { ceiling: { ...(ceil.tokens !== undefined ? { tokens: Number(ceil.tokens) } : {}), ...(ceil.usd !== undefined ? { usd: Number(ceil.usd) } : {}) } } : {}) });
        }
        if (c === 'stop') {
          if (!evals.stop(id)) throw new HttpError(404, 'That eval is not running.');
          return send(res, 200, { stopped: true });
        }
        return send(res, 200, evals.apply(id, { ...(typeof body.variant === 'string' ? { variant: body.variant } : {}), ...(body.keep === true ? { keep: true } : {}) }));
      } catch (err) {
        return asHttp(err);
      }
    }
    if (method !== 'GET') await readJson(req).catch(() => ({}));
    throw new HttpError(404, 'Not found');
  };
}
