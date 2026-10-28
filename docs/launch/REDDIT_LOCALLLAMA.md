# r/LocalLLaMA: post draft

## The rules that matter here (checked 2026-10-27)

From the subreddit's published rules as quoted by several rule trackers (Reddit blocks reading the
rules page from this computer, so **open <https://www.reddit.com/r/LocalLLaMA/about/rules>
before posting**):

- Posts must be about LLMs (local models especially).
- **Rule 4, limit self-promotion:** roughly the 1/10 guideline (self-promotion at most a tenth of
  what you post and comment there); **disclose that it's your project**; no sensational titles,
  no affiliate links, no "I found this…".
- Trackers also report a small karma minimum earned inside the subreddit before posting; comment
  helpfully there first if your account is new to it.

This audience cares about: which models, what hardware, real numbers with method, how the model
is called (tool calling, context length), and whether it really works offline. Lead with that.

## Post

**Title:** `Sara: open-source companion + coding agent for local models; my own benchmark says her tools don't beat a plain 27B yet`

(Or plainer: `Sara: open-source companion and coding agent built for local models (MIT), with a small multi-file benchmark`.)

**Flair:** the closest available (for example "Resources" or "Other"; check the list).

**Body:**

> Disclosure: I'm the author. Sara is MIT licensed and free; nothing to buy.
>
> **What it is:** a self-hosted AI companion (personality you set, memory you can inspect and
> delete) who is also a coding agent with a workspace, shell, git, background jobs and a live
> preview she tests in a headless browser. TypeScript on Node 24, zero runtime dependencies.
> Repo: https://github.com/farena-ai/sara
>
> **Local models:** any OpenAI-compatible server (Ollama, vLLM, llama.cpp server). Everything
> below ran on `qwen3.8:27b-mtp-q4_K_M` (27.3B, Q4_K_M) in Ollama on one RTX 5090 (32 GB). You
> can give each job its own model (a small fast one for memory summaries, a bigger one for
> coding) and use embeddings (`nomic-embed-text`) for document search.
>
> **Numbers** (scripts in the repo, one run each, details in docs/RESULTS.md):
>
> | | with her agent loop | same model, one reply, no tools |
> |---|---|---|
> | 14 original multi-file repo tasks (bug fixes across modules, features from a README/SPEC, refactors; JS and Python; hidden tests) | **11/14** (both runs) | **12/14** (both runs) |
> | HumanEval (164, hidden tests) | 158/164 | 161/164 |
>
> So, honestly: the agent loop doesn't beat the plain model on either set yet. HumanEval
> problems are short and very likely in the model's training data. My repo tasks are small
> (5 to 7 files each), so the whole project fits in one prompt, and the misses in both modes were
> rules written only in a README/SPEC that no test checked; running the tests can't catch those.
> Same model, same hidden tests in both modes; the "no tools" mode gets every file in one prompt
> and must answer with whole files. Next I want tasks too big to paste, where tools should
> matter; ideas welcome.
>
> Other evals on the same model: memory across sessions 11/12 checks, answering from documents
> with sources 8/8, questions about her own code 8/8.
>
> **Honest limits:** live voice calls use Grok or OpenAI realtime (cloud); local text-to-speech
> and speech-to-text run on a Linux server. Windows has no command sandbox, so every command
> needs approval there.
>
> Happy to answer questions about tool calling with local models, context sizes, or the
> benchmark setup. Re-run it with `node scripts/bench-tasks.ts --mode agent --model <yours>` and
> `--mode raw`.

## Don'ts

- Don't post it in other AI subreddits the same day with the same text.
- Don't claim it beats anything you didn't measure; don't compare to other agents' numbers run
  under different setups.
- Reply to technical questions with specifics (model, quantization, context length, settings).
