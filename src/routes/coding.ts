// Coding: workspaces, approvals, jobs, starters, GitHub, code projects, code map, recipes, team, previews, SSH.
// Moved from src/server.ts unchanged (wave 3); shared state comes from the RouteCtx (src/routes/context.ts).
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildHistory, resolveChain } from '../chat.ts';
import { historyRange, KEEP_DAY_CHOICES, runSettings } from '../runs.ts';
import { DEFAULT_SANDBOX_GATE, mergeSandboxGate, SANDBOX_GATE_MODES, SANDBOX_SIZE_CHOICES, SANDBOX_TIME_CHOICES, sandboxGateSettings } from '../sandbox-run.ts';
import { DEFAULT_TURN_BUDGETS, mergeTurnBudgets, MINUTE_CHOICES, STEP_CHOICES, TOKEN_CHOICES, turnBudgetSettings, USD_CHOICES } from '../budget.ts';
import { as400, HttpError, readJson, send, validWorkspace } from '../http.ts';
import { trOwner } from '../i18n.ts';
import { checkIssues, cleanWatch, type OpenIssue, openIssues, startFromIssue, watchSettings } from '../issues.ts';
import { netFetch, privateLocalOn } from '../net-guard.ts';
import { identityOf } from '../persona.ts';
import { previewUrl } from '../preview.ts';
import type { Settings } from '../settings.ts';
import { SAVE_PASSWORD_WARNING, SshError } from '../ssh.ts';
import { createFromStarter, listStarters } from '../starters.ts';
import type { Conversation } from '../store.ts';
import { cleanHelpers, cleanLimits, ROLES, teamHelpers, type TeamLimits, type TeamTask } from '../team.ts';
import { GIT_SAFE, GITHUB_VAULT, shq } from '../tools/coding.ts';
import { APPROVAL_HOWS, type ApprovalHow } from '../tools/registry.ts';
import { runCommand } from '../tools/sandbox.ts';
import { resolveInside, workspaceDir } from '../tools/workspace.ts';
import { cleanBudget, usageLine } from '../usage.ts';
import { FINDING_SEVERITIES, FINDING_SOURCES, FINDING_STATUSES, type FindingSeverity, type FindingSource, type FindingStatus } from '../security/findings.ts';
import { DEFAULT_SECURITY, mergeSecurity, REVIEW_BUDGET_CHOICES, SECURITY_MODES, securitySettings } from '../security/pass.ts';
import { NEXT, type RouteCtx, type RouteHandler } from './context.ts';

