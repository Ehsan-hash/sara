# The harness track (Phases 76–86, versions 2.9.0–2.19.0)

_Design study, 2026-10-30, written against the code at version 2.8.2 (commit `49f1772`). Nothing in
`src/` was changed for this study. Line numbers are from that commit._

**What this is:** where each of the owner's twelve "harness" features would live in Sara's real code,
what already exists, the few shared building blocks, eleven milestones with tests that prove them
done, a concrete plan for the first one, and the places where today's code fights the plan.

**Two facts in the brief are out of date:**

| Brief says | The code says |
|---|---|
| Version 2.4 | 2.8.2 (`package.json`), Phases 1–75 done except 60/64 (`docs/SOURCE_OF_TRUTH.md:6`) |
| Postgres stores memory | **SQLite through `node:sqlite`**, one `sara.db` per companion (and per household member space). Memory is `MemoryStore` on `store.db` (`src/main.ts:411`); vectors in the same file (`memory_vectors`, `src/embeddings.ts:15`). There is no Postgres anywhere in `src/`, `package.json` or `docker-compose.yml`. Migrations are additive: `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE ADD COLUMN` after a `PRAGMA table_info` check (`src/store.ts:128-140`, `src/memory.ts:128`). Everything below follows that pattern. |

The rules from the brief hold: MIT, no runtime npm packages (Node 24 built-ins only), no GitHub
Actions or paid CI, and the security features never write exploits, PoCs, malware or attack
payloads. They read, sandbox and repair Sara's own output. Red-team mode runs a fixed set of generic
checks in code against her own output in a throwaway sandbox. It does not let a model write probes.

---

## 1. Repo map: where each feature lives and what already exists

The short version: Sara already has about half of every feature. The track mostly connects and
hardens what's there.

### A. Memory layer (between the database and the prompt)

| # | Feature | Already exists (reuse, don't rebuild) | Missing (what the track adds) | Where it goes |
|---|---|---|---|---|
| 1 | **Ranked memory injection + confidence notes** | `selectMemories()` (`src/memory.ts:414-499`) picks notes under a character budget (`injectBudgetChars`, default 2500, `src/memory-worker.ts:24`). It takes word matches first (FTS5 + bm25, `src/memory.ts:146-155, 441`), then meaning matches (`MemoryVectors.related()` returns a cosine score, `src/embeddings.ts:156`), then recent facts/self/promises/decisions/reflection/other-conversation summaries (`:448-461`). Each line gets a dated kind tag (`:468-487`). Picks are recorded on the reply as `meta.memoryIds` (`src/chat.ts:1138`) and shown in the presence panel's "She remembered" (`web/her-panel.js:8, 448, 489`) via `GET /api/memories?ids=` (`src/routes/memory.ts:41-46`). | No score at all: the order is the order of the loops. The meaning scores are thrown away (`src/chat.ts:920`: `.map((r) => r.memory)`). No "why" or "how sure" per note. | `src/memory-rank.ts` (new, pure), `selectMemories` rewritten on top of it, `src/persona.ts:243-245` (prompt wording), `web/her-panel.js` (why + sure), meta `memoryPicks`. |
| 2 | **Contradiction flagging before acting** | Soft version only: the prompt says "if what the owner says now goes against something you decided together or a promise, mention it gently" (`src/persona.ts:245`). Memory knows about `decision` and `promise` kinds (`src/memory.ts:11-13`) and marks notes "no longer true" with a quoted proof (`src/memory-worker.ts:345-347`, weekly in `src/weekly.ts:149-154`, `supersede()` at `src/memory.ts:203`). The gate machinery exists: `permission` / `asksFirst` / `ApprovalBroker` (`src/chat.ts:1190-1216`, `src/tools/types.ts:32-53`). | Nothing checks a **planned tool call** or a **claim in a reply** against stored decisions/facts. Nothing stops. | `src/contradict.ts` (new): runs between "model asked for tool call" and "permission check" (`src/chat.ts:1177-1193`), and next to the claim check (`:1162-1175`). |
| 3 | **Active recall triggers** | `autoRecall()` (past-tense cue words → real past messages, `src/recall.ts:300`), `lastTimeNote()` (`:273`), `recipesSection()` (saved "how I did it" recipes matched to a coding request, `src/recipes.ts:271`, min score `:21`), project knowledge per workspace (`src/projectknow.ts:260`). | Matching on **task shape** (files, tools, error signatures, goal words) against **past runs**. Today there is no record of past runs to match against; that comes with run snapshots (M3). | `src/triggers.ts` (new) reading the run tables from M3; injected as one more prompt section next to `recipes`. |
| 4 | **Memory decay** | A three-way "fade" switch, `never` / `slow` (365 days) / `normal` (120 days) (`src/memory-worker.ts:17-22`), applied as a hard cut-off for un-matched notes (`src/memory.ts:446-447`); Settings → Memory select (`web/app.js:5144, 5364`); promises and dates never fade. | Not a weight, a wall. No reuse signal, no pinning (nothing called `pinned` in memory code), no visible policy. | In M1: `memories.pinned`, `last_used_on`, `use_count` columns; a decay policy object in memory settings; shown in Settings → Memory and per note. |

### B. Bigger loops

| # | Feature | Already exists | Missing | Where it goes |
|---|---|---|---|---|
| 5 | **Time-travel debugging** | Every turn is already in `messages` with rich `meta`: tool calls (`src/chat.ts:1137`), tool results with args, status, ms, snapshot id, card (`:1260`), memory ids (`:1138`), model and provider. Usage rows per model call carry `conversation_id` / `job_id` / `team_task_id` (`src/usage.ts:175-194`). Workspace snapshots (content-addressed, outside the workspace, `compare()` and undoable `restore()`, `src/snapshots.ts:76, 137, 160`), but **only outside coding mode** (`src/chat.ts:1221`). Regenerate/edit already deletes "this message and everything after" (`src/store.ts:328`). | The system prompt actually sent, the memory picks with reasons, files touched and cost are not tied to one **step**. No "branch from step N with one input changed". | `runs` / `run_steps` / `run_blobs` tables (M3), `src/runs.ts`; branch in M9 (`src/branch.ts`), routes in `src/routes/coding.ts`, a step timeline on the existing step line (`web/steps.js`). |
| 6 | **Built-in eval loop** | A real harness, but as scripts: `scripts/bench-tasks.ts` runs her agent loop on a copy of `start/` and grades hidden tests (`bench/tasks`, `bench/projects`, reference solutions); `scripts/eval-memory.ts`, `eval-claims.ts`, `eval-team.ts` and 10 more; results published by `scripts/publish-results.ts` into `docs/RESULTS.md`. The team's tester/reviewer verdict lines (`src/team.ts:50`, `verdict()` `:185`). | In the product: the developer writing "done" for their own project, reruns of variants (prompt, tool set, memory policy, model), and a winner with evidence. | `src/evals.ts` (new) reusing the `task.json` + hidden-test format from `bench/`; specs in the workspace at `.sara/evals/*.json`; runs through the sandbox job (M5) and the replay runner (M8 below). |
| 7 | **Enforced cost budgets** | Budgets already exist for **background jobs** (`overBudget()` aborts mid-run, status `budget`, "Continue with more budget", `src/jobs.ts:20, 151-165, 237-300`) and **team tasks** (tokens/$/steps/minutes, `src/team.ts:92-102`, stop at `limit`, continue at `:421`). A per-call meter with prices (`metered()`, `src/usage.ts:321`, `Budget`/`overBudget` `:359-383`). | **Chat turns have no budget at all** (only `MAX_STEPS` 25 / 80 in coding, `src/chat.ts:245-246`). No graceful degrade (smaller model, fewer loops, summarize-and-stop), no "what was dropped" report. | `src/budget.ts` (new) used by `runTurn`, `JobManager` and `TeamManager`; per-step cost from M3. |

