# Results

What Sara scores on a public coding benchmark and on her own memory, library and code-map evals,
exactly as run, with the scripts to run them yourself. Nothing here is cherry-picked: each number
is the latest full run of that script, and the summaries of those runs are in
[`docs/results/`](results/) (scores, models, dates and per-item pass/fail; the raw files with whole
replies stay out of the repository).

| Benchmark | Model | Score | Date | Re-run |
|---|---|---|---|---|
| HumanEval, through her agent loop (tools, runs her own tests) | qwen3.8 27B (local) | **158/164** (pass@1 96.3%) | 2026-10-27 | `node scripts/bench-coding.ts` |
| HumanEval, same model with no tools (baseline) | qwen3.8 27B (local) | **161/164** (pass@1 98.2%) | 2026-10-27 | `node scripts/bench-coding.ts --mode raw` |
| Repository tasks (14 original multi-file tasks, hidden tests), through her agent loop | qwen3.8 27B (local) | **11/14** (both runs) | 2026-10-28 | `node scripts/bench-tasks.ts --mode agent` |
| Repository tasks, same model with every file in one prompt, no tools (baseline) | qwen3.8 27B (local) | **12/14** (both runs) | 2026-10-28 | `node scripts/bench-tasks.ts --mode raw` |
| Real-size projects (3 original projects, 22–36 files, hidden tests), through her agent loop | qwen3.8 27B (local) | **2/3 and 3/3** after the fix below (0/3 before it) | 2026-10-28 | `node scripts/bench-tasks.ts --tier projects --mode agent` |
| Real-size projects, same model with every file in one prompt, no tools (baseline) | qwen3.8 27B (local) | **3/3** (both runs) | 2026-10-28 | `node scripts/bench-tasks.ts --tier projects --mode raw` |
| Claim check in 6 languages, held-out replies: patterns only / + local judge | `qwen3.5:9b` (local) as judge | precision / recall **0.92 / 0.38** → **0.95 / 0.88** | 2026-10-28 | `node scripts/eval-claims.ts --judge qwen3.5:9b` |
| Memory across sessions (recall, no inventing, forgetting) | qwen3.8 27B (local) | **11/12** checks | 2026-10-27 | `node scripts/eval-memory.ts --model <model>` |
| Memory ranking: the note that should come first (40 notes, 20 messages, no model) | none (code only) | **19/20** | 2026-10-30 | `node scripts/eval-memory.ts --rank` |
| Plan check: planned tool calls vs. stored decisions, stop / flag / none (no model) | none (code only) | stops: precision / recall **1.00 / 1.00** on both sets; exact **35/35** (development) and **11/12** (held out) | 2026-10-30 | `node scripts/eval-contradict.ts` |
| Library: answers from documents, with the source | qwen3.8 27B (local) | **8/8** in both runs | 2026-10-27 | `node scripts/eval-library.ts --model <model>` |
| Library with meaning search | qwen3.8 27B (local) + nomic-embed-text | **8/8** in both runs | 2026-10-27 | `node scripts/eval-library.ts --model <model> --embed nomic-embed-text` |
| Code map: "where is…?" questions on Sara's own code | qwen3.8 27B (local) + nomic-embed-text | **8/8** with code tools, **8/8** without | 2026-10-27 | `node scripts/eval-codemap.ts --embed nomic-embed-text` |

Full model name: `qwen3.8:27b-mtp-q4_K_M` on Ollama. Summaries: [humaneval-agent](results/humaneval-agent.json),
[humaneval-raw](results/humaneval-raw.json), [tasks-agent](results/tasks-agent.json),
[tasks-raw](results/tasks-raw.json), [projects-agent](results/projects-agent.json),
[projects-raw](results/projects-raw.json), [claims](results/claims.json),
[claims-qwen3.5_9b](results/claims-qwen3.5_9b.json), [claims-gemma4_12b](results/claims-gemma4_12b.json),
[memory](results/memory.json),
[library](results/library.json), [library-meaning](results/library-meaning.json),
[codemap](results/codemap.json).

## Setup for these runs

| | |
|---|---|
| Computer | One Windows 11 PC, NVIDIA RTX 5090 (32 GB) |
| Model server | Ollama on the same PC, OpenAI-compatible endpoint (`http://127.0.0.1:11434/v1`) |
| Model | `qwen3.8:27b-mtp-q4_K_M` (27.3 B parameters, 4-bit Q4_K_M) unless a row says otherwise |
| Sara | 0.53 + the Phase 54 work, default character, Node 24.20 |
| Sandbox | None (Windows has no command sandbox); the benchmark runs in throwaway folders |

