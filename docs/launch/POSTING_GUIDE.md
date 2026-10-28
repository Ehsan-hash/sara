# Posting guide (owner): what to post, where, and in what order

Written 2026-10-28 for Sara 1.4.0. Post **one place per day or two**, from your own account, and
stay around for an hour or two afterwards to answer comments. Every subreddit wants the author to
say it's their own project; each post below does that in the first line.

These texts were drafted by an AI assistant for you to post. Read each one and change anything that
doesn't sound like you. Where a community asks how AI was involved, the honest answer is in
"If asked about AI" at the end.

## Order

| # | Where | When | Notes |
|---|---|---|---|
| 1 | r/LocalLLaMA | first (weekday, US morning) | the technical audience; numbers matter |
| 2 | r/homeassistant | 2–3 days later | after HACS has approved, or say "custom repository" (as written) |
| 3 | Home Assistant forum | same day as #2 | category "Share your Projects!" |
| 4 | r/selfhosted megathread | the next Friday | as a **comment** in that week's "New Project Megathread", not a post, until 2027-01-24 |
| 5 | Show HN | when you have 2–3 free hours | you must **write it yourself**: HN asks that Show HN text is not written or polished by an AI. Facts and structure: SHOW_HN.md |

## How to post on Reddit (each subreddit)

1. Open the subreddit and read its rules in the sidebar (they change; check self-promotion and flair).
2. If your account hasn't commented there before, leave a few genuinely helpful comments on other
   posts first: some subreddits hold posts from accounts with no history there.
3. **Create post → Text.** Paste the title, then the body (switch the editor to **Markdown mode**
   first so the table and links work: the "T" or "Aa" button → Markdown).
4. Pick the flair named below. Add the screenshot(s) listed as a second "Images" post only if the
   subreddit prefers images; otherwise link them.
5. After posting, check that it shows up when logged out (open it in a private window). If it's
   held by a bot or the moderators, reply to the bot's message or message the moderators politely.

---

## 1. r/LocalLLaMA

**Flair:** "Resources" (or the closest: "Other").

**Title:**

```
Sara: open-source companion + coding agent built for local models (MIT), with honest benchmarks
```

**Body:**

```markdown
Disclosure: I'm the author. Sara is MIT licensed and free; there's nothing to buy.

**What it is:** a self-hosted AI companion (a personality you set, a memory you can see and edit) who is also a coding agent: a workspace per project with files, shell and git, background jobs, and a live preview she tests in a headless browser. TypeScript on Node 24, zero runtime dependencies. Repo: https://github.com/farena-ai/sara · demo: https://demo.sara.backstagecoding.com

**Local models:** any OpenAI-compatible server (Ollama, vLLM, llama.cpp). Each job can have its own model (a small fast one for memory notes, a bigger one for coding), and `nomic-embed-text` handles document search. Everything below ran on `qwen3.8:27b-mtp-q4_K_M` in Ollama on one RTX 5090.

**Numbers** (scripts in the repo; method and per-item results in docs/RESULTS.md):

| | her agent loop | same model, one reply, no tools |
|---|---|---|
| 14 small multi-file repo tasks (hidden tests) | 11/14 | 12/14 |
| 3 bigger projects (22–36 files, hidden tests) | 2/3, then 3/3 | 3/3 |
| HumanEval (164) | 158/164 | 161/164 |

So, honestly: her tools don't beat the plain model on these yet. The tasks still fit in one prompt, which is exactly where pasting everything in wins. The bigger-project run did catch a real bug in Sara (her secret scrubber hid lines like `const token = bearer(req)`, and the model wrote "[REDACTED]" back into the file), which is fixed. Next is projects that are too big to paste.

**A local model as a fact-checker:** she checks her own claims ("I saved the file", "I sent it") against what her tools actually did, in six languages. On 240 held-out replies, the built-in check catches 38% of false claims; with `qwen3.5:9b` running locally as a judge it catches 88% at 95% precision, in about 130 ms per call.

**Honest limits:** live voice calls use Grok or OpenAI realtime (cloud); local speech runs on a Linux server. Windows has no command sandbox, so every command there asks first. Ollama sends tool calls whole, so the new "watch her write the file" cards only build up live with APIs that stream tool arguments.

Install: one-line Linux installer, Docker (amd64 + arm64), Windows and macOS installers, Homebrew, TrueNAS, Proxmox. Happy to answer questions about tool calling with local models, context sizes, or the benchmark setup.
```

