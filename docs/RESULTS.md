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
| Memory across sessions (recall, no inventing, forgetting) | qwen3.8 27B (local) | **11/12** checks | 2026-10-27 | `node scripts/eval-memory.ts --model <model>` |
| Library: answers from documents, with the source | qwen3.8 27B (local) | **8/8** in both runs | 2026-10-27 | `node scripts/eval-library.ts --model <model>` |
| Library with meaning search | qwen3.8 27B (local) + nomic-embed-text | **8/8** in both runs | 2026-10-27 | `node scripts/eval-library.ts --model <model> --embed nomic-embed-text` |
| Code map: "where is…?" questions on Sara's own code | qwen3.8 27B (local) + nomic-embed-text | **8/8** with code tools, **8/8** without | 2026-10-27 | `node scripts/eval-codemap.ts --embed nomic-embed-text` |

Full model name: `qwen3.8:27b-mtp-q4_K_M` on Ollama. Summaries: [humaneval-agent](results/humaneval-agent.json),
[humaneval-raw](results/humaneval-raw.json), [tasks-agent](results/tasks-agent.json),
[tasks-raw](results/tasks-raw.json), [memory](results/memory.json),
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
rule, or that need running a program to understand it) are the next step.

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

## Code map

`scripts/eval-codemap.ts` copies Sara's own code into a workspace and asks 8 "where is…?"
questions (which file checks the owner token, what calls the disclosure text…), once with only the
plain file tools and once with the code-map tools added. Both scored **8 of 8** in the full run; a
second run of the "with" half the same day scored 7 of 8. With a capable model, plain search
already answers these questions, so the code tools show up as a different way of getting there,
not a higher score; harder multi-step questions are needed to measure the difference.

## The everyday test suite

`npm run check` runs the TypeScript typecheck and every automated test (Node's built-in test
runner with a scripted fake model: no network, no GPU). Last full run (2026-10-27, Windows 11,
Node 24.20): 493 tests, 486 passed, 0 failed, 7 skipped (the Linux-only sandbox tests, which run on
a Linux server).

## Publishing new results

After re-running any of the scripts above:

```sh
node scripts/publish-results.ts   # writes docs/results/*.json and prints the table for this page
```

Keep the table honest: update the date and model with the score, say what changed, and never drop
a worse run to keep a better number.