export function createCodingRoutes(ctx: RouteCtx): RouteHandler {
  const { active, app, me, opts, projectOrThrow, rootDir } = ctx;
  return async (req, res, method, parts) => {
    const [a, b, c] = parts;
    // Phase 78: run snapshots (read only; time-travel is M8). The owner's own space; a household
    // member's space answers from that member's own database; the demo refuses (not in DEMO_READS).
    // Phase 79: per-reply budgets (Settings → Abilities → Budgets). Owner-only (members follow the
    // owner's: OWNER_SETTINGS); the demo refuses (not in DEMO_READS).
    if (a === 'budgets' && !b) {
      if (method === 'PUT') {
        const body = await readJson(req);
        app.settings.update({ turnBudgets: mergeTurnBudgets(turnBudgetSettings(app.settings.get()), body) });
      } else if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const s = app.settings.get();
      const quick = s.routes?.quick;
      return send(res, 200, { ...turnBudgetSettings(s), choices: { tokens: TOKEN_CHOICES, steps: STEP_CHOICES, usd: USD_CHOICES, minutes: MINUTE_CHOICES }, quickSet: Boolean(quick && s.providers.some((p) => p.id === quick.providerId)), defaults: DEFAULT_TURN_BUDGETS });
    }
    // Phase 80: "Try commands in a sandbox first" (Settings → Abilities → Coding projects). Owner-only
    // (members follow the owner's: OWNER_SETTINGS); the demo refuses (not in DEMO_READS). `?recheck=1`
    // looks for Docker / WSL2 again.
    if (a === 'sandbox' && !b) {
      const gate = app.sandboxGate;
      if (!gate) throw new HttpError(404, 'Sandbox tries are not available here.');
      if (method === 'PUT') {
        const body = await readJson(req);
        app.settings.update({ sandboxGate: mergeSandboxGate(sandboxGateSettings(app.settings.get()), body) });
      } else if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const iso = gate.isolation(new URL(req.url ?? '/', 'http://x').searchParams.get('recheck') === '1');
      return send(res, 200, { ...sandboxGateSettings(app.settings.get()), choices: { mode: SANDBOX_GATE_MODES, maxMB: SANDBOX_SIZE_CHOICES, timeLimitS: SANDBOX_TIME_CHOICES }, defaults: DEFAULT_SANDBOX_GATE, isolation: { driver: iso.driver, isolated: iso.isolated, label: iso.label, ...(iso.found ? { found: iso.found } : {}) }, platform: process.platform });
    }
    // Phase 81 (harness M6): the security pass (Settings → Abilities → Coding projects). Owner-only
    // (members have no coding; OWNER_SETTINGS); the demo refuses (not in DEMO_READS). `?preview=1`
    // lists the packages live advisories would send to OSV.dev (shown before switching them on).
    if (a === 'security-pass' && !b) {
      const sec = app.security;
      if (!sec) throw new HttpError(404, 'The security pass is not available here.');
      if (method === 'PUT') {
        const body = await readJson(req);
        app.settings.update({ securityPass: mergeSecurity(securitySettings(app.settings.get()), body) });
      } else if (method === 'DELETE') {
        sec.osv.clearCache();
      } else if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const wsRoot = join(rootDir, 'workspaces');
      const preview = q.get('preview') === '1' ? sec.previewPackages((existsSync(wsRoot) ? readdirSync(wsRoot, { withFileTypes: true }) : []).filter((e) => e.isDirectory()).map((e) => ({ name: e.name, dir: join(wsRoot, e.name) }))) : undefined;
      return send(res, 200, { ...securitySettings(app.settings.get()), choices: { mode: SECURITY_MODES, budgetTokens: REVIEW_BUDGET_CHOICES }, defaults: DEFAULT_SECURITY, privateLocal: privateLocalOn(), cached: sec.osv.cacheSize(), reviewModel: Boolean(app.settings.get().routes?.review), ...(preview ? { preview } : {}) });
    }
    // Phase 81: the findings table (per project and per run), dismiss / accept with a reason, the
    // fix-branch loop (Apply to my branch / Keep the branch / Discard), "Fix all high", "Check now".
    if (a === 'findings') {
      const store = app.findings;
      if (!store) throw new HttpError(404, 'Findings are not available here.');
      const id = b && /^\d+$/.test(b) ? Number(b) : 0;
      if (!b && method === 'GET') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const status = q.get('status') ?? 'open';
        const filter = {
          ...(q.get('workspace') ? { workspace: validWorkspace(q.get('workspace')) } : {}),
          ...(q.get('conversationId') ? { conversationId: String(q.get('conversationId')) } : {}),
          ...(Number(q.get('runId')) > 0 ? { runId: Number(q.get('runId')) } : {}),
          ...(FINDING_SEVERITIES.includes(q.get('severity') as FindingSeverity) ? { severity: q.get('severity') as FindingSeverity } : {}),
          ...(FINDING_SOURCES.includes(q.get('source') as FindingSource) ? { source: q.get('source') as FindingSource } : {}),
        };
        const list = store.list({ ...filter, status: status === 'all' || FINDING_STATUSES.includes(status as FindingStatus) ? (status as FindingStatus | 'all') : 'open' });
        return send(res, 200, { findings: list.map((f) => ({ ...f, canFix: app.fixes ? !app.fixes.why(f) : false })), counts: store.counts({ ...(filter.workspace ? { workspace: filter.workspace } : {}), ...(filter.conversationId ? { conversationId: filter.conversationId } : {}), ...(filter.runId ? { runId: filter.runId } : {}) }), workspaces: store.workspaces(), settings: app.security ? securitySettings(app.settings.get()) : null });
      }
      if (b === 'scan' && !c && method === 'POST') {
        // "Check now" (also the "Only when I ask" mode): the uncommitted files, or the whole project.
        const body = await readJson(req);
        const sec = app.security;
        if (!sec) throw new HttpError(404, 'The security pass is not available here.');
        const conv = body.conversationId ? app.store.getConversation(String(body.conversationId)) : undefined;
        if (body.conversationId && !conv) throw new HttpError(404, 'Conversation not found');
        if (conv && conv.mode !== 'coding') throw new HttpError(400, 'The security pass is for coding conversations.');
        const workspace = conv ? conv.workspace : validWorkspace(body.workspace);
        const wsDir = workspaceDir(rootDir, workspace);
        const files = sec.filesToCheck(wsDir);
        const summary = await sec.run({ conversationId: conv?.id ?? null, workspace, wsDir, files, reason: 'ask', private: Boolean(conv?.private) });
        return send(res, 200, { summary });
      }
      if (b === 'fix-all' && !c && method === 'POST') {
        const body = await readJson(req);
        if (!app.fixes) throw new HttpError(404, 'The fix loop is not available here.');
        return send(res, 200, app.fixes.startAll(validWorkspace(body.workspace)));
      }
      if (!id) {
        if (method !== 'GET') await readJson(req).catch(() => ({}));
        throw new HttpError(404, 'Not found');
      }
      const f = store.get(id);
      if (!f) {
        if (method !== 'GET') await readJson(req).catch(() => ({}));
        throw new HttpError(404, 'Finding not found.');
      }
      if (!c && method === 'GET') return send(res, 200, { finding: { ...f, canFix: app.fixes ? !app.fixes.why(f) : false }, ...(app.fixes?.why(f) ? { whyNot: app.fixes.why(f) } : {}) });
      if (c === 'status' && method === 'POST') {
        const body = await readJson(req);
        const status = String(body.status ?? '');
        if (!(['open', 'dismissed', 'accepted'] as string[]).includes(status)) throw new HttpError(400, 'Status: open, dismissed or accepted.');
        const reason = String(body.reason ?? '').trim().slice(0, 500);
        if (status !== 'open' && !reason) throw new HttpError(400, 'Say why (a reason is kept with the finding).');
        return send(res, 200, { finding: store.setStatus(id, status as FindingStatus, status === 'open' ? null : reason) });
      }
      if (c === 'fix' && method === 'POST') {
        const fixes = app.fixes;
        if (!fixes) throw new HttpError(404, 'The fix loop is not available here.');
        const how = parts[3];
        await readJson(req).catch(() => ({}));
        try {
          if (!how) return send(res, 202, { finding: fixes.start(id) });
          if (how === 'apply') return send(res, 200, { finding: fixes.apply(id) });
          if (how === 'keep') return send(res, 200, { finding: fixes.keep(id) });
          if (how === 'discard') return send(res, 200, { finding: fixes.discard(id) });
        } catch (err) {
          throw new HttpError(409, (err as Error).message);
        }
        throw new HttpError(404, 'Not found');
      }
      if (method !== 'GET') await readJson(req).catch(() => ({}));
      throw new HttpError(405, 'Method not allowed');
    }
    if (a === 'runs') {
      const runs = app.runs;
      if (!runs) throw new HttpError(404, 'Run history is not available here.');
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const statsView = () => {
        const st = runs.stats();
        return { ...st, mb: Math.round((st.bytes / 1048576) * 100) / 100 };
      };
      if (b === 'settings' && !c) {
        if (method === 'PUT') {
          const body = await readJson(req);
          const keep = Number(body.keepDays);
          if (!KEEP_DAY_CHOICES.includes(keep as (typeof KEEP_DAY_CHOICES)[number])) throw new HttpError(400, 'keepDays must be 30, 90, 365 or 0 (until deleted).');
          app.settings.update({ runs: { ...runSettings(app.settings.get()), keepDays: keep } });
          runs.prune(true);
        } else if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
        return send(res, 200, { ...runSettings(app.settings.get()), choices: KEEP_DAY_CHOICES, stats: statsView() });
      }
      if (!b && method === 'GET') {
        const conversationId = q.get('conversationId') ?? undefined;
        const before = q.get('before') ? Number(q.get('before')) : undefined;
        return send(res, 200, { runs: runs.list({ ...(conversationId ? { conversationId } : {}), ...(before ? { before } : {}), limit: Number(q.get('limit') ?? 50) || 50 }), stats: statsView() });
      }
      if (!b && method === 'DELETE') {
        const conversationId = q.get('conversationId') ?? undefined;
        const removed = runs.deleteAll(conversationId);
        return send(res, 200, { removed, stats: statsView() });
      }
      const id = Number(b);
      if (!b || !/^\d{1,12}$/.test(b) || method !== 'GET') throw new HttpError(404, 'No such run.');
      const run = runs.get(id);
      if (!run) throw new HttpError(404, 'No such run.');
      if (!c) {
        // The run and its steps (tool outputs clipped further for the list; the step detail has more).
        const steps = runs.steps(id).map((s) => ({ ...s, tools: s.tools.map((t) => ({ ...t, output: t.output.length > 600 ? `${t.output.slice(0, 600)}…` : t.output })) }));
        const conv = run.conversationId ? app.store.getConversation(run.conversationId) : undefined;
        return send(res, 200, { run, steps, conversation: conv ? { id: conv.id, title: conv.title, mode: conv.mode, private: conv.private, workspace: conv.workspace } : null });
      }
      if (c === 'steps' && parts[3] !== undefined && !parts[4]) {
        const n = Number(parts[3]);
        const step = Number.isInteger(n) && n >= 0 ? runs.step(id, n) : undefined;
        if (!step) throw new HttpError(404, 'No such step.');
        // The prompt as sent: the system prompt from its blob, the history from the stored messages
        // in the step's id range (rebuilt the same way the turn built it), then the app's own notes.
        const system = step.systemSha ? (runs.blob(step.systemSha) ?? null) : null;
        let history: { id?: number; role: string; content: string; toolCalls?: unknown }[] = [];
        if (run.conversationId && step.historyToId) {
          const msgs = historyRange(app.store.messages(run.conversationId), step.historyFromId, step.historyToId);
          history = buildHistory(msgs).messages.map((m) => ({ role: m.role, content: m.content.length > 8000 ? `${m.content.slice(0, 8000)}\n[… ${m.content.length - 8000} more characters]` : m.content, ...(m.role === 'assistant' && m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}) }));
        }
        // Chat mode: the files a step's shell changed, from its undo snapshot and the next one.
        const conv = run.conversationId ? app.store.getConversation(run.conversationId) : undefined;
        const changes: Record<string, { added: string[]; changed: string[]; removed: string[] }> = {};
        if (conv && conv.mode !== 'coding') {
          const snaps = app.snapshots.list(conv.workspace).map((x) => x.id).reverse();
          for (const t of step.tools) {
            if (!t.snapshotId) continue;
            const next = snaps[snaps.indexOf(t.snapshotId) + 1];
            if (snaps.includes(t.snapshotId) && next) {
              try {
                changes[t.id] = app.snapshots.compare(conv.workspace, t.snapshotId, next);
              } catch {
                /* a snapshot pruned meanwhile */
              }
            }
          }
        }
        return send(res, 200, { run, step, prompt: { system, history, extra: step.extra }, changes });
      }
      throw new HttpError(404, 'No such run.');
    }
    // Phase 49: preview links (owner only). Listing, opening one for a job's port, closing.
    if (a === 'previews') {
      if (!app.previews) throw new HttpError(404, 'Previews are not available on this server.');
      const shown = (p: import('../preview.ts').Preview) => ({ token: p.token, url: previewUrl(p), workspace: p.workspace, port: p.port, path: p.path, jobId: p.jobId, jobLabel: p.jobLabel, conversationId: p.conversationId, expiresAt: new Date(p.expiresAt).toISOString() });
      if (!b && method === 'GET') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const ws = q.get('workspace') ?? undefined;
        const conversationId = q.get('conversationId') ?? undefined;
        return send(res, 200, { previews: app.previews.list({ ...(ws ? { workspace: ws } : {}), ...(conversationId ? { conversationId } : {}) }).map(shown) });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        const conv = app.store.getConversation(String(body.conversationId ?? ''));
        if (!conv || conv.partner) throw new HttpError(404, 'Conversation not found');
        try {
          const p = await app.previews.start({ conversationId: conv.id, workspace: conv.workspace, ...(body.port !== undefined ? { port: Number(body.port) } : {}), path: String(body.path ?? '/'), jobs: app.jobs });
          return send(res, 200, shown(p));
        } catch (err) {
          throw as400(err);
        }
      }
      if (b && !c && method === 'DELETE') return send(res, 200, { ok: app.previews.stop(b) });
    }

    if (a === 'workspaces' && b && c === 'snapshots') {
      const ws = validWorkspace(b);
      const id = parts[3];
      if (!id && method === 'GET') return send(res, 200, app.snapshots.list(ws));
      if (id && parts[4] === 'restore' && method === 'POST') {
        const busy = [...active.keys()].some((cid) => app.store.getConversation(cid)?.workspace === ws);
        if (busy) throw new HttpError(409, me('Sara is working in this workspace. Stop her or wait before undoing.'), { errorKey: 'Sara is working in this workspace. Stop her or wait before undoing.' });
        const body = await readJson(req);
        let result;
        try {
          result = app.snapshots.restore(ws, workspaceDir(rootDir, ws), id);
        } catch (err) {
          throw as400(err);
        }
        const target = app.snapshots.list(ws).find((s) => s.id === id);
        const convId = body.conversationId ? String(body.conversationId) : undefined;
        if (convId && app.store.getConversation(convId)) {
          app.store.addMessage(
            convId,
            'notice',
            `restore:The owner restored workspace "${ws}" to before: ${target?.label ?? id}. Changes made after that point were undone (${result.restored} files restored, ${result.removed} removed).`,
          );
        }
        return send(res, 200, { ...result, target });
      }
    }

    // Phase 13: what changed in a workspace repository (project page). Read only.
    if (a === 'workspaces' && b && c === 'git' && method === 'GET') {
      const ws = validWorkspace(b);
      const dir = workspaceDir(rootDir, ws);
      const run = (cmd: string) => runCommand(cmd, dir, { ...app.sandbox, network: false }, { timeoutMs: 20_000, signal: AbortSignal.timeout(25_000), maxBytes: 300_000 });
      // No owner OK for these, so the repository's own settings may not make git run programs.
      const g = `git ${GIT_SAFE.map(shq).join(' ')}`;
      const repo = await run(`${g} rev-parse --show-toplevel`);
      if (repo.exitCode !== 0) return send(res, 200, { repo: false });
      const [status, diff, log] = await Promise.all([run(`${g} status --short --branch`), run(`${g} --no-pager diff --no-ext-diff --no-textconv --stat --patch HEAD 2>/dev/null || ${g} --no-pager diff --no-ext-diff --no-textconv --stat --patch`), run(`${g} --no-pager log --oneline --decorate -n 10`)]);
      return send(res, 200, { repo: true, status: app.redactor.redact(status.output).slice(0, 20_000), diff: app.redactor.redact(diff.output).slice(0, 200_000), log: app.redactor.redact(log.output).slice(0, 5000) });
    }

    // Read a text file from a workspace (project page viewer). Read-only, size-limited.
    if (a === 'workspaces' && b && c === 'file' && method === 'GET') {
      const ws = validWorkspace(b);
      const rel = new URL(req.url ?? '/', 'http://x').searchParams.get('path') ?? '';
      let full: string;
      try {
        full = resolveInside(workspaceDir(rootDir, ws), rel);
      } catch (err) {
        throw as400(err);
      }
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st?.isFile()) throw new HttpError(404, 'File not found');
      // Only the start of a big file is read (a 4 GB log never has to fit in memory).
      const buf = Buffer.alloc(Math.min(st.size, 200_000));
      const fd = openSync(full, 'r');
      try {
        readSync(fd, buf, 0, buf.length, 0);
      } finally {
        closeSync(fd);
      }
      const binary = buf.subarray(0, 8000).includes(0);
      return send(res, 200, { path: rel, size: st.size, binary, text: binary ? '' : buf.toString('utf8'), truncated: st.size > 200_000 });
    }
    if (a === 'workspaces' && !b && method === 'GET') {
      const dir = join(rootDir, 'workspaces');
      const names = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
      if (!names.includes('main')) names.unshift('main');
      return send(res, 200, names.sort());
    }

    if (a === 'approvals' && b && method === 'POST') {
      const body = await readJson(req);
      // Phase 77: a contradiction card says how (Do it anyway / Don't / Update the note).
      const how = APPROVAL_HOWS.includes(body.how as ApprovalHow) ? (body.how as ApprovalHow) : undefined;
      if (!app.approvals.decide(b, body.approved === true, how)) throw new HttpError(404, 'That request is no longer waiting.');
      return send(res, 200, { ok: true });
    }
    // Phase 13: background jobs (list, stop) and the GitHub token used for pushing.
    if (a === 'jobs') {
      const jobs = app.jobs;
      if (!jobs) throw new HttpError(404, 'Not available');
      if (!b && method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://x');
        // Phase 52: each job's model usage (agent jobs) and whether it can continue with more budget.
        return send(res, 200, jobs.list({ conversationId: url.searchParams.get('conversation') ?? undefined, limit: 20 }).map((j) => {
          const u = app.usage?.forJob(j.id);
          return { ...j, ...(u?.calls ? { usage: { ...u, line: usageLine(u) } } : {}), ...(j.status === 'budget' ? { canContinue: jobs.canContinue(j.id) } : {}) };
        }));
      }
      if (b && c === 'stop' && method === 'POST') return send(res, 200, { stopped: jobs.stop(Number(b)) });
      if (b && c === 'continue' && method === 'POST') {
        const body = await readJson(req);
        try {
          const { job } = jobs.continueWithMore(Number(b), cleanBudget(body));
          return send(res, 200, job);
        } catch (err) {
          throw as400(err);
        }
      }
    }
    // Phase 52: new projects from tested starters (the project page's "New project from a starter").
    if (a === 'starters') {
      if (!b && method === 'GET') return send(res, 200, { starters: listStarters() });
      if (!b && method === 'POST') {
        const body = await readJson(req);
        let convId = typeof body.conversationId === 'string' ? body.conversationId : '';
        const ws = body.workspace ? validWorkspace(body.workspace) : 'main';
        const project = body.projectId !== undefined && body.projectId !== null ? projectOrThrow(body.projectId) : null;
        if (!convId) convId = app.store.createConversation({ title: `New project: ${String(body.projectName ?? '').slice(0, 60)}`, mode: 'coding', workspace: ws, projectId: project?.id ?? null }).id;
        else if (!app.store.getConversation(convId)) throw new HttpError(404, 'Conversation not found');
        try {
          const r = createFromStarter(app, { conversationId: convId, workspace: ws, name: String(body.name ?? ''), project: String(body.projectName ?? '').trim() });
          const msg = app.store.addMessage(convId, 'notice', `job:${r.message}`);
          app.events?.publish({ type: 'message', conversationId: convId, message: msg, reason: 'job' });
          return send(res, 201, { conversationId: convId, jobId: r.jobId, starter: r.starter.name, message: r.message });
        } catch (err) {
          throw as400(err);
        }
      }
    }
    // Phase 40: watched GitHub repositories (issues become tasks) and what she knows about projects.
    if (a === 'github-watch') {
      if (method === 'GET') {
        const w = watchSettings(app);
        let issues: OpenIssue[] = [];
        let error: string | undefined;
        if (w.repos.length && app.vault.get('git:github')) {
          try {
            issues = await openIssues(app);
          } catch (err) {
            error = (err as Error).message;
          }
        }
        return send(res, 200, { ...w, seen: undefined, connected: Boolean(app.vault.get('git:github')), issues, ...(error ? { error } : {}) });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        try {
          app.settings.update({ githubWatch: cleanWatch(body, watchSettings(app)) });
        } catch (err) {
          throw as400(err);
        }
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && b === 'check') return send(res, 200, { found: (await checkIssues(app)).length });
    }
    if (a === 'code-projects' && app.projects) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!b && method === 'GET') {
        const ws = url.searchParams.get('workspace') ?? 'main';
        try {
          return send(res, 200, { workspace: ws, projects: app.projects.get(ws, { fresh: url.searchParams.get('fresh') === '1' }) });
        } catch (err) {
          throw as400(err);
        }
      }
      if (b === 'notes' && !c && method === 'POST') {
        const body = await readJson(req);
        const kind = ['decision', 'convention', 'command', 'note'].includes(String(body.kind)) ? (String(body.kind) as 'note') : 'note';
        try {
          return send(res, 200, app.projects.addNote(String(body.workspace ?? 'main'), String(body.path ?? '.'), kind, String(body.text ?? '')));
        } catch (err) {
          throw as400(err);
        }
      }
      if (b === 'notes' && c && method === 'DELETE') return send(res, 200, { deleted: app.projects.deleteNote(Number(c)) });
    }
    // Phase 50: the code map of a workspace (the Map tab on the project page). Owner only, read only.
    if (a === 'codemap' && b) {
      const maps = app.codemap;
      if (!maps) throw new HttpError(404, 'The code map is not available');
      const ws = validWorkspace(b);
      const dir = workspaceDir(rootDir, ws);
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      if (!c && method === 'GET') {
        const r = await maps.until(dir, 3000);
        const st = r.store.status();
        const counts = r.store.importCounts();
        return send(res, 200, { workspace: ws, done: r.done, status: st, files: r.store.files().map((f) => ({ path: f.path, lang: f.lang, size: f.size, lines: f.lines, symbols: f.symbols, importedBy: counts.get(f.path) ?? 0 })) });
      }
      if (c === 'refresh' && method === 'POST') {
        const r = await maps.until(dir, 5000);
        return send(res, 200, { done: r.done, status: r.store.status(), reindexed: r.report?.reindexed.length ?? 0, removed: r.report?.removed.length ?? 0 });
      }
      if (c === 'file' && method === 'GET') {
        const store = maps.get(dir);
        const found = store.findPath(q.get('path') ?? '');
        if (!found.path) throw new HttpError(404, 'That file is not in the map.');
        const f = store.files().find((x) => x.path === found.path);
        const d = store.deps(found.path);
        return send(res, 200, { path: found.path, lang: f?.lang, size: f?.size, lines: f?.lines, symbols: store.symbolsIn(found.path), imports: d.imports, importedBy: d.importedBy });
      }
      if (c === 'find' && method === 'GET') {
        const store = (await maps.until(dir, 1500)).store;
        const query = (q.get('q') ?? '').trim().slice(0, 300);
        if (!query) return send(res, 200, { hits: [] });
        const kind = q.get('kind') ?? '';
        const ident = /^[\w$.:#]+$/.test(query);
        if (kind === 'symbol' || (!kind && ident)) {
          const r = store.findSymbols(query, 30);
          if (r.hits.length || kind === 'symbol') return send(res, 200, { kind: 'symbol', total: r.total, hits: r.hits.map((s) => ({ path: s.path, line: s.line, name: s.parent ? `${s.parent}.${s.name}` : s.name, kind: s.kind, snippet: s.signature })) });
        }
        const meaning = kind === 'meaning' || (!kind && !ident);
        const hits = meaning && maps.target ? await store.findMeaning(maps.target, query, 30) : store.findWords(query, 30);
        return send(res, 200, { kind: meaning && maps.target ? 'meaning' : 'text', ...(meaning && !maps.target ? { note: "Meaning search isn't set up (Settings → Which model does what → Meaning search), so this is a word search." } : {}), hits: hits.map((h) => ({ path: h.path, line: h.line, name: h.symbol, snippet: h.snippet, by: h.by })) });
      }
    }
    // Phase 50: her recipes (Settings → Abilities → Recipes).
    if (a === 'recipes') {
      const rs = app.recipes;
      if (!rs) throw new HttpError(404, 'Recipes are not available');
      if (!b && method === 'GET') return send(res, 200, { recipes: rs.list() });
      const id = Number(b);
      if (b && Number.isInteger(id) && !c) {
        if (method === 'GET') {
          const r = rs.get(id);
          if (!r) throw new HttpError(404, 'Recipe not found');
          return send(res, 200, r);
        }
        if (method === 'PATCH') {
          const body = await readJson(req);
          let r;
          try {
            r = rs.update(id, {
              ...(body.title !== undefined ? { title: String(body.title) } : {}),
              ...(body.whenToUse !== undefined ? { whenToUse: String(body.whenToUse) } : {}),
              ...(body.steps !== undefined ? { steps: String(body.steps) } : {}),
              ...(body.workspace !== undefined ? { workspace: body.workspace ? String(body.workspace) : null } : {}),
              ...(body.tags !== undefined ? { tags: Array.isArray(body.tags) ? (body.tags as string[]) : String(body.tags).split(',') } : {}),
            });
          } catch (err) {
            throw as400(err);
          }
          if (!r) throw new HttpError(404, 'Recipe not found');
          app.events?.publish({ type: 'recipes' });
          return send(res, 200, r);
        }
        if (method === 'DELETE') {
          if (!rs.delete(id)) throw new HttpError(404, 'Recipe not found');
          app.events?.publish({ type: 'recipes' });
          return send(res, 200, { ok: true });
        }
      }
    }
    // Phase 39: the team she leads.
    if (a === 'team') {
      const team = app.team;
      if (!team) throw new HttpError(404, 'Not available');
      const brief = (t: TeamTask) => ({ ...t, usage: team.usage(t.id), steps: t.steps.map((s) => ({ ...s, receipts: s.receipts.map((r) => ({ name: r.name, status: r.status, summary: app.tools.get(r.name)?.summarize(r.args) ?? r.name, output: r.output.slice(0, 600) })) })) });
      if (!b && method === 'GET') {
        const s = app.settings.get();
        return send(res, 200, {
          tasks: team.list(20).map(brief),
          helpers: teamHelpers(app).map((h) => ({ ...h, modelLabel: h.model ? h.model.model : (() => { try { return resolveChain(app, { id: '', providerId: null, model: null, mode: 'coding', private: false, partner: null, channel: 'web', workspace: 'main' } as unknown as Conversation, h.job)[0].model; } catch { return null; } })() })),
          roles: Object.entries(ROLES).map(([id, r]) => ({ id, emoji: r.emoji, blurb: r.blurb, tools: r.tools, job: r.job })),
          custom: s.helpers ?? [],
          limits: cleanLimits(s.teamLimits),
          tools: app.tools.list().map((t) => t.spec.name),
        });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        let convId = typeof body.conversationId === 'string' ? body.conversationId : '';
        if (!convId) convId = app.store.createConversation({ title: `Team: ${String(body.goal ?? '').replace(/\s+/g, ' ').slice(0, 50)}`, mode: 'coding' }).id;
        try {
          return send(res, 200, brief(team.start(convId, String(body.goal ?? ''), { limits: body.limits as Partial<TeamLimits> })));
        } catch (err) {
          throw as400(err);
        }
      }
      if (b === 'settings' && method === 'PUT') {
        const body = await readJson(req);
        const patch: Partial<Settings> = {};
        try {
          if (body.helpers !== undefined) patch.helpers = cleanHelpers(body.helpers, app.tools.list().map((t) => t.spec.name));
          if (body.limits !== undefined) patch.teamLimits = cleanLimits(body.limits);
        } catch (err) {
          throw as400(err);
        }
        app.settings.update(patch);
        return send(res, 200, { ok: true });
      }
      // Phase 40: a workflow from a GitHub issue; answering a checkpoint.
      if (b === 'from-issue' && method === 'POST') {
        const body = await readJson(req);
        try {
          return send(res, 200, brief(await startFromIssue(app, String(body.repo ?? ''), Number(body.number), { checkpoints: body.checkpoints !== false, pr: body.pr !== false })));
        } catch (err) {
          throw as400(err);
        }
      }
      const id = Number(b);
      if (id && !c && method === 'GET') {
        const t = team.get(id);
        if (!t) throw new HttpError(404, 'No such task');
        return send(res, 200, { task: brief(t), log: team.log(id), approvals: team.approvals(id) });
      }
      if (id && c === 'stop' && method === 'POST') return send(res, 200, { stopped: team.stop(id) });
      if (id && c === 'continue' && method === 'POST') {
        const body = await readJson(req);
        try {
          return send(res, 200, brief(team.continueWithMore(id, body)));
        } catch (err) {
          throw as400(err);
        }
      }
      if (id && c === 'checkpoint' && method === 'POST') {
        const body = await readJson(req);
        const d = String(body.decision ?? '');
        if (d !== 'go' && d !== 'skip' && d !== 'stop') throw new HttpError(400, 'go, skip or stop');
        if (!team.answer(id, d)) throw new HttpError(400, "That task isn't waiting at a checkpoint.");
        return send(res, 200, { ok: true });
      }
      if (id && c === 'steps' && parts[3] && method === 'POST') {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        if (parts[4] === 'stop') return send(res, 200, { stopped: team.stopStep(id, Number(parts[3])) });
        if (parts[4] === 'message') {
          if (!team.message(id, Number(parts[3]), String(body.text ?? ''))) throw new HttpError(400, "That helper isn't working right now.");
          return send(res, 200, { ok: true });
        }
      }
    }
    // Phase 73: the owner's servers over SSH (src/ssh.ts, docs/SSH.md). Owner only: members get 403
    // (not in MEMBER_ROUTES), the demo gets 403 (not in its allowlists) and has no manager anyway.
    if (a === 'ssh') {
      const ssh = app.ssh;
      if (opts.demo || opts.member || !ssh) throw new HttpError(403, 'Servers over SSH are only for the owner of this server.');
      const fail = (err: unknown): never => {
        if (err instanceof SshError) throw new HttpError(err.code === 'NOT_FOUND' ? 404 : err.code === 'PRIVATE_LOCAL' ? 403 : 400, err.message);
        throw err;
      };
      const view = async () => ({ servers: ssh.views(), available: await ssh.available(), privateLocal: privateLocalOn(), warning: SAVE_PASSWORD_WARNING, dir: ssh.dir });
      if (!b && method === 'GET') return send(res, 200, await view());
      if (b === 'servers' && !c && method === 'POST') {
        const body = await readJson(req);
        try {
          const srv = await ssh.add({ name: body.name, host: body.host, port: body.port, user: body.user, auth: body.auth });
          return send(res, 200, { server: ssh.view(srv), ...(await view()) });
        } catch (err) {
          return fail(err);
        }
      }
      const id = b === 'servers' && c ? c : '';
      const d = parts[3];
      if (id) {
        try {
          ssh.get(id);
        } catch (err) {
          fail(err);
        }
        try {
          if (!d && method === 'DELETE') {
            const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
            let message = '';
            const srv = ssh.get(id);
            if (body.revoke === true && srv.key?.source === 'made') message = (await ssh.revokeKey(id)).message;
            ssh.remove(id);
            return send(res, 200, { message, ...(await view()) });
          }
          if (d === 'scan' && method === 'POST') {
            await ssh.scan(id);
            return send(res, 200, { server: ssh.view(ssh.get(id)), ...(await view()) });
          }
          if (d === 'trust' && method === 'POST') {
            const body = await readJson(req);
            ssh.trust(id, String(body.fingerprint ?? ''));
            return send(res, 200, { server: ssh.view(ssh.get(id)), ...(await view()) });
          }
          if (d === 'login' && method === 'POST') {
            // The password arrives here once (a password box in Settings) and is never stored
            // unless the owner ticked "Save" AND confirmed the warning.
            const body = await readJson(req);
            const pw = typeof body.password === 'string' ? body.password : '';
            body.password = undefined;
            const r = await ssh.loginWithPassword(id, pw, { savePassword: body.savePassword === true, confirmRisk: body.confirmRisk === true });
            // She tells the owner in the conversation that added the server (or the newest one).
            const srv = ssh.get(id);
            const conv = (srv.conversationId && app.store.getConversation(srv.conversationId)) || undefined;
            if (conv && !conv.private) {
              const sayParams = { name: srv.name, path: r.keyPath, line: r.publicLine };
              const said = r.passwordSaved
                ? trOwner('I made my own SSH key for {name} and installed it there. The private key is at {path} on the Sara server, and the line I added to ~/.ssh/authorized_keys is: {line}. I’ll use the key from now on. You asked me to keep the password, so it is saved encrypted; you can forget it any time in Settings → Abilities → Servers over SSH.', app.settings.get(), sayParams, identityOf(app.persona))
                : trOwner('I made my own SSH key for {name} and installed it there. The private key is at {path} on the Sara server, and the line I added to ~/.ssh/authorized_keys is: {line}. I’ll use the key from now on, and I did not keep your password.', app.settings.get(), sayParams, identityOf(app.persona));
              const msg = app.store.addMessage(conv.id, 'assistant', said, { ssh: id });
              app.events?.publish({ type: 'message', conversationId: conv.id, message: msg, reason: 'job' });
            }
            return send(res, 200, { server: ssh.view(srv), announcement: r.announcement, ...(await view()) });
          }
          if (d === 'key' && method === 'POST') {
            const body = await readJson(req);
            await ssh.importKey(id, { privateKey: typeof body.privateKey === 'string' ? body.privateKey : '', keyPath: typeof body.keyPath === 'string' ? body.keyPath : '' });
            return send(res, 200, { server: ssh.view(ssh.get(id)), ...(await view()) });
          }
          if (d === 'test' && method === 'POST') {
            const t = await ssh.test(id);
            return send(res, 200, { ...t, server: ssh.view(ssh.get(id)), ...(await view()) });
          }
          if (d === 'password' && method === 'DELETE') {
            ssh.forgetPassword(id);
            return send(res, 200, { server: ssh.view(ssh.get(id)), ...(await view()) });
          }
          if (d === 'revoke' && method === 'POST') {
            const body = await readJson(req);
            const r = await ssh.revokeKey(id, { localOnly: body.localOnly === true });
            return send(res, 200, { message: r.message, removedFromServer: r.removedFromServer, server: ssh.view(r.server), ...(await view()) });
          }
        } catch (err) {
          return fail(err);
        }
      }
      throw new HttpError(404, 'Not found');
    }
    if (a === 'github' && !b) {
      if (method === 'GET') {
        const token = app.vault.get(GITHUB_VAULT);
        if (!token) return send(res, 200, { hasToken: false });
        const r = await netFetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}`, 'user-agent': 'Sara' }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        const login = r?.ok ? ((await r.json()) as { login?: string }).login : undefined;
        return send(res, 200, { hasToken: true, login: login ?? null, ok: Boolean(login) });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const token = String(body.token ?? '').trim();
        if (!token) app.vault.delete(GITHUB_VAULT);
        else if (!/^(gh[pousr]_|github_pat_)[\w]{20,}$/.test(token)) throw new HttpError(400, 'That does not look like a GitHub token (it starts with github_pat_ or ghp_).');
        else app.vault.set(GITHUB_VAULT, token);
        return send(res, 200, { hasToken: Boolean(token) });
      }
    }
    return NEXT;
  };
}