---

## 2. r/homeassistant

**Flair:** the one for projects or custom integrations ("Personal Setup" / "Custom Integration"; check
the list).

**Screenshots to attach:** the integration's setup screen with the sign-in code, Assist talking to
Sara, and the device page. (Ask me to make them if you want them taken from a test Home Assistant.)

**Title:**

```
I made a custom integration that adds my self-hosted AI companion, Sara, as an Assist conversation agent
```

**Body:**

```markdown
Disclosure: I'm the author; it's MIT and free.

Sara is a self-hosted AI companion (https://github.com/farena-ai/sara). The **Sara integration** (HACS → ⋮ → Custom repositories → `https://github.com/farena-ai/sara-home-assistant`, type Integration) connects her to Home Assistant both ways:

**Home Assistant → Sara**
- A **conversation agent** for Assist and voice satellites ("talk to Sara").
- `sara.send_message`: ask her something from an automation; her reply comes back as the action response.
- `notify.sara_note`: send her a note ("the front door opened"); she answers in her own time.
- A **last reply** sensor.

**Sara → Home Assistant**
- With a long-lived token she can read states and, **with your OK each time**, switch lights, locks, covers, climate, scenes and scripts. Entity names are treated as data, never as instructions.

**Local or cloud:** Sara runs on your own server and can use a local model (Ollama, vLLM, llama.cpp), so conversations stay on your network; cloud models work too if you choose them. Sign-in uses a code you approve in Sara, with its own limited access.

The integration passes HACS's and Home Assistant's own validation (hassfest), and the server also comes as a Docker image for amd64 and arm64 (Raspberry Pi 4/5). One limitation: when she wants approval for an action during an Assist conversation, Home Assistant can't approve it for you, so she says what she wanted to do and you approve it in the Sara app.

Docs: https://github.com/farena-ai/sara/blob/main/docs/HOME_ASSISTANT.md

Coming next: Alexa and Google Home. Feedback from people running voice satellites is especially welcome.
```

---

## 3. Home Assistant community forum

Go to https://community.home-assistant.io → sign in → **+ New Topic** → category **Share your
Projects!** Use the r/homeassistant title and body above (the forum uses Markdown too). Add the tags
`custom-integration` and `conversation` if offered.

---

## 4. r/selfhosted (New Project Megathread)

Until **2027-01-24**, posts about projects younger than three months are removed; share it as a
**top-level comment** in the current week's "New Project Megathread" (pinned; a new one each Friday).
Their bot may ask how AI was involved: answer with the text at the end of this guide.

```markdown
**Sara: a self-hosted AI companion that's also a coding partner** (MIT, Node 24, zero runtime dependencies)

GitHub: https://github.com/farena-ai/sara · Demo: https://demo.sara.backstagecoding.com

Disclosure: I'm the author; it's free.

- Runs on your own server or PC; bring any model: local (Ollama, vLLM, llama.cpp) or your own API keys or subscriptions.
- Chat with memory you can see and edit, a planner and Today view, documents, voice, phone apps, Telegram/Discord, Home Assistant, an OpenAI-compatible API and an MCP server.
- A coding workspace with shell, git, previews and background jobs; risky actions wait for your OK.
- Install: Docker (amd64 + arm64), one-line Linux installer, Windows/macOS installers, Homebrew, TrueNAS, Proxmox and Unraid; CasaOS and Umbrel listings are in review. New servers are set up in the browser with a short code from the log.
- In six languages (English, Spanish, French, German, Portuguese, Italian). No telemetry.
```

---

## 5. Show HN

Write it yourself (HN's rule). Everything you need is in SHOW_HN.md; update its numbers from the
r/LocalLLaMA table above and the test count (658 automated tests).

---

## If asked about AI (r/selfhosted's bot, comments anywhere)

Say it in your own words; the facts are:

> I designed Sara and directed the work; most of the code was written by AI coding agents working
> from my roadmap, and every change goes through an automated test suite (658 tests) and my review
> before release. The safety rules (AI disclosure, crisis resources, the block on sexual content
> involving minors) are written in code and tested, not left to the model.

(Adjust "my review" to match how you actually reviewed it.)

## After posting

- Answer questions with specifics. Don't argue; thank people for bug reports and open an issue for
  each one (or tell me and I'll do it).
- Don't post the same text in other subreddits the same day.
- Tell me which posts went up, and I'll watch GitHub for the new issues and pull requests they bring.