The GPU was shared with other work during some runs (recording the README demo, the other evals),
which changes timings, not scores.

## HumanEval: coding through her agent loop

[HumanEval](https://github.com/openai/human-eval) is OpenAI's set of 164 Python programming
problems with hidden unit tests (MIT license). `scripts/bench-coding.ts` downloads it from the
official repository on the first run (it is not copied into this repository) and runs every
problem through **Sara's normal agent loop**:

1. A new coding conversation with a workspace holding `solution.py`: the function's signature and
   docstring only.
2. She is asked to implement it and test it herself by running Python ("When it works, reply with
   one short line"). She uses her usual tools (`read_file`, `write_file`, `edit_file`, `shell`);
   the shell runs without asking because nobody is there to approve, and web access is off so she
   can't look anything up.
3. After her turn, the **hidden tests**, which she never sees, run against whatever `solution.py`
   she left, in a separate folder with a 30-second limit.

One attempt per problem, so the score is **pass@1**. A turn is stopped after 300 seconds; what she
saved by then is what gets tested.

**What happened in this run:** 158 of 164 passed (96.3%), using 3 to 17 tool calls per problem and
38 minutes of turn time in total. The six failures were HumanEval/32, 47, 93, 108, 116 and 129.
One problem (HumanEval/111) was slowed by a real bug that the benchmark found: she ran
`find / -name solution.py | head -1` to look for her file, the command ran into the 300-second
stop, and on Windows the stop didn't end that `find` process, so the turn kept waiting. It finished
(and passed, with the solution she had already saved) only after the stray `find` was ended by
hand. It is fixed in 0.54: a stopped command now ends every process it started, and Sara stops
waiting for output once the time is up.

**Baseline without her tools** (`--mode raw`): the same model is asked for the function in one
reply, with no tools and no chance to run anything, and the same hidden tests score it. It scored
**161 of 164 (98.2%)**, three more than the agent loop, in 16 minutes. So on HumanEval her loop
does **not** add points: this model already solves almost all of these short problems in one go,
and testing against the docstring can even lead her astray. Three of the problems she missed
(HumanEval/93, 108 and 129) were solved by the plain completion, and on HumanEval/116 the
docstring's own example (`sort_array([1, 5, 2, 3, 4]) == [1, 2, 3, 4, 5]`) disagrees with the
hidden test (`[1, 2, 4, 3, 5]`), so checking her work against the docstring pushed her to the
answer the tests reject. Both runs missed HumanEval/32 and 47; the plain completion also missed
HumanEval/145. What the loop is for (working in a real project, running its tests, fixing what
fails, showing receipts) needs a bigger, multi-file benchmark to measure: see
[repository tasks](#repository-tasks-multi-file-coding) below.

**A caution about HumanEval:** it was published in 2021 and is widely used, so recent models have
very likely seen these problems (or close copies) in training. Treat the score as "her loop works
end to end and doesn't get in the model's way", not as a measure of how she does on new, larger
tasks. Harder, newer benchmarks are on the list ([good first issues](GOOD_FIRST_ISSUES.md)).

Re-run it:

```sh
node scripts/bench-coding.ts --model <ollama model>               # all 164, through her agent loop
node scripts/bench-coding.ts --model <ollama model> --mode raw    # baseline: one reply, no tools
node scripts/bench-coding.ts --limit 20 --minutes 30              # a quick partial run
```

It needs Python 3 on the PATH (`--python` to pick one) and an OpenAI-compatible server
(`--ollama <url>`). It runs the code the model writes on your computer without a sandbox, so use a
machine where that's fine. Results go to `evals/results/<date>-coding-<mode>.json`.

## Repository tasks: multi-file coding

`scripts/bench-tasks.ts` runs 14 small repository tasks written for Sara (in
[`bench/tasks/`](../bench/README.md); none are copied from other benchmarks): bugs spread over two
or three modules, features described in a README or SPEC, and refactors that must not change
behaviour, 10 in JavaScript and 4 in Python. Each project has its own test suite (some tests fail
at the start) and **hidden tests** she never sees, run after she's done. Before any model ran,
`--mode verify` checked that every task's hidden tests fail on the starting code and pass on a
reference solution kept outside the task folder.

- **Agent mode:** a new coding conversation with a copy of the project in her workspace and the
  request; she reads files, edits, runs the tests in the shell (without asking, nobody is there to
  approve; no web access) and says when she's done. A turn stops after 480 seconds.
- **Raw mode (baseline):** the same model gets the request and **every file of the project** in
  one message and must reply with the full new content of each file it changes; those files are
  written and the same hidden tests run.

**What happened:** two full runs of each mode on the same day. Her agent loop solved **11 of 14
both times**; the plain model solved **12 of 14 both times**. So on these tasks her tools did
**not** add points either. The agent used 7 to 33 tool calls per task (about 250 per run) and
12 to 17 minutes per run; the plain completions took 8 to 10 minutes.

| Task | Agent, run 1 | Agent, run 2 | Raw, run 1 | Raw, run 2 |
|---|:-:|:-:|:-:|:-:|
| 01 cart totals (README says a discount is never more than the subtotal) | ✗ | ✗ | ✓ | ✗ |
| 04 slugify (SPEC's length rule) | ✓ | ✗ | ✗ | ✓ |
| 07 refactor tax (see the note below) | ✗ | ✓ | ✓ | ✓ |
| 14 settings-file reader (an indented key right after a section line) | ✗ | ✗ | ✗ | ✗ |
| the other 10 tasks | ✓ | ✓ | ✓ | ✓ |

The misses are spec details that the tests in the project don't cover: in both modes the model
fixed what the failing tests pointed at and skipped a rule written only in the README or SPEC.
Running the tests helped her find the bugs, but it can't catch a rule no test checks, and these
projects are small enough (5 to 7 files each) that the plain model sees all of them at once anyway.
Tasks where tools should matter more (projects too big to paste, with no README listing every
rule, or that need running a program to understand it) are the next step: see
[real-size projects](#real-size-projects).

**A correction during the run:** in the first run, task 07's hidden tests also checked that the
new `computeTax` throws for an unknown region, which its request didn't ask for. Her run-1 answer
failed only that check. The check was removed (the tests of `orderTotal` and `invoiceLines` still
cover unknown regions) and both modes were run again in full; the table shows both runs, and the
summaries keep every run of the day (`everyRun`). Small set, one model: treat these numbers as a
sanity check of the loop, not a leaderboard.

Re-run it:

```sh
node scripts/bench-tasks.ts --mode verify                         # no model: the tasks are sound
node scripts/bench-tasks.ts --mode agent --model <ollama model>   # through her agent loop
node scripts/bench-tasks.ts --mode raw --model <ollama model>     # baseline: one reply, no tools
node scripts/bench-tasks.ts --only 01-cart-totals,05-date-range  # a few tasks
```

Like the HumanEval script, it needs Python 3 and runs the code the model writes on your computer
without a sandbox. Results go to `evals/results/<date>-tasks-<mode>.json`.

## Real-size projects

`scripts/bench-tasks.ts --tier projects` runs three bigger projects written for Sara (in
[`bench/projects/`](../bench/README.md#real-size-projects-phase-62); none copied from anywhere),
in the same format and with the same rules as the repository tasks: each has a README and docs that
state every rule the hidden tests check, its own test suite (partly failing), and hidden tests she
never sees. `--mode verify` checked first that every project fails its hidden tests as given and
passes them with a reference solution kept outside the project.

| Project | Files / lines | What has to happen |
|---|---|---|
| 21 notes API (bug) | 36 / 1,065 | A JSON web API on `node:http`. Three user reports (ISSUES.md): expired tokens still work for a while, people a note is shared with can delete it, a lower-case `bearer` is refused. Causes in the auth middleware (a refresh-only grace period applied to every route, a case-sensitive scheme check) and the note access rules |
| 22 ledger CLI (bug) | 32 / 867 | A money-ledger command line after a refactor. Four regressions across the shared option parser (`--since=…`, negative numbers like `-12.50`), the amount parser (`1,234,567.89`) and the date filter (`--until` must include its day) |
| 23 units library (refactor) | 22 / 539 | Units are defined in four places, so `registerUnit()` only half works. Move every unit into one registry that parse, format, convert, compare and sum all read, then add nautical miles, stone and US cups |

Same model, settings and machine as the other coding runs; agent turns stop after 900 seconds.

| Project | Agent run 1 (before the fix) | Agent run 2 | Agent run 3 | Raw run 1 | Raw run 2 |
|---|:-:|:-:|:-:|:-:|:-:|
| 21 notes API | ✗ (80-step stop, `[REDACTED]` in the code) | ✓ 523 s, 93 tool calls | ✓ 33 s, 22 calls | ✓ | ✓ |
| 22 ledger CLI | ✗ (model sent an empty reply mid-task) | ✓ 80 s, 36 calls | ✓ 112 s, 28 calls | ✓ | ✓ |
| 23 units library | ✗ (a refused unit was half-added) | ✗ (lost the `fl. oz` spelling) | ✓ 58 s, 34 calls | ✓ | ✓ |
| **Total** | **0/3** | **2/3** | **3/3** | **3/3** | **3/3** |

**A real bug, found and fixed during the run.** In agent run 1, the notes API came back with
`ReferenceError: REDACTED is not defined`. Sara's secret scrubber (`src/redact.ts`), which hides
key-shaped values in everything a tool returns, also rewrote ordinary source lines such as
`const token = bearer(ctx.req.headers.authorization);` to `const token = [REDACTED];` when she read
the file, and the model then wrote `[REDACTED]` back into the code. Fixed in Phase 62: a value that
is a function call is code, not a secret, and is left alone (real secrets, `NAME=value` with a
plain value, bearer tokens and vault values are still scrubbed; tested). Run 1 used the old
scrubber; runs 2 and 3 the fixed one. A second run 2 that started at the same second as the fix was
stopped before its first task and thrown away, so no run mixes the two.

**What this says:** after the fix, her loop solved 5 of 6 project runs, and the one miss was a
detail the project's own tests don't check (a parse-only spelling dropped in the refactor). But the
plain model, given every file at once, solved all of them both times, and faster (2 to 3 minutes
per run against 3 to 11). These projects are still small enough (25,000 to 44,000 characters, roughly 7,000
to 13,000 tokens) to paste in one prompt, which this model (64k context on Ollama here) reads whole; the projects that would show what reading and
running code adds need to be several times bigger than this, which is the next step for this
benchmark. Three projects and one model: a sanity check of her loop on bigger code, not a
leaderboard. The summaries keep every run (`everyRun` in
[projects-agent](results/projects-agent.json)).

```sh
node scripts/bench-tasks.ts --tier projects --mode verify                         # no model
node scripts/bench-tasks.ts --tier projects --mode agent --model <ollama model>   # her agent loop
node scripts/bench-tasks.ts --tier projects --mode raw --model <ollama model>     # baseline
```

Only a local model was run. The subscription command-line agents (Claude Code, Grok Build) can't
be driven by this script yet; it talks to an OpenAI-compatible server.

## Claim check in six languages

`scripts/eval-claims.ts` scores the receipt check (does a reply claim an action no tool did?) on
hand-written replies in English, Spanish, French, German, Brazilian Portuguese and Italian
([`evals/claims-multilingual.json`](../evals/claims-multilingual.json)): 40 per language per set,
half of them real unbacked claims (saved, sent, ran, deleted, scheduled, emailed, pushed, set a
reminder…), half true negatives (negations, quoted examples, code blocks, questions, plans,
earlier work, ordinary life, and claims that a tool in the same turn does back).

- **dev set** (240 replies): written first; the Phase 62 patterns were written against it, so its
  scores are optimistic and are shown only for completeness.
- **held-out set** (240 replies): written after the patterns were frozen, phrased differently,
  never used to tune the patterns. **These are the numbers to read.**

Held-out set, precision / recall (2026-10-28, Windows 11, RTX 5090, Ollama):

| Language | Before (Phase 28 patterns) | Phase 62 patterns | + judge `qwen3.5:9b` (local) | + judge `gemma4:12b` (local) |
|---|---|---|---|---|
| English | 0.89 / 0.40 | 0.92 / 0.60 | 0.95 / 0.95 | 0.91 / 0.95 |
| Spanish | 0.80 / 0.20 | 0.86 / 0.30 | 0.94 / 0.85 | 0.86 / 0.90 |
| French | 0.75 / 0.15 | 0.86 / 0.30 | 0.90 / 0.85 | 0.90 / 0.85 |
| German | 1.00 / 0.10 | 1.00 / 0.35 | 0.94 / 0.85 | 1.00 / 0.90 |
| Portuguese (BR) | 1.00 / 0.20 | 1.00 / 0.35 | 1.00 / 0.85 | 0.95 / 0.90 |
| Italian | 0.75 / 0.15 | 0.88 / 0.35 | 0.95 / 0.90 | 0.95 / 0.90 |
| **All 240** | **0.86 / 0.20** | **0.92 / 0.38** | **0.95 / 0.88** | **0.92 / 0.90** |

On the dev set the Phase 28 patterns scored 0.98 / 0.48 and the Phase 62 patterns 1.00 / 1.00
(they were written against it); with either judge, recall stays 1.00 and precision is 1.00
(`qwen3.5:9b`) or 0.98 (`gemma4:12b`).

**What this says:** the patterns alone now catch about twice as many unbacked claims as before in
every language, but on replies phrased in ways nobody wrote a pattern for, they still miss most of
them (recall 0.38). The optional judge closes most of that gap: it was asked about 101 of the 240
held-out replies (the ones the patterns could not place), answered in a median of 0.13 s
(`qwen3.5:9b`, slowest 0.25 s; `gemma4:12b` 0.24 s, slowest 0.40 s), never hit its 8-second limit
and never errored. The false alarms that remain: four conditionals the patterns themselves flag
("if the tests pass on your machine, merge it", in four languages), plus, with `qwen3.5:9b`, "I read
your config.yaml" (French, German) and, with `gemma4:12b`, "last week I set up the job…" in four
languages and "I wrote you a poem" in three. So `qwen3.5:9b` is the better judge on this set.

**Honest notes on method:** I wrote both sets and the patterns; nobody else labelled them. Between
the first and the final judge run I changed two things after looking at held-out results: which
sentences count as "unsure" (also sentences about work things when no tool ran this turn) and the
judge's instructions (the first prompt made `qwen3.5:9b` answer "no" to plain claims like "I ran
npm install"). The prompt was then tuned only on 20 extra sentences that are in neither set. The
first held-out judge run scored 0.93 / 0.45; the table shows the final run. Judge models were
warmed up first (loading a model takes longer than the 8-second limit; in a chat server it stays
loaded). The judge is off by default and only ever adds a correction.

```sh
node scripts/eval-claims.ts                              # patterns only (no model needed)
node scripts/eval-claims.ts --judge qwen3.5:9b           # + the judge, on Ollama at 127.0.0.1:11434
node scripts/eval-claims.ts --receipts <old receipts.ts> # score another version of the patterns
```

## Memory across sessions

`scripts/eval-memory.ts` is Sara's golden set for the plain memory path (word search only, no
embeddings, no second model). Conversation A tells her a few things; a summary is written and
facts are checked against the owner's exact words; in a new conversation B she must recall them
and must **not** invent things that were never said (a sister, a car); then one fact is forgotten
and conversation C must no longer know it.

Latest run: **11 of 12** checks on the local model. The one miss was scored by wording, not
content: after "forget my dog" she answered *"his actual name has slipped my memory"*, a correct
answer that the eval's list of "I don't know" phrases didn't include yet (it does now). Earlier
runs that day found a real gap, fixed in 0.54: a forgotten fact could come back through the
"lately in your other conversations" note, which now leaves out conversations with forgotten
parts. The checks are phrase-based, so runs vary a little with the model's wording; read the
failing replies in your own run before trusting a score. The previous run with
`gemma4:31b-cloud` (2026-10-25) passed 12 of 12.

### Which note comes first (Phase 76, offline)

`node scripts/eval-memory.ts --rank` checks the ranking itself, with no model and no meaning
search (word search, standing notes and fading only: what every install has). 40 notes about the
example owner Alex (old and new, two pinned, promises, decisions, a reflection, a summary of
another conversation) and 20 messages, each with the one note that should come first.

Latest run (2026-10-30): **19/20 first** with "Fade like a person" (half-life 120 days) and
**19/20** with "Never fade"; 19/20 in the top 3 either way. The miss is the same in both: *"Is it
ok if I watch one more episode at midnight?"* should bring up the decision *"no screens after
11 pm on weeknights"*, but none of its words are in the message, so only meaning search
(embeddings) can find it; without it, the decision still comes to mind as a standing note,
fourth. The set caught three ranking problems before release, all fixed: pinned notes floored at
0.9 sat above every match (0/20 first), freshness outweighed relevance between two matches, and
old matched notes fell below standing promises.

The model run above, repeated after the ranking change (2026-10-30, same local model): **11 of 12**
again. The miss is wording only: asked about a sister never mentioned, she said *"I don't have a
sister in my notes for you … What's her name?"*, a right answer the phrase list doesn't count.

### Checking her plans against your decisions (Phase 77, offline)

`node scripts/eval-contradict.ts` checks the plan check itself, with no model: notes about the
example owner Alex are stored together, then planned tool calls are checked in a coding
conversation with *Stop on clear conflicts*. Each call has the expected outcome: **stop** (the
approval card), **flag** (she mentions it) or **none**. Stops are what matter most: a false stop
annoys and teaches people to click through, a missed one breaks trust (design risk 9).

| Set | Notes | Calls | Exactly right | Stops: precision / recall | Any signal (stop or flag): precision / recall |
|---|---|---|---|---|---|
| Development (the rules were tuned on it) | 17 (10 rules, 7 near misses that must not stop) | 35 | **35/35** | 1.00 / 1.00 (17 stops) | 1.00 / 1.00 |
| Held out (new phrasings, written after tuning, run once) | 9 | 12 | **11/12** | 1.00 / 1.00 (6 stops) | 1.00 / 0.88 |

Latest run 2026-10-30. The near misses include *"Alex doesn't mind pushing to the dev branch"*,
*"Alex pushes to main every Friday at work"*, a read of a file in a ruled-out folder, `pnpm
install` against *"pnpm, not npm"*, `git reset --soft` against *"never git reset --hard"*,
`git push --dry-run`, and `pnpm test && git push` against *"tests before every push"*: none
stops. The held-out miss: *"Don't deploy on Fridays"* against `./deploy.sh` stays quiet; a rule
about a day of the week is not a shape the code checks, and the fuzzy flag needs two shared words.
The set first caught three problems, all fixed: *"never deploy the billing service"* was read as a
rule about a program called `service`, a parsed-rule cache keyed by note id mixed up notes from two
databases, and *"doesn't mind pushing"* raised a fuzzy flag. A check takes 13 ms at most here and
the test suite holds it under 20 ms per tool call with 10,000 notes.

Live, with `qwen3.8:27b` on Ollama in a coding conversation: she was asked to push `main` to a
local remote; the card stopped it quoting *"Alex wants Sara to never push to main."* (plus the
tests rule under *Also*), *Do it anyway* pushed and was recorded on the reply and the note,
*Update the note* opened the note and nothing ran, and in everyday chat the same push only got the
two flags and her usual approval card. One finding from that run is fixed in this phase: the
background note writer read a one-time *Do it anyway* as the rule changing and retired the
decision; overridden decisions are now never retired by that path.

### Run snapshots: cost of recording (Phase 78)

Every step of a turn, job and team task is recorded (`src/runs.ts`). The budget from the design:
under 5 ms a step and under 2% of a turn. Measured on the dev PC (Windows 11, Node 24, SQLite in
WAL mode with its default full sync, so each write waits for the disk):

| Measure | Result | How |
|---|---|---|
| Recorder time per step (prompt scrub, hash, one INSERT per step, JSON) | **1.4 ms** (12-step turn, 40 notes, 3 kB tool outputs) | `test/phase78.test.ts` "performance" (the test fails above 5 ms) |
| Before batching to one write per step | 2.9 ms | same test, first version (two commits a step) |
| Share of a real turn on `qwen3.5:9b` (Ollama, local) | **about 0.1%** (9 steps × 1.4 ms in a 13.3 s turn) | live run below |
| Share of a turn against a fake model that answers instantly | 10% (14 ms of 170 ms) | same test; only meaningful as an upper bound |

Most of the 1.4 ms is the one SQLite commit per step (about 1 ms on this disk); a prompt that
doesn't change between steps is not hashed or scrubbed again, and the coding-mode `git status`
runs in the background after the step is written.

**Database growth**, live (throwaway server, `qwen3.5:9b` and `gemma4:12b` on Ollama, a coding
conversation in a git workspace):

| Turn | Steps | Recorded | Of which: the system prompt (deflated, once per distinct text) |
|---|---|---|---|
| Read 2 files, 2 failed edits, wrote 2 files (typical small coding turn) | 9 | **12.4 kB** | 5.2 kB (11,406 characters) |
| One approved shell command | 2 | 6.4 kB | 5.2 kB (a new prompt: a minute later) |
| Read a file, answered | 2 | **1.5 kB** | 0 (same prompt as the turn before) |

So about **0.6–0.8 kB per step plus about 5 kB per new prompt** (prompts repeat within a turn and
often between turns); a busy day of 200 coding turns adds roughly 2–3 MB. History is never
copied (a message-id range); tool outputs are kept shortened to 4,000 characters. Retention (90
days by default) and the 200 MB cap keep it bounded; Settings → Data & health → Health shows
*Runs: N, X MB*.

## Library (documents)

`scripts/eval-library.ts` gives her a lease (a real PDF printed by Edge), house notes (Markdown)
and a recipe (a web page), lets her read and learn from them, and asks 8 questions in new
conversations. A question passes when the answer is right **and** says where it came from; one
trap question ("does my lease say anything about the pool?") passes only when she says the
documents don't say. Pass mark, set before the first run: at least 7 of 8 in every run, and at
least 3 notes learned from the lease, each with words that really are in it.

Latest runs: **8 of 8 in both runs** on the local model, with word search only and with meaning
search added (`--embed nomic-embed-text`). Earlier the same day `gemma4:31b-cloud` (through
Ollama's cloud) also scored 8 of 8 in each of its runs.

## Big documents (Phase 74)

What happens when she is given a 1,000-page book. Everything below was measured on 2026-10-29 on
the development PC (AMD Ryzen 9 9950X, 64 GB, RTX 5090 32 GB, Windows 11, Node 24.20), with
`gemma4:12b` (Ollama, on this PC) as her chat, background and picture model and
`nomic-embed-text` for meaning search. Each run is a fresh throwaway server (ports 7880-7899)
reading a book written by `scripts/make-big-pdf.ts`: 1,000 pages, 20 chapters with bookmarks,
100 sections, varied maintenance text, and 32 facts on known pages ("The calibration constant for
unit 7 is 4.183", page 16 of 1,000; a few are only on scanned pages). Raw numbers:
`outputs/p74-bench/*.json` (not in git); rerun with `node scripts/bench-big-doc.ts --label NAME …`.

### Reading the book

| Run | File | Text | Scanned pages | Contents + summaries | Key points | Vectors | Total | Peak memory |
|---|---|---|---|---|---|---|---|---|
| Text book, everything on (`text1000b`) | 0.9 MB | 32 s | none | 40 s (120 entries, 20 chapter summaries + the whole) | 239 s, 106 key points | 27 s (1,414 passages) | **5 min 43 s** | **152 MB** |
| 50 scanned pages (`scan1000`, key points off) | 1.5 MB | 32 s | **143 s for 50 pages** (2.9 s a page), all 50 read | 48 s | off | 37 s | 4 min 30 s | 200 MB |
| 951 MB file (`big1gb`: the same book plus 950 MB of images it never needs) | 951 MB | 30 s | none | 3 s (stopped when searchable) | off | not run | 41 s to searchable | **162 MB** |
| "Small server" (`small1000`: reader thread limited to 256 MB, Gentle speed) | 0.9 MB | 135 s | none | stopped when searchable | off | not run | 2 min 53 s to searchable | 156 MB |

- **Memory stays flat whatever the file size**: 152 MB for a 0.9 MB book, 162 MB for a 951 MB
  one (the whole server process, reader thread included, sampled every 2 s from Windows' task
  list). The reader reads the cross-reference table from the end, then each object at its offset;
  the 950 MB of images are never read. Uploading the 951 MB file in 8 MB pieces took 3.0 s
  (318 MB/s, same machine).
- **Every scanned page is read**: 50 of 50 (the old limit was 40), 2.9 s a page with a 12 B
  model on this GPU, so about 50 minutes for 1,000 scanned pages. A cloud picture model asks
  first, with this kind of estimate and a price.
- **Key points scale**: 106 for the 1,000-page book (the old cap was 30), from windows spread over
  the whole text; it is the slowest phase (4 minutes here) because each window is a model call.
- **Pause, restart, resume:** tested in `test/phase74.test.ts` (a restart mid-book goes on from the
  same page with no page stored twice; pause during key points goes on from the next window). On
  the real model a pause in the key-points phase and a resume gave the same 53 key points as an
  uninterrupted run of the 300-page book.
- **"Small server" honestly:** no small server was used. This is this PC with the reader thread
  limited to 256 MB (`SARA_LIBRARY_MEMORY_MB=256`) and the Gentle speed: the text took 4× longer
  (short slices of work with pauses for chat) and memory did not change. A real small server
  (2-4 cores, 2-4 GB, no GPU) is still to be measured; there, scanned pages and key points depend
  on where the model runs.

### Is chat still quick while she reads?

Time to her first word for "Say hi in three words." in a new conversation, every 30-45 s during
the reading (same model as the reading, on the same GPU):

| | Idle (before) | While reading text | While reading scanned pages | While writing summaries | While learning key points | While making vectors |
|---|---|---|---|---|---|---|
| `text1000b` | 4.1-8.1 s | 4.8 s | | 4.0-5.5 s | 10.7-16.6 s (median 12.4, 7 samples) | 11.3 s |
| `scan1000` | 5.1-6.2 s | 8.1 s | 4.1-5.8 s | 12.3 s | | 15.0 s |
| `small1000` (Gentle) | 4.0-5.8 s | 2.2-6.6 s (median 4.1, 8 samples) | | | | |

- Reading text and scanned pages leaves chat as quick as when idle: the reader is a separate
  thread, and a background model call **steps aside** when a chat starts (it is stopped, and tried
  again after the chat; measured with the model directly: a chat behind a running background call
  waited 9.6 s, after stepping aside 0.5 s).
- Chats during the key-points phase were slower (median 12 s). A probe that paused the reading
  and chatted at once (`pauseprobe`) was just as slow paused (7.4-16.8 s) as running (4.2-7.6 s
  just before), so this is not the job's queue: the first words of a new conversation include her
  whole prompt (now with up to 100+ new memory notes from the book) and the model's own load on the
  GPU. Not solved in this phase; noted for later.
- The rest of the app stays responsive: the library's own API answered in a median 18 ms (max
  120 ms) while reading, the same as idle (2-16 ms).

### Search at scale

`node scripts/bench-big-doc.ts --search-scale N` fills a library with N passages (180 random words
each, 768-dimension vectors) and times a search over all of them, in-process:

| Passages | Meaning search (int8, all of them, then the best 48 exactly) | Word search (FTS5) | Memory for the vectors | Index load at start |
|---|---|---|---|---|
| 100,000 | **44 ms** median (70 ms max) | 0.15 ms, right page | 78 MB | 1.2 s |
| 300,000 | **131 ms** median (205 ms max) | 0.13 ms, right page | 234 MB | 3.7 s |

Brute force grows in a straight line with the number of passages; at a million it would be about
0.45 s and 780 MB, the point where a coarse partition (IVF) would be worth adding. A 1,000-page
book is about 1,400 passages, so 100,000 passages is about 70 such books.

### Answering from the book: 30 questions

Each question in a new conversation ("In the Harbor wind farm manual: <question> Which page says
so?"); right means the answer has the fact, right page means she names the page it is on:

| Run | Right answer | Right page | Page link in the answer |
|---|---|---|---|
| `text1000b` (final code: key points cite their page) | **30 / 30** | **30 / 30** | 30 / 30 |
| `scan1000` (50 scanned pages, no key points; 5 questions are about scanned pages) | **29 / 30** | **29 / 30** (5 / 5 on scanned pages) | 27 / 30 |
| `text1000` (before key points carried pages) | 29 / 30 | 25 / 30 | 25 / 30 |

The first full run (`text1000`) missed five pages: the answer came from a key point in her memory
that named the document but not the page, and she guessed one. Key points now carry their page
and link (`[p. 412](/#view=library:1:412)`), which gave 30 / 30. The one miss in `scan1000` (page 735,
"Which company inspects the foundation for corrosion?") was answered "the manual doesn't say",
pointing at other pages about corrosion: word and meaning search didn't bring page 735 up for
that wording (key points were off in that run). Median time per answer:
12 s (text), 19 s (scanned book). Small models sometimes write the link without its slash or
inside emphasis (`(_#view=library:1:16_)`); the chat now shows those as links too.

Screenshots of the reading progress, the document page with its contents and summaries, and an
answer with page links: `outputs/p74-shots/` (desktop and phone width; not in git).

## Code map

`scripts/eval-codemap.ts` copies Sara's own code into a workspace and asks 8 "where is…?"
questions (which file checks the owner token, what calls the disclosure text…), once with only the
plain file tools and once with the code-map tools added. Both scored **8 of 8** in the full run; a
second run of the "with" half the same day scored 7 of 8. With a capable model, plain search
already answers these questions, so the code tools show up as a different way of getting there,
not a higher score; harder multi-step questions are needed to measure the difference.

## The everyday test suite

`npm run check` runs the TypeScript typecheck and every automated test (Node's built-in test
runner with a scripted fake model: no network, no GPU). Last full run (2026-10-28, Windows 11,
Node 24.20): 639 tests, 632 passed, 0 failed, 7 skipped (the Linux-only sandbox tests, which run on
a Linux server).

## Publishing new results

After re-running any of the scripts above:

```sh
node scripts/publish-results.ts   # writes docs/results/*.json and prints the table for this page
```

Keep the table honest: update the date and model with the score, say what changed, and never drop
a worse run to keep a better number.
