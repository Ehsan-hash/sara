# r/selfhosted: post draft

## The rules that matter here (checked 2026-10-27)

Reddit blocks automated reading of the rules page from this computer, so these come from the
moderators' own announcement posts and from removal notices quoted on Reddit. **Open
<https://www.reddit.com/r/selfhosted/about/rules> and the newest pinned posts before posting**;
the rules there change often.

- **Rule 6, new projects:** projects **younger than three months** (counted from their first
  public presence, such as the first git commit or a social media post) may only be shared in the
  current **"New Project Megathread"** (a new one each Friday), as a top-level comment. Sara's
  first commit is dated 2026-10-24, so until at least **2027-01-24** she goes in the megathread,
  not as her own post. A separate post before then will be removed.
- **AI involvement:** the subreddit's bot removes most new posts until the poster replies to it
  saying how AI was involved (even "not at all"). Answer honestly and specifically.
- Posts must be about self-hosting; mobile apps only as companions to a self-hosted backend (Sara
  fits); no affiliate links or hosting ads; content in English.

## Megathread comment (use now, while Sara is under three months old)

> **Sara: a self-hosted AI companion that's also a coding partner (MIT, Node, zero runtime
> dependencies)**
>
> GitHub: https://github.com/farena-ai/sara · Demo: https://demo.sara.backstagecoding.com
>
> Sara runs on your own Linux server (one-line installer or Docker), or on Windows/macOS with a
> desktop installer. One owner per server; chats, memories and keys stay in one folder there,
> with daily backups and one-command restore.
>
> - Use local models (Ollama, vLLM, llama.cpp) or cloud ones; it ships with no credentials.
> - A companion with a personality you set and a memory you can see, correct and delete.
> - A coding workspace with files, shell and git; she asks before risky commands and tests web
>   apps in a headless browser.
> - Planner and reminders, documents (PDF/Word/…) she answers from with sources, phone apps,
>   Telegram/Discord, Home Assistant both ways, an OpenAI-compatible API and an MCP server.
> - A safety layer that can't be switched off (AI disclosure, crisis resources, approvals).
>
> Results I ran myself, with scripts in the repo (qwen3.8 27B on one RTX 5090): 14 small
> multi-file coding tasks with hidden tests, 11/14 with her tools vs 12/14 for the same model
> with every file pasted in and no tools; HumanEval 158/164 vs 161/164. So the tools don't add
> points on these small sets yet; details and caveats in docs/RESULTS.md.
>
> Known limits: Windows has no command sandbox (every command asks first); live voice calls use
> Grok/OpenAI realtime (cloud); single-owner, not multi-user.
>
> AI involvement: [write this yourself, truthfully: which AI tools helped write the code and
> docs, and how you reviewed and tested their work].
>
> Feedback on the installer and the docs is very welcome.

## Full post (only after the three-month mark, i.e. 2027-01-24 or later)

**Title:** `Sara: self-hosted AI companion and coding partner (MIT, local models, zero dependencies)`

**Flair:** the one for a project release (check the current list).

**Body:** the megathread text above, plus:

- **Install:** the one-line installer, `docker compose up -d`, the Windows/macOS installers, and
  what it needs ([REQUIREMENTS.md](../REQUIREMENTS.md)): CPU-only works with cloud models; local
  models need a GPU (see [CHOOSING_A_MODEL.md](../CHOOSING_A_MODEL.md)).
- **What leaves your server:** link [PRIVACY.md](../PRIVACY.md) (every outgoing connection and
  how to turn it off).
- **Reverse proxy / remote access:** Tailscale, your own domain with HTTPS, or LAN only
  ([INSTALL.md](../INSTALL.md)).
- Screenshots: the README images (companion, coding preview, planner).

## Don'ts

- No "game-changer", "revolutionary", "best"; no star or upvote requests.
- Don't post the same text in several subreddits on the same day.
- Answer questions in the thread; don't argue about AI use, just state what you did.