### C. Security (after she writes, before it ships)

| # | Feature | Already exists | Missing | Where it goes |
|---|---|---|---|---|
| 8 | **Parallel security pass + fix branch** | Secret scrubbing of tool output (`src/redact.ts`, `Redactor`) with key-shaped patterns that can double as a secret **scanner**. Code review of a diff or PR with file/line comments and must/should/nit severity (`src/codereview.ts:13-28, 122`). The team workflow already commits to a new branch, pushes, opens a PR and reviews it (`src/team.ts:639-707`, branch name `sara/<task>-<slug>` at `:673`). Hardened git (`GIT_SAFE`, `src/tools/coding.ts:37`). Code map with symbols, imports and file:line search (`src/codemap/*`). | Static rules, dependency vulnerability check, a finding object, and the loop "finding → fix branch → targeted prompt → re-check". | `src/security/` (new folder): `rules.ts` (static, per language), `secrets.ts`, `deps.ts` (lockfile readers), `pass.ts` (runs them), `fix.ts` (fix-branch loop, built on the team workflow). |
| 9 | **Sandboxed execution gate** | A real command sandbox: bubblewrap on Linux, Seatbelt on macOS, a separate user in Docker, **none on Windows** (asks first) (`src/tools/sandbox.ts:112-166`). No network in private mode (`PRIVATE_LOCAL_ENV` `:424`, `runCommand` `:440`). Background jobs in the sandbox (`src/jobs.ts`). Previews of her web apps behind a capability URL with a hard CSP, and a testing browser with **fixed assertions only, no "run JavaScript" tool** (`src/tools/browser.ts:5, 232`; THREAT_MODEL §4b). | Today's sandbox runs **in the real workspace** (bubblewrap binds it read-write, `bwrapArgs` `:362`). "Throwaway" means: a copy, no network, then compare what changed, then decide. No Docker/container driver exists, and none is needed on Linux/macOS. | `src/sandbox-run.ts` (new): copy → run → diff → verdict, built on `runCommand` and `SnapshotStore`. |
| 10 | **Threat-model second pass** | The reviewer role and verdict format (`src/team.ts:50`), `reviewDiff()` (`src/codereview.ts:122`), the code map's import/entry-point graph (`code_deps`, `code_refs`). | A pass that walks entry points (routes, CLI args, file/network input, deserialization) of **her own changes** and files findings; a second pass whose only job is fixing them. | `src/security/threats.ts`; the fix pass reuses `fix.ts`. |
| 11 | **Live dependency advisories** | One way out to the network, `netFetch` (`src/net-guard.ts`), blocked in private local mode. The shell tool's "ask first" hook (`asksFirst`) can recognise `npm install` / `pip install` commands. | An advisory source, a short-TTL cache, the block/override decision. | `src/security/advisories.ts` + an `advisory_cache` table; the gate is the shared policy gate (§2.3). |
| 12 | **Red-team mode** | The sandbox, previews, testing browser assertions (`browser_check`), jobs, team roles (coder/tester/reviewer), the receipt check that refuses unproven claims (`src/receipts.ts:326`). | A fixed probe catalogue (generic robustness inputs, insecure-default checks, behaviour checks in the sandbox), findings into the M6 fix path, the attacker/reviewer model pairing. | `src/redteam.ts` + `src/redteam-probes.ts` (the fixed catalogue). |

---

## 2. Shared building blocks

Six pieces, each built once and used by several milestones. Each is defined against what's in the
code today.

### 2.1 Run snapshot (the backbone; built in M3)

One **run** = one chat turn, one background job or one team task. One **step** = one model call plus
the tool calls it asked for (exactly one pass of the `for (let step…)` loop in `src/chat.ts:983`).

| Table (in each companion's `sara.db`) | Columns | Notes |
|---|---|---|
| `runs` | `id`, `kind` (`turn`/`job`/`team`/`eval`/`redteam`), `conversation_id`, `user_message_id`, `job_id`, `team_task_id`, `parent_run_id`, `branched_from_step`, `started_at`, `ended_at`, `status`, `tokens`, `usd`, `budget` (JSON), `policy` (JSON: memory policy id, prompt version, tool set hash, model) | `parent_run_id` + `branched_from_step` is time-travel (M9) and eval variants (M8). |
| `run_steps` | `id`, `run_id`, `idx`, `model`, `provider`, `system_sha`, `history_from_id`, `history_to_id`, `memory_picks` (JSON from M1), `tool_calls` (JSON, redacted), `tool_message_ids` (JSON), `files_touched` (JSON), `workspace_ref` (snapshot id or git HEAD), `tokens_in`, `tokens_out`, `usd`, `ms`, `stopped` (null / `budget` / `contradiction` / `gate`) | History is **not** copied: it is the message id range in `messages` (already stored). |
| `run_blobs` | `sha` (sha256), `bytes` (deflated with `node:zlib`), `size` | System prompts repeat almost unchanged from step to step; storing them by hash keeps this small. |
| `usage` | + `run_id` column (additive) | Cost per step comes from the existing meter, not a second one. |

Retention: keep the last N runs per conversation (like `KEEP = 100` in `src/snapshots.ts:15`),
always keep runs that are parents of a branch or part of an eval.

### 2.2 Ranked recall (built in M1)

`rankMemories(query, context) → RankedPick[]`, pure code, no model call. A pick is
`{ memoryId, score, confidence: 'high'|'medium'|'low', why: string[], policyId }`. Used for the
prompt (M1), for finding the decisions a planned action might break (M2), and for active recall
triggers (M10). The same function, called with a different query.

### 2.3 Policy gate

One function every "stop or ask" feature goes through:

```ts
type GateVerdict = { act: 'allow' } | { act: 'ask'; reason: string; findingIds?: number[] } | { act: 'block'; reason: string; findingIds?: number[] };
gate(app, { kind: 'contradiction' | 'budget' | 'sandbox' | 'advisory' | 'security', subject, conv }): GateVerdict
```

- `ask` becomes the **existing approval card** (`app.approvals.request`, `src/chat.ts:1212`), with
  an "Override" label and the reason. Nothing new on the phone apps, bridges or CLI, which already
  answer approvals.
- `block` becomes a `denied` tool result with the reason (same as `permission === 'never'`,
  `src/chat.ts:1207-1209`). The model reads it and must change course.
- Every `ask`/`block` and its answer is written to `run_steps.stopped` and the finding (2.5).
- Overrides are explicit and per item: an approval click, never a setting that turns the gate off.

### 2.4 Sandbox job (built in M5)

`runSandboxed({ workspace, command, network: false, timeoutMs, probes? })`:

1. copy the workspace into `<data>/cache/sandbox-runs/<id>/` (from the snapshot store's objects:
   unchanged files are linked/copied once; `node_modules` and friends are skipped, `SNAPSHOT_SKIP`
   `src/snapshots.ts:11`),
2. run with `runCommand` (`src/tools/sandbox.ts:440`) in the best available mode, no network,
3. compare before/after (`SnapshotStore.compare`, `:137`): files added/changed/removed, writes to
   `.git/hooks`, dotfiles, files outside the project tree, executables created,
4. note processes still running at the end, time and output size,
5. return `{ result: RunResult, changes, behaviour: Finding[] }` and delete the copy.

Long runs go through `JobManager` so they show progress and respect budgets.

### 2.5 Finding

One table, `findings`, for everything that can stop or fix work:

| Column | Meaning |
|---|---|
| `id`, `run_id`, `conversation_id`, `workspace` | where it came from |
| `source` | `contradiction` / `static` / `secret` / `dependency` / `advisory` / `threat` / `sandbox` / `redteam` |
| `severity` | `block` / `high` / `medium` / `low` / `info` |
| `file`, `line`, `quote` | **The quote must be the real text at that line, checked by code**, or the finding is dropped. Same receipt rule as memory facts (`src/memory-worker.ts`, quoted proofs). This is the "no theater" rule. |
| `rule`, `title`, `advice` | which check, in plain words, what to do |
| `status` | `open` / `fixing` / `fixed` / `dismissed` / `overridden` |
| `fix_branch`, `fix_run_id`, `recheck_run_id` | the fix path (M6) |

Shown as a new result card kind in `src/cards.ts` / `web/result-cards.js`, listed on the project page.

### 2.6 Budget

Today `Budget` is `{ tokens?, usd? }` (`src/usage.ts:359`). Extend it (additively) to
`{ tokens?, usd?, steps?, minutes?, degrade?: ('smaller-model' | 'fewer-tools' | 'summarize-stop')[] }`
and add a `TurnMeter` that counts what a run has spent so far. Jobs and team keep their current
budgets and get the degrade ladder for free.

---

## 3. Milestones

The owner's order holds, with one swap: **time-travel (M8) comes before the eval loop (M9)**. Both
need the same "replay a run from a step with one input changed" runner. Time-travel is that runner
with a UI. The eval loop is that runner run N times plus grading. Building the runner first means
eval doesn't build its own. The rest of the order matches the code's dependencies (M3 before M4,
M8, M9 and M10; M5 before M6, M7 and M11).

| M | Phase | Version | Milestone | Size | Needs |
|---|---|---|---|---|---|
| M1 | 76 | 2.9.0 | Ranked injection + confidence notes + decay + pinning | M | – |
| M2 | 77 | 2.10.0 | Contradiction flag before acting | M | M1 |
| M3 | 78 | 2.11.0 | Run snapshots | L | – |
| M4 | 79 | 2.12.0 | Enforced cost budgets (turns, jobs, team) with graceful degrade | M | M3 |
| M5 | 80 | 2.13.0 | Sandbox execution gate (throwaway copy) | L | M3 |
| M6 | 81 | 2.14.0 | Security pass + live advisories + fix-branch loop | L | M5 |
| M7 | 82 | 2.15.0 | Threat-model second pass | M | M6 |
| M8 | 83 | 2.16.0 | Time-travel: branch from a step (**swapped**) | M | M3 |
| M9 | 84 | 2.17.0 | Eval loop with winner + evidence (**swapped**) | L | M3, M5, M8 |
| M10 | 85 | 2.18.0 | Active recall triggers | S | M1, M3 |
| M11 | 86 | 2.19.0 | Red-team mode | M | M5, M6, M7 |

S ≈ one session, M ≈ two or three, L ≈ four or more (each including docs, i18n, tips, tests).

### M1 · Phase 76 · 2.9.0: ranked memory, confidence notes, decay

- **Ships:** each note she uses has a reason and a sureness ("matched *dog*, *Biscuit*; sure: high").
  "She remembered" shows both. Pin a note so it never fades. Settings → Memory shows the decay
  policy in words, with a half-life you can change. Old notes fade in weight instead of hitting a wall.
- **Files:** `src/memory-rank.ts` (new), `src/memory.ts`, `src/memory-worker.ts`, `src/chat.ts`,
  `src/persona.ts`, `src/routes/memory.ts`, `web/her-panel.js`, `web/app.js` (+ memory page),
  `web/i18n/*.json`, `web/tips.json`, `web/help.html`, docs.
- **DB:** `memories` + `pinned`, `last_used_on`, `use_count` (additive).
- **Reuses:** FTS5/bm25, `MemoryVectors.related` scores, the budget, `meta.memoryIds`, the panel.
- **Done:** see §4.6.

### M2 · Phase 77 · 2.10.0: contradiction flag before acting

- **Ships:** before a tool call, she checks it against your **decisions** and **rules** ("never push
  to main", "don't touch the prod config"). If it conflicts, the call stops with an approval card:
  "This goes against what you decided on 12 Oct: *never push to main* (your words: '…'). Override?"
  A reply that states something contradicting a stored fact gets a flag like the receipt check.
- **Files:** `src/contradict.ts` (new), `src/chat.ts` (between `:1177` and `:1193`; beside `:1162`),
  `src/team.ts` (helpers' tool calls), `src/cards.ts`.
- **DB:** `findings` table (first user of it) with `source='contradiction'`.
- **How:** code first. Candidate notes come from `rankMemories(toolSummary + args)` limited to
  `decision` / `fact`. A rule is "binding" only if it has a clear shape (a negation + an object the
  call names: a branch, path, host, command word). Code matches those directly: no model call, works
  on any model. Fuzzy cases go to the optional judge, but only if the owner has set the claim
  judge model (`settings.claimJudge`, used by `judgeUnsure`, `src/chat.ts:512`). The judge has a
  time limit and fails open to "flag", never to "block".
- **Done tests:** a decision "don't push to main" + a `git_push` to `main` → approval card, tool not
  run until allowed; `git_push` to `feature-x` → runs; superseded decision → no stop; override is
  recorded on the finding; a chat (not tool) mismatch only flags; judge off → code path only; a
  private conversation's judge uses only local models.

**As built (Phase 77, 2026-10-30):** `src/contradict.ts` + the check in `runTurnInner` right
after the permission lookup (before the approval point) and in `TeamManager.#tool`.

- Clear shapes matched in code: push to a named branch (refspecs, `HEAD:x`, `--all`, and the
  current branch read from `.git/HEAD` for a plain `git push`/`git_push`), no push at all, force
  push (`-f`, `--force*`, `+refspec`), tests before every push/commit (a passing test command
  earlier in the turn/conversation since the last push, or `tests && git push` in one command),
  hands off a path (`infra/`, `config/prod.yaml`, `.env`, "the legacy folder"; only for calls
  that change files: writes, edits, `rm/mv/cp/sed -i/>`), a package manager ruled out (`pnpm, not
  npm`), a command or flag ruled out (`git reset --hard`, `sudo`, `--no-verify`). Read-only tools
  are never checked. Fuzzy (flag only): a path rule in words only ("the prod config") whose words
  all appear in a changed path, or a rule-like note sharing two words with the call.
- Gate (§2.3 + §7 #4): stop only for a clear conflict, only in coding conversations and work
  channels, only with strictness *Stop on clear conflicts*; everything else is a flag plus a short
  system note so she mentions it. It only turns `auto` into an approval and adds a section to an
  `ask` card; `never` stays refused before the check runs. Group chats only flag (no approvals
  mid-round). Other apps (`externalApp`) get the same notes filter as M1 (no private, imported or
  adult-channel notes) and, being everyday chats, flags only. Household members meet only their
  own notes (their own space).
- The card: "This goes against something you decided" with the note, its date, the owner's words
  when the note has them, the `[why …; sure …]` line, other clear conflicts of the same call under
  *Also*, and *Do it anyway* / *Don't* / *Update the note* (`ApprovalBroker.decide(id, approved,
  how)`). Telegram/Discord work chats get one extra line on their Allow/Deny message.
- **Deviations:** (1) no `findings` table yet: each check is a Finding-shaped object
  (`Contradiction`: source, severity, quote, rule, title, advice, status, answer) on the reply's
  `meta.contradictions` and the tool message's `meta.contradiction`, for M3 to copy into
  `run_steps`/`findings`. (2) The claim check of replies against stored facts ("a reply that states
  something contradicting a stored fact gets a flag") is not built; only planned tool calls are
  checked. (3) Every current decision is a candidate, not only the ranked ones (a few hundred at
  most; parsing is cached), because "tests before every push" shares no word with `git push
  origin x`. (4) The optional judge only drops fuzzy flags (a clear NO) and needs the claim-judge
  model; it never stops. (5) Team helpers skip the tests-first rule (their runs don't carry the
  turn's receipts). (6) Found live: the note writer retired a decision after a one-time *Do it
  anyway*; overridden decisions are now never superseded by that path, and its prompt says so.
- Measured: `scripts/eval-contradict.ts`, stops precision/recall 1.00/1.00 on a 35-call
  development set and a 12-call held-out set (11/12 exact; the miss is a day-of-week rule), < 20 ms
  per call with 10,000 notes (`test/phase77.test.ts`). See `docs/RESULTS.md`.

### M3 · Phase 78 · 2.11.0: run snapshots

- **Ships:** every reply gets "Show the steps": each step's model, what memory went in and why, the
  tool calls and results, files touched, tokens and cost. The same for jobs and team tasks.
- **Files:** `src/runs.ts` (new: `RunRecorder`), `src/chat.ts` (one recorder per turn: open at
  `runTurnInner` start, `step()` per loop pass, `close()` at `done`), `src/jobs.ts`, `src/team.ts`,
  `src/usage.ts` (`run_id`), `src/backup.ts`/`src/export.ts` (include or leave out, decided), route
  `GET /api/runs/<id>` in `src/routes/coding.ts`, `web/steps.js`.
- **DB:** `runs`, `run_steps`, `run_blobs`; `usage.run_id`.
- **Reuses:** messages/meta as the history, the usage meter, snapshot ids; turns on workspace
  snapshots for coding conversations **only as a light manifest** (git HEAD + dirty file hashes),
  because full snapshots are off in coding mode today (§6).
- **Done tests:** a 3-step turn with tools → 3 `run_steps` rows whose tool calls, token sums and
  memory picks equal the messages and usage rows; system prompt round-trips from `run_blobs` byte
  for byte; forget/delete conversation deletes its runs; a redacted secret never appears in
  `run_blobs`; retention keeps branch parents; a turn on a model that reports no usage is marked
  "cost unknown", not 0; backup restore keeps runs.

**As built (Phase 78, 2026-10-30):** `src/runs.ts` (`RunStore`, `RunRecorder`), the `TurnHooks`
seam in `src/chat.ts`, routes in `src/routes/coding.ts`, `web/run-view.js` + "Show the run" on the
step line (`web/steps.js`), retention on Settings → Data & health → Health.

- **Tables** (additive, in each space's `sara.db`): `runs` (as §2.1 plus `reply_message_id`,
  `title`, `steps`, `tokens_in`/`tokens_out`, `unpriced`/`unreported`, `ms`, `bytes`; split
  tokens instead of one `tokens`), `run_steps` (as §2.1, with `calls` (every provider call of the
  step: model, provider, billing, tokens, cost or null, latency, time to first event, ok/error,
  purpose for side calls), `label`, `extra` (the app's notes after the history), `contradictions`,
  `reply_message_id`, `unpriced`/`unreported`, `bytes`), `run_blobs`, `usage.run_id`.
  `conversation_id` cascades: deleting a conversation deletes its runs.
- **Risk 1:** the turn's recorder is made in `runTurn` and passed explicitly to `runTurnInner`; it
  wraps the chain's providers (`metered(...).meter.rewrap({ runId, onCall })`, the meter's own
  price and usage row, now with latency). Side calls of a turn (safety classifier, claim judges,
  the plan judge) take the recorder as a parameter. Proved by a test that drives the generator
  with every `next()` inside a different AsyncLocalStorage scope: all three calls land on the
  turn's run and none in the caller's scope. Jobs and team runs keep their ALS usage scope; the
  scope now carries `runId` and `onCall`.
- **Risk 2:** `TurnHooks { beforeModelCall, beforeTool, afterTool, afterReply }` at four fixed places;
  order: the Phase 77 plan check, the recorder, `TurnOptions.hooks`. The plan check moved behind
  `beforeTool` with the same rules and events (phase77 tests pass unchanged). The approval point
  itself stays inline (it is the §2.3 gate: a hook's `stopFor` becomes the approval card).
- **Risk 3:** coding steps record HEAD and branch (read from `.git`, no process) and the dirty files
  with a 16-hex sha256 each (one `git status --porcelain -z` in the background after the step is
  written; files over 2 MB: size only; up to 200 files). Only for the first step and steps that
  ran a file-changing tool. Chat-mode steps keep the undo snapshot id per tool; the step detail
  route compares it with the next snapshot for the files a shell call changed.
- **Risk 6:** a delegated job is one step with the job's command as a tool step and the agent's own
  token lines as model calls (`purpose: agent`); its inner steps are not visible.
- **Risk 11:** one INSERT per step at its end; prompts once per distinct text (sha256, deflated);
  history as an id range; tool output clipped to 4,000 characters. Retention: 30 / 90 (default) /
  365 days / until deleted, newest 500 runs per conversation, 200 MB cap (oldest first), branch
  parents always kept, orphan prompts dropped. Measured: 1.4 ms per step; ~0.6–0.8 kB per step plus
  ~5 kB per new prompt (`docs/RESULTS.md`).
- **Privacy:** secrets scrubbed by the same `Redactor` as tool output (prompt, notes, args, output);
  off the record never recorded (`runs` unset in the off-the-record context); private
  conversations recorded locally like the rest; a household member's runs live in their own space
  (`runs` is a member route answered from their database); the demo refuses the routes. Backups
  include runs (they are in the database); the data export only with `?runs=1` ("Include run
  history"), and import does not bring them back.
- **Deviations:** (1) runs are not kept "per conversation N" only: days + size cap + per-conversation
  500 together. (2) Forgetting messages does not yet hide them in a step's rebuilt history view
  (the run view rebuilds from the messages still stored; forgotten ones are filtered like in her
  history). (3) The "system prompt round-trips byte for byte" holds for the scrubbed prompt (the
  same unless the prompt carried a secret). (4) `findings` is still not a table: contradictions
  are copied from the reply meta into `run_steps.contradictions`. (5) `budget` holds a job's budget
  or a team task's limits; turns have none until M4. (6) Steps with no tools and no memory show no
  step line, so their run is reachable through the API and the run list, not from the chat.
- **Hooks left:** M4 `beforeModelCall` (meter: `RunRecorder` already sums tokens/cost per step) and
  `stopped='budget'`; M5 `beforeTool` → `stopFor` (a gate verdict) and `afterTool`; M6 `afterReply`
  with `final` + `workspace_ref` dirty files; M8 `parent_run_id`/`branched_from_step`, the step's
  system blob + history range + memory picks/policy id = the inputs to replay, `workspace_ref` to
  restore; M9 `runs.policy` (memory policy, model, tool-set hash) to compare variants; M10 the
  steps' tools, files and error outputs for the run signatures.

### M4 · Phase 79 · 2.12.0: enforced cost budgets

- **Ships:** a per-task ceiling (tokens, $, steps, minutes) for chat turns, set per conversation or
  as a default, plus the existing job/team budgets. When it is hit she doesn't keep spending. She
  steps down the ladder (switch to the quick model → stop offering tools → one last "summarize what's
  done and stop" call without tools, capped small) and the reply ends with what was dropped ("I
  stopped before running the tests; 3 files changed are kept"). Going on needs an explicit
  "Continue with more budget" (the existing job/team button, now on turns too).
- **Files:** `src/budget.ts` (new: `TurnMeter`, ladder), `src/chat.ts` (check before each model
  call; meter fed by wrapping the chain's providers), `src/jobs.ts`/`src/team.ts` (ladder), route +
  composer control, `web/steps.js`.
- **DB:** `runs.budget`, `run_steps.stopped='budget'`; conversation default in settings.
- **Done tests:** a budget of 1,000 tokens with a fake provider spending 600/step → the 2nd call is
  the cheaper route, the 3rd is the no-tools summary, then stop with the dropped list; a $ budget on a
  model with no price stops at the first call (same rule as `overBudget` L4, `src/usage.ts:379-381`);
  local models with no price are counted in tokens; Continue adds exactly the asked amount; budget
  never cuts the safety checks (minors check, receipt check run after the summary call too).
- **Built (Phase 79):**
  - `src/budget.ts` holds the one `Budget` (tokens, usd, steps, minutes) and `budgetCheck`.
    `overBudget` (the L4 / Phase 52 words and rules) moved there; `usage.ts` re-exports it.
    Jobs keep calling `overBudget`. Team tasks' `#overLimit` goes through `budgetCheck(teamBudget(...))`.
    Both keep their settings keys (`jobBudget`, `teamLimits`), wording, status and Continue button.
  - `TurnMeter` is a `TurnHooks` object; it reads the `RunRecorder`'s live sums. Its
    `beforeModelCall` returns a plan that `runTurnInner` applies at one spot: switch model,
    no tools, output cap, no thinking, notes, ask, stop.
  - The ladder:
    1. Switch to the quick route, only if it is set, allowed for the chat (private, local-only,
       household rules) and cheaper (`quickIsCheaper`). If it fails, the turn's own models are next.
    2. One more round of tools.
    3. A no-tools, no-thinking summary capped at 400 tokens. The prompt asks for what is done, what
       she didn't get to and what is kept. If it comes back empty, the app writes its own words
       (`budgetSummaryFallback`).
  - When the ladder starts:
    - 80% of any line is only a warning on the meter.
    - Steps: the ladder runs on the last 3, and the summary is the last allowed step.
    - Tokens and minutes: it starts when 4 more steps like the last (+10%) would pass the line.
    - On the ladder, one answer gets at most a third of the room left.
  - Calls refused after the summary are listed as `dropped`.
  - A turn that ends inside the capped round still counts as a budget stop.
  - Settings → Abilities → Budgets (`turnBudgets`, owner-only, `GET/PUT /api/budgets`, refused on
    the demo). Coding chats and work channels: on, 200k tokens / 40 steps, no $, no time limit.
    Everyday chats: off (the old 25-step stop still holds). Also: quick model on/off, and at the
    limit wrap up or ask first.
  - Ask mode shows an approval-style card. *Keep going* is an explicit override of the same budget
    again. Minutes spent waiting for approval aren't counted.
  - *Continue with more* (`POST /api/conversations/:id/continue` with `{budget}`, checked by
    `cleanMore`) starts a turn with exactly that budget. The app tells her once to carry on without
    redoing. The override is on the reply (`meta.budget.override`) and the run (`runs.budget`).
  - Subscriptions and local models: $ is not counted (`usdIgnored`, and the UI says so); tokens,
    steps and minutes are.
  - Approvals, never-tools, the minors check and the receipt check run as before, including on the
    summary.
  - UI: a meter on the step line and in the Run view (`web/budget-view.js`, `gauge` icon), and the
    Budget reached card. Measured on a real local model: [RESULTS.md](../RESULTS.md#budgets-a-long-coding-task-stops-cleanly-phase-79).
- **Deviations:**
  1. No per-conversation budget and no composer control. The defaults are per kind (coding,
     everyday), changed in Settings; Continue and the ask card are the per-task overrides.
  2. Jobs and team tasks share the Budget check but not the turn ladder. They still stop hard at
     their limit with Continue: a job is one command, and team steps run in their own loop.
  3. Without the coding budget, coding turns stop at 80 steps as before; everyday chats at 25.
  4. A summary that the safety layer blocked keeps the blocked reason on its step (not `budget`);
     the run is still `budget`.
- **Hooks left:**
  - M5: a sandbox gate's verdict can be refused like any tool; the budget never skips it.
  - M8: `runs.budget` (limits, used, rungs, dropped, override) is the input a branch replays.
  - M9: a variant's budget per run is `Budget` (`cleanMore` for the eval's own ceiling).
  - M10: runs with `status='budget'` and their `dropped` list feed run signatures.

### M5 · Phase 80 · 2.13.0: sandbox execution gate

- **Ships:** code she wrote runs first in a throwaway copy with no network. You see what it did
  (files it changed outside the project, hooks it wrote, processes left running, time) before
  anything runs in the real workspace. The gate is on for: commands that run code she just wrote or
  changed in this run, new dependency installs, and anything `runsCommands` while the platform has no
  OS sandbox. Findings go through the policy gate.
- **Files:** `src/sandbox-run.ts` (new), `src/tools/builtin.ts` (shell), `src/jobs.ts`,
  `src/tools/sandbox.ts` (a `scratch` bind option), THREAT_MODEL new section.
- **DB:** `findings` with `source='sandbox'`; `runs.kind` steps keep the sandbox result.
- **Done tests (most need Linux + bubblewrap, like `test/sandbox.linux.test.ts`):** a script that
  writes `.git/hooks/pre-commit` → finding, real workspace untouched; a script that writes outside
  the project tree inside the copy → finding; a script that leaves a background process → finding
  and the process is gone; no network inside (a loopback-only test server outside is unreachable);
  the copy is deleted afterwards; on Windows the gate says plainly there is no OS isolation and asks
  first (pure test of the decision).

### M6 · Phase 81 · 2.14.0: security pass + live advisories + fix branch

- **Ships:** after a coding run changes files, a security pass runs in the background: built-in
  static rules (string-built SQL/shell, `eval`/`new Function` on input, `innerHTML` from input,
  unsafe YAML/pickle loads, TLS checks turned off, permissive CORS, debug on), secret scanning (the
  `Redactor` patterns), and a dependency check of the lockfiles she changed. Any `npm install` /
  `pip install` she runs is checked against live advisories first: known-bad versions are blocked
  or need an override. For each real finding: a fix branch (`sara/fix-<finding>`) and a targeted
  prompt ("Fix finding #12: string-built SQL at `src/db.js:44` (quote). Change only what fixes it;
  then the pass runs again."). Result: fixed / still open, with the re-check as proof.
- **Files:** `src/security/{rules,secrets,deps,advisories,pass,fix}.ts`, `src/chat.ts`/`src/team.ts`
  (start after a run that changed files), `src/tools/builtin.ts` (install gate), `src/cards.ts`.
- **DB:** `findings`; `advisory_cache (ecosystem, name, version, fetched_at, ttl_s, verdict JSON)`.
- **Advisory source:** OSV.dev batch query through `netFetch` (one source, no key). Cache TTL
  6 hours for "clean", 1 hour for "unknown/error", never more than 50 packages per call, one
  call in flight per space.
- **Done tests:** each rule has a hit and a near-miss fixture (no payloads, just the code shapes);
  a finding without a correct quote is dropped; an advisory fixture (fake transport,
  `setNetTransport`) blocks `pkg@1.2.3` and allows `1.2.4`; the second check within the TTL makes no
  request; private local mode → no request, cached verdicts still apply, unknown → "not checked
  (offline)"; the fix loop opens a branch, re-runs only the failing rule, marks fixed; push stays
  "ask first".

### M7 · Phase 82 · 2.15.0: threat-model second pass

- **Ships:** after M6, a reviewer pass maps the entry points her changes touch (HTTP routes, CLI
  args, file and network input, deserialization, auth checks) using the code map, and lists
  attack-surface findings with file:line and a quote. Then a second pass whose **only** job is fixing
  those findings, on the fix branch. If the reviewer can't quote a real line, the finding is dropped.
- **Files:** `src/security/threats.ts`; reuses `fix.ts`, `reviewDiff`, `code_deps`/`code_refs`.
- **Model calls:** yes (reviewer route). See §3.12.
- **Done tests:** a fake reviewer answer with a wrong quote → dropped; a correct one → finding; the
  fix pass gets only the findings and the files they name; an empty diff → no model call; a
  route without an auth check in a fixture app → a finding from the **code** part (entry-point
  listing is code; the model only judges).

### M8 · Phase 83 · 2.16.0: time-travel (branch from a step)

- **Ships:** on any step of a run: "Branch from here". Change one input (your message, the model,
  a memory note in or out, a tool's permission, the budget) and she carries on from that step in a
  new conversation, with the workspace as it was at that step. The original stays. The two runs can be
  compared side by side (steps, files, cost).
- **Files:** `src/branch.ts` (new: replay runner), `src/store.ts` (`forkConversation(id, upToMessageId)`),
  `src/snapshots.ts` (restore into a new workspace dir), routes, `web/steps.js`.
- **DB:** `runs.parent_run_id`, `branched_from_step`; conversation `meta`/column `forked_from`.
- **Done tests:** fork copies messages up to the step and none after; the changed input is the only
  difference in the first replayed step's recorded inputs; workspace restored into
  `<ws>--branch-<n>` and the original untouched; memory override (exclude note 7) shows up in
  `memory_picks`; private conversations fork as private.

### M9 · Phase 84 · 2.17.0: eval loop

- **Ships:** in a project, write what "done" means: test command, assertions on files, expected
  artifacts, an optional rubric. Then: "Try 3 ways" (prompt version / tool set / memory policy /
  model). Each runs from the same start in its own sandbox copy. The report names the winner with the
  evidence: tests passed, assertions met, cost, steps, and links to each run. A rubric score counts
  only as a tie-breaker and only with quoted reasons.
- **Files:** `src/evals.ts` (spec reader, `bench/` task format), uses `branch.ts` + `sandbox-run.ts`;
  route + project page section.
- **DB:** `eval_specs` (or files in `.sara/evals/`), `eval_runs (id, spec, variant JSON, run_id,
  passed, total, tokens, usd)`.
- **Done tests:** a fixture spec with hidden tests: variant A passes 3/3, B 1/3 → A wins with both runs
  linked; two equal → cheaper wins and the report says why; a rubric-only difference is labelled
  "tie-breaker"; the existing `bench/tasks` verify mode still passes (shared reader).

### M10 · Phase 85 · 2.18.0: active recall triggers

- **Ships:** when a new task looks like an old one (the same files, the same tools, the same error
  text, the same goal words in the same workspace), she gets "Last time (12 Oct) a similar task: you
  edited `src/cart.js`, the fix was the rounding in `total()`; it took 2 tries" without asking. The
  "why" is shown like M1's confidence note.
- **Files:** `src/triggers.ts` (signature per run: files, tools, error lines normalised, goal
  words); a prompt section next to `recipes`.
- **DB:** `run_signatures (run_id, workspace, files, tools, errors, words)` with FTS5.
- **Done tests:** a run touching `src/cart.js` with a failing `npm test` → a later turn naming
  `cart.js` gets the trigger; a different workspace → none; private runs only trigger in private
  conversations; at most one trigger per turn; external app turns never get it.

### M11 · Phase 86 · 2.19.0: red-team mode

- **Ships:** "Try to break it" before shipping. In the throwaway sandbox Sara runs her own output
  against a **fixed catalogue** of generic checks: the project's tests; robustness inputs (empty,
  very long, unusual Unicode, wrong types, malformed JSON, boundary numbers) at the entry points M7
  found; insecure-default checks (listening on all interfaces, debug mode, default credentials in
  config, permissive CORS, missing security headers on a preview, secrets in files); behaviour checks
  from M5. It reports what broke, then runs the M6 fix-branch path. The attacker-side model only
  **chooses** which catalogue checks to run and fills generic values from the catalogue's own value
  sets. It never writes probe code. A stronger reviewer model confirms each finding's quote and
  severity. THREAT_MODEL gets a section saying exactly this.
- **Files:** `src/redteam.ts`, `src/redteam-probes.ts`; reuses `sandbox-run.ts`, preview +
  `browser_check`, `findings`, `fix.ts`.
- **Done tests:** each probe has a fixture app that fails it and one that passes; the model can't
  add a probe (an answer naming an unknown probe is ignored); nothing runs outside the sandbox copy;
  network stays off; findings flow into the fix path; a run in private local mode uses only local
  models.

### 3.12 Model calls, small local models, private local mode

| Feature | Model call? | Small local model | Private local mode ("Nothing leaves this computer") |
|---|---|---|---|
| M1 ranking, decay | **No** (code) | Same quality; notes kept short so small contexts aren't flooded | Works as is |
| M2 contradiction | Code first; optional judge (owner's claim-judge model) | Code path only is the default; judge is time-boxed and fails open to "flag" | Judge only on a model on this computer (same rule as `judgeUnsure`, `src/chat.ts:520-521`) |
| M3 run snapshots | No | – | Works; nothing leaves |
| M4 budgets | One extra small "summarize and stop" call when hit | Local calls cost $0; token/step/minute budgets still apply | Works; degrade uses the local quick model |
| M5 sandbox gate | No | – | Works; network is already off for commands |
| M6 security pass | Static/secret/deps: **no**. Fix prompt: yes (coding route) | Rules are code; fixes on a small model may need more tries (the re-check proves it) | Static + secrets work. **Live advisories can't be fetched**: cached verdicts still apply, new packages show "not checked: offline", and installs can't download anyway (no network for commands). Optional: import an advisory snapshot file by hand. |
| M7 threat pass | Yes (reviewer route) | Entry-point listing is code; the model only judges and must quote. A weak model drops findings it can't prove instead of inventing them | Reviewer only on a local model |
| M8 time-travel | Re-runs the turn from the step (normal cost) | – | Works |
| M9 eval loop | N reruns (N × normal cost; budget per variant from M4) | Works; slower | Works with local variants only |
| M10 triggers | No | – | Works |
| M11 red-team | Yes: a small "pick probes" call and a reviewer call | Probes are a fixed catalogue, so a small model can't make them worse, only pick fewer | Works with local models; no network inside the sandbox anyway |

**Pairing (from the brief):** the "attacker inside the sandbox" is the coding route's model
choosing catalogue probes. The "stronger reviewer" (Gemma 4 31B class) is a new job,
**`review`**, in Settings → Which model does what (`RoutePurpose`, `src/settings.ts:21`), which
falls back to `coding` (`INHERIT`, `src/chat.ts:290`).

---

## 4. M1 in detail: ranked injection, confidence notes, decay

### 4.1 Data model (additive)

In `MemoryStore`'s constructor column loop (`src/memory.ts:128`) add:

| Column | Type | Meaning |
|---|---|---|
| `pinned` | `INTEGER NOT NULL DEFAULT 0` | Never fades; always a candidate (still under the budget) |
| `last_used_on` | `TEXT` | Local day it last went into a prompt **because it matched** |
| `use_count` | `INTEGER NOT NULL DEFAULT 0` | Days it was used that way (at most +1 per day) |

`Memory` gets `pinned`, `lastUsedOn`, `useCount`; `toMemory` reads them. Older versions ignore the
columns (rollback-safe, same as every other migration here). Backups and export carry them.

Decay policy in `MemorySettings` (`src/memory-worker.ts:13`):

```ts
export interface DecayPolicy {
  /** Days for an un-pinned, un-used note's weight to halve. 0 = no decay. */
  halfLifeDays: number;
  /** How much being used before lifts a note (0–0.3). */
  reuseWeight: number;
  /** Below this a note that didn't match the message stays out (0–1). */
  minStanding: number;
}
```

The existing `fade` stays as the preset name and maps to a policy: `never` → half-life 0; `slow`
→ 365; `normal` → 120 (the same numbers as `FADE_DAYS`, so nobody's behaviour jumps). A new
`custom` takes `halfLifeDays` from the slider. `policyId` = a short hash of the policy (for M3/M9).

### 4.2 Scoring (code only, deterministic, explainable)

For each candidate note:

- **Relevance** `r`: from the word match: the share of the message's query words found in the
  note (`ftsQuery` words, `src/memory.ts:108`; matched words listed for the "why"). From the
  meaning match: the cosine score above `MIN_SCORE` scaled to 0–1 (`src/embeddings.ts:29`). `r` is
  the larger, plus a bonus when both agree.
- **Standing prior** (notes that didn't match, as today): open promise 0.5, decision 0.35, fact
  0.25, self 0.2, other-conversation summary 0.2, reflection 0.15.
- **Freshness** `f = 0.5 ^ (ageDays / halfLifeDays)`, age counted from the later of `happenedOn` and
  `lastUsedOn`. Pinned notes, open promises and dates: `f = 1` (today's rule kept).
- **Reuse** `u = min(1, log2(1 + useCount) / 4)`.
- **Score** = `(r || prior) × (0.6 + 0.4 f) + reuseWeight × u`, pinned floored at 0.9.
- Notes that matched are always eligible. Standing notes only if score ≥ `minStanding`. This
  replaces the hard cut-off at `src/memory.ts:446-448`. With fade `never` nothing changes.
- **Confidence**: `high` = word and meaning matches agree, or pinned with a match. `medium` = one
  signal. `low` = standing (no match). Plus "older, may be out of date" when `f < 0.5`.
- Sorted by score, ties by newest `happenedOn`, then id (deterministic). Then the existing greedy
  fill under `budgetChars` (`:488`), with the note's own length counted.

### 4.3 What the prompt gets

Today's line shape stays, and a short note is appended after the content, so existing tests and
small models see the same thing first:

```
- (2026-10-20) Alex's dog is a beagle named Biscuit. [why: words "dog", "biscuit" + meaning; sure: high]
- (2026-03-02, decided together: go by it unless told otherwise) Alex wants tests before every push. [why: standing decision; sure: low; older, may be out of date]
```

`src/persona.ts:243` header gets one sentence: "Each note ends with why it came to mind and how
sure that is. Lean on 'high', treat 'low' as background." The voice call prompt (`src/live.ts:544`)
and her day (`src/life.ts:314`) call `selectMemories` too. They get `notes: false` (no bracket notes)
so nothing like "[why: …]" is ever read aloud.

### 4.4 APIs and hooks

| Where | Change |
|---|---|
| `src/memory-rank.ts` (new) | `rankMemories(mem, { query, conversationId, oldestHistoryId, related: {memory, score}[], policy, today, allow?, override? }) → RankedPick[]` (pure); `decayPolicy(settings) → DecayPolicy & { id }`; `explainPolicy(policy) → string` (for Settings, in words) |
| `src/memory.ts` | `search(q, limit) → { memory, matched: string[] }[]` (FTS5 + bm25, matched words computed in code); `setPinned(id, on)`; `markUsed(ids, day)` (+1 only if `last_used_on <> day`); `selectMemories` keeps its signature and return type, now built on `rankMemories`, and adds `picks: PickNote[]` and the options `notes?: boolean`, `policy?`, `override?: { include?: number[]; exclude?: number[] }` (the M8 "change one input" hook) |
| `src/chat.ts:920` | keep the meaning scores: `related` passed as `{ memory, score }` |
| `src/chat.ts:921-934` | pass `policy: decayPolicy(s)`; after the reply is saved (`:1138`): `meta.memoryPicks = injection.picks` next to `memoryIds`, and `markUsed` for picks with a match (not standing ones, so injected notes don't feed themselves) |
| `src/routes/memory.ts:77` | `PATCH /api/memories/:id` accepts `pinned: boolean` |
| `src/routes/memory.ts:25` | `GET/PUT /api/memory/settings` add `decay` (clamped: half-life 0 or 7–3650, reuse 0–0.3, minStanding 0–1) and `decayText` |
| `web/her-panel.js` | "She remembered" rows: sureness chip + why line from the last reply's `meta.memoryPicks` (no new request), a pin button (`PATCH`) |
| Settings → Memory (`web/app.js` ~`:5144`) | fade select gains "Custom" + half-life slider; a "How fading works" line from `decayText`; **?** tip for each |
| Memory page | pin toggle per note; pinned filter |

### 4.5 Tests (new `test/phase76.test.ts`, plus the existing ones kept green)

1. A note matching words and meaning ranks above a word-only match; both above a standing note.
2. Confidence: both signals = `high`, one = `medium`, standing = `low`, pinned+match = `high`.
3. Decay: the same matched fact dated 30 vs 400 days ago with half-life 120 → older scores lower but
   **is still injected**; with `never` the two score the same.
4. A standing fact older than `minStanding` allows stays out; pinned, it goes in; open promises and
   dates never fade (today's rule).
5. `markUsed` adds at most 1 per day; standing picks don't count; the reuse lift is capped.
6. Budget: total characters including the bracket notes stay ≤ `budgetChars`.
7. Same inputs → same order (ties broken by date then id).
8. Another app's turn (`allow`) still never sees private, imported or adult-channel notes
   (Hardening M3 rule, `src/chat.ts:914`).
9. `override.exclude` removes a note, `override.include` adds one (for M8).
10. Route: `PATCH pinned`, settings clamp, `decayText` present; a member space can't reach it
    (existing `memberRouteCheck`).
11. Reply `meta.memoryPicks` saved; `memoryIdsOfLastTurn` (`web/her-panel.js:489`) unchanged.
12. `notes: false` (live call, her day) → no bracket text.
13. Speed: 10,000 notes ranked in < 50 ms on the dev PC (one `node --test` timing assert with slack).
14. Existing `test/memory.test.ts` (incl. the `\(2026-10-20\) Alex's dog…` match at line ~104),
    `recall.test.ts`, `weekly.test.ts`, `history-import.test.ts` pass unchanged.

Plus `scripts/eval-memory.ts --rank`: an offline golden set (no model) of 20 messages × the note
each should surface first; reported in `docs/RESULTS.md`. And the existing model run on the local
model must not drop below its last score (11/12).

### 4.6 Done means

- `npm run check` green (log with `ℹ fail 0`), `node scripts/tip-coverage.ts` 0 uncovered,
  `node scripts/i18n-extract.ts` no gaps.
- On the live build: the owner sees why + sureness in "She remembered", pins a note, changes the
  half-life, and the next reply's picks change accordingly.
- Docs updated: `docs/ARCHITECTURE.md` (module table), `CHANGELOG.md` 2.9.0, `ROADMAP.md` +
  `ROADMAP.public.md` Phase 76, `web/help.html` memory section, `docs/DECISIONS.md` (decay presets).

### 4.7 Patch plan (in commit order, each one green on its own)

1. `memory.ts`: columns + `Memory` fields + `search()` + `setPinned()` + `markUsed()`. Tests 5, 14.
2. `memory-rank.ts` + `DecayPolicy` in `memory-worker.ts`. Tests 1–4, 7, 9, 13.
3. `selectMemories` on top of `rankMemories` with bracket notes; `persona.ts` header sentence;
   `live.ts`/`life.ts` pass `notes: false`. Tests 6, 8, 12, 14.
4. `chat.ts`: keep meaning scores, policy, `meta.memoryPicks`, `markUsed`. Test 11.
5. Routes (`pinned`, `decay`, `decayText`). Test 10.
6. Web: panel why/sure/pin, Settings decay, Memory page pin; i18n ×5, tips, help.
7. `eval-memory.ts --rank` + RESULTS; docs; CHANGELOG; version 2.9.0.

## 5. Hooks M1 leaves for later milestones

| Hook | Used by |
|---|---|
| `rankMemories(query, …)` takes any text, not just the owner's message | M2 (query = the planned tool call), M10 (query = the task signature) |
| `RankedPick.policyId` and `decayPolicy().id` | M3 records them per step; M9 compares memory policies as a variant |
| `selectMemories({ override })` | M8 "change one input": a note in or out on a branch |
| `meta.memoryPicks` on every reply | M3 copies them into `run_steps.memory_picks` (the backfill for older turns is the reply meta) |
| `markUsed` / `use_count` | M10 favours triggers whose notes were actually useful |
| Kind priors in one table in `memory-rank.ts` | M2 marks `decision` notes as binding candidates |
| Bracket-note format `[why: …; sure: …]` | M10 trigger lines and M2 contradiction cards use the same words, so the owner learns one format |

## 6. Where the current shape fights us

| # | Risk | Why it matters | What to do |
|---|---|---|---|
| 1 | **`runTurn` is an async generator** (`src/chat.ts:752`) and the usage meter's scope is `AsyncLocalStorage` (`src/usage.ts:31`). An `AsyncLocalStorage.run()` around a generator does not reliably carry into code resumed by the caller's `next()`. | Per-turn budgets (M4) and run ids (M3) can't just wrap the turn the way jobs and team do (`src/jobs.ts:167`, `src/team.ts:405`). | Pass a `RunRecorder`/`TurnMeter` explicitly and wrap the chain's providers with it (like `metered()`), not through ALS. Prove it with a test before M3 lands. |
| 2 | **`runTurnInner` is one ~520-line function** (`src/chat.ts:762-1283`), and M1, M2, M3, M4, M5 and M10 all hook into it. | Merge pain and hidden coupling. | M3 introduces one seam: a `TurnHooks` object (`beforeModelCall`, `beforeTool`, `afterTool`, `afterReply`) called at four fixed places. Later milestones add hooks, not inline code. No big refactor. |
| 3 | **Workspace snapshots are off in coding mode** (`src/chat.ts:1221`); coding relies on git. Snapshots also skip `node_modules` etc. and files over 50 MB (`src/snapshots.ts:11-14`). | Time-travel (M8) and the sandbox copy (M5) need "the workspace at step N" exactly where it matters most. | Coding runs record git HEAD + hashes of dirty files per step (cheap). A branch restores via `git worktree` at HEAD + the dirty files from the snapshot objects. Dependencies are reinstalled in the branch (noted in the UI). |
| 4 | **No OS sandbox on Windows** (`detectSandbox` → `none`, `src/tools/sandbox.ts:148`), and the dev PC, the Windows desktop app and the Windows installer all run there. Docker installs use the weaker `user` mode. | The M5/M11 "throwaway sandbox" promise isn't true on Windows. | Say so in the UI. On Windows the gate still copies and diffs (behaviour is visible) but labels it "not isolated" and always asks first. See question 1. |
| 5 | **Today's sandbox writes the real workspace** (bubblewrap binds it read-write). | "Before it touches the developer's machine" needs a copy. Copying big repos costs time and disk. | Copy from the snapshot object store (unchanged files once). Cap size, skip regenerable folders, and say when a project is too big for the gate. |
| 6 | **CLI-agent models and delegated jobs** (Claude Code / Grok as a model, `src/providers/cli-agent.ts`; `delegate_task` jobs) do their own steps inside another process. Subscription billing reports $0. | Snapshots see only what crosses `agent-bridge`; $ budgets mean nothing on a subscription. | Record what crosses the bridge; budgets for those runs are minutes/steps/tokens only, and the UI says so. |
| 7 | **Prompt shape is tested and read aloud.** Tests match the exact memory line (`test/memory.test.ts`), and voice calls use the same notes (`src/live.ts:544`). | Confidence notes could break tests or be spoken. | Notes go after the content; `notes: false` for voice and her day (§4.3). |
| 8 | **Rich get richer.** Reuse lifts a note, and a lifted note gets injected again. | Decay never bites on popular notes; stale notes stick. | Only matched picks count as use, +1 per day at most, capped lift (§4.2). |
| 9 | **Contradictions on small models.** Judging "does this action break that decision" in natural language is unreliable on small local models. | False stops annoy; missed ones erode trust. | Code-matched binding rules decide stops. The model may only flag, and only quoted. Measure with an eval set before turning stops on beyond the clear shapes. |
| 10 | **Advisories need the network; private local mode forbids it** (`src/net-guard.ts`). Sending the package list to an outside service is also a privacy question. | "Live" is impossible offline. | Cache + "not checked: offline" (§3.12). Never send from private conversations. Opt-in with the dependency list shown once. |
| 11 | **Growth of `sara.db`.** Step records for every turn of every companion, plus backups by `VACUUM INTO`. | Bigger backups, slower phone restores. | Prompts by hash, history by id range, retention per conversation, a "Runs" line on the health page. |
| 12 | **The red-team must stay generic, and the repo is public.** | The project rule and the brief forbid attack tooling. | Probe catalogue in code, reviewed like the minors check: generic inputs only, no payload strings for real-world systems, a test that the model can't add probes, a THREAT_MODEL section. |
| 13 | **Owner order rule** (`AGENTS.md`, SOURCE_OF_TRUTH §2 #9): phases are built in ROADMAP order with exit gates on the live build. | Phases 76–86 must be written into `docs/ROADMAP.md` before M1 starts; the M8/M9 swap needs the owner's OK. | Add them as the next phases after this doc is approved; record the swap in `docs/DECISIONS.md`. |

## 7. Blocking questions, and the defaults taken (owner away, 2026-10-30)

The owner asked for the track to be built autonomously. Each question below was decided with the
safer default; all are recorded in docs/DECISIONS.md and listed in OWNER_CHECKS so he can change them.

- **1 → copy + diff + always ask first on Windows, labelled *not isolated*.** If Docker or WSL2 is
  found, the gate uses it (isolated); nothing new is required to install.
- **2 → OSV.dev, opt-in, off in private local mode and private conversations;** the list of packages is
  shown before the first check. Offline: "not checked: offline", cache only.
- **3 → coding turns get a default ceiling (200k tokens / 40 steps, no $ default), changeable and
  switchable off in Settings;** the degrade step uses the quick model route.
- **4 → yes:** approval-card stops only for tool actions in coding and work conversations; everyday
  chat only flags.
- **5 → fix branches stay local; push and PRs keep asking first.** The new **Reviewing** model job
  (falls back to Coding) is added, and the M8/M9 swap is taken.

The original questions:


1. **Windows and the sandbox gate.** Windows has no OS isolation today. For M5/M11 on Windows, is
   "copy + diff + always ask first, labelled *not isolated*" acceptable, or do you want Sara to
   require WSL2/Docker for the gate (an outside program to install)?
2. **Advisory source and privacy.** OK to use OSV.dev (free, no key) as the one live source, sending
   package names + versions from her projects, opt-in, never from private conversations or private
   local mode?
3. **Chat budgets by default.** Should every coding turn get a default ceiling (my suggestion: 200k
   tokens / 40 steps, no $ default), or should turn budgets be off until you set one? The degrade
   step uses the "quick" model route. OK?
4. **How hard contradiction stops.** Stop with an approval card only for tool actions in coding and
   work conversations, and just flag in everyday chat (where her character already mentions it gently)?
5. **Fix branches on GitHub.** Fix branches stay local by default with push/PR "ask first" as today.
   Or should a security fix push and open a PR on its own after the re-check passes? And OK to add the
   new model job **"Reviewing"** (`review`, falls back to Coding) for the stronger second-pass model,
   and to swap the order to M8 time-travel → M9 eval?
