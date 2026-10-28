# Awesome-list submissions

Exact entries and pull-request text for the lists where Sara fits, with each list's inclusion
rules as read on 2026-10-27. Submit **one list at a time, by hand, from your own account**, and
only after the repository is public. Several lists say outright that self-promotion is checked
or that submissions must come from a person, not a bot or an LLM: write the PR text yourself
(the drafts below are starting points) and say that you're the author.

| List | Does Sara qualify now? | When |
|---|---|---|
| [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | **No, not yet**: the first *release* must be more than 4 months old | 4 months after the 1.0 GitHub release |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Yes (public repo with an installable MCP server) | At release |
| [awesome-local-llm](https://github.com/rafska/awesome-local-llm) | Yes (no age rule stated) | At release |
| [awesome-local-ai](https://github.com/janhq/awesome-local-ai) | Yes (no age rule stated; list updated rarely) | At release |
| [awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion) | Probably; read its `contributing.md` first | At release |
| [awesome-home-assistant](https://github.com/frenck/awesome-home-assistant) | **No, not yet**: the repository must be at least 6 months old; self-promotion is flagged | 6 months after the HACS repository is created |

## awesome-selfhosted

**Rules** ([CONTRIBUTING.md](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md),
[addition template](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/.github/ISSUE_TEMPLATE/addition.md)):
first release more than **4 months** old (counted from a tagged release, not from the first
commit), actively maintained, working install instructions, an open-source license, one item per
PR, submitted by a human (the template has a checkbox for "not a machine/LLM"). Description
shorter than 250 characters, sentence case. The site lists the software under the **first** tag.

**Sara doesn't qualify until four months after her first public release** (the 1.0 GitHub
release). Put a reminder in your calendar for that date.

**File to add:** `software/sara.yml`

```yaml
name: "Sara"
website_url: "https://sara.backstagecoding.com"
source_code_url: "https://github.com/farena-ai/sara"
description: "AI companion with a personality you choose and a memory you can edit, who can also write, run and test code in a workspace. Planner, documents, voice, phone apps. Works with local or cloud models."
licenses:
  - MIT
platforms:
  - Nodejs
  - Docker
tags:
  - Generative Artificial Intelligence (GenAI)
depends_3rdparty: false
demo_url: "https://demo.sara.backstagecoding.com"
```

(`depends_3rdparty: false` because she runs fully on local models; cloud models are optional.
Check the description is still under 250 characters after any edit.)

**PR title:** `add Sara`

**PR text (draft; rewrite in your words):**

> Adds Sara, a self-hosted AI companion that is also a coding assistant (MIT, Node.js, Docker).
> First release: <date of the 1.0 release> (more than 4 months ago). Install instructions:
> https://github.com/farena-ai/sara/blob/main/docs/INSTALL.md. Works fully offline with local
> models (Ollama, vLLM, llama.cpp), so `depends_3rdparty` is false.
>
> - [x] one item
> - [x] submitted by a human (I'm the author)
> - [x] searched existing issues and PRs
> - [x] actively maintained, first released more than 4 months ago, working install instructions

## awesome-mcp-servers

**Rules** ([CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md)):
servers with a public GitHub repository that you install and run yourself (remote-only servers go
to awesome-remote-mcp-servers); one server per line; follow the existing format; keep the
category's alphabetical order where it is kept; a short description of what the server does.
Legend used in entries: 📇 TypeScript/JavaScript, 🏠 local service, 🍎 macOS, 🪟 Windows, 🐧 Linux.

**Section:** `🧠 Knowledge & Memory`.

**Line to add:**

```markdown
- [farena-ai/sara](https://github.com/farena-ai/sara) 📇 🏠 🍎 🪟 🐧 - Self-hosted AI companion whose `/mcp` endpoint lets Claude Code, Cursor and other MCP clients search her long-term memory, document library and notes, read today's plan and tasks, and ask her questions. Read-only unless you allow changes, which then need your approval.
```

**PR title:** `Add Sara (self-hosted companion with memory and library over MCP)`

**PR text (draft):**

> Adds Sara under Knowledge & Memory. Sara is a self-hosted AI companion (MIT, TypeScript, runs
> on Linux, macOS and Windows). Her MCP server (`https://<your server>/mcp`, plus a small stdio
> bridge for clients that only speak stdio) exposes her memory, library and notes search, today's
> plan and tasks, and an "ask Sara" tool. Setup:
> https://github.com/farena-ai/sara/blob/main/docs/OTHER_APPS.md. I'm the author.

## awesome-local-llm (rafska)

**Rules** ([CONTRIBUTING.md](https://github.com/rafska/awesome-local-llm/blob/main/CONTRIBUTING.md)):
fork, edit README.md, open a PR describing the addition. Entries in **User Interfaces** carry a
stars badge in front.

**Section:** `User Interfaces` (or `Coding Agents` if the maintainers prefer; ask in the PR).

**Line to add:**

```markdown
- <img src="https://img.shields.io/github/stars/farena-ai/sara?style=social" height="17" align="texttop"/> [Sara](https://github.com/farena-ai/sara) - self-hosted AI companion and coding agent for local models (Ollama, vLLM, llama.cpp), with editable memory, documents, voice and phone apps
```

**PR text (draft):**

> Adds Sara, a self-hosted companion and coding agent built for local models (any
> OpenAI-compatible server: Ollama, vLLM, llama.cpp). MIT, zero runtime dependencies. Its
> published benchmarks were run on a local 27B model:
> https://github.com/farena-ai/sara/blob/main/docs/RESULTS.md. I'm the author.

## awesome-local-ai (janhq)

**Rules:** "Your contributions are always welcome!"; no written criteria. The list hasn't been
updated often, so a PR may wait.

**Section:** `User Tools`.

**Line to add:**

```markdown
- [Sara](https://github.com/farena-ai/sara) - Self-hosted AI companion and coding partner that runs on local models, with memory you can edit, documents, voice and phone apps.
```

**PR text:** as for awesome-local-llm.

## awesome-ai-companion (DasterProkio)

**Rules:** see its [contributing.md](https://github.com/DasterProkio/awesome-ai-companion/blob/main/contributing.md)
(read it before submitting; entries end with language, platform and a status tag).

**Section:** `Companion Clients & Workspaces`.

**Line to add:**

```markdown
- [Sara](https://github.com/farena-ai/sara) - Self-hosted companion with a personality you set, editable long-term memory, proactive messages, a planner, documents, live voice calls and a sandboxed coding workspace; web, Android, iPhone, desktop, Telegram and Discord. MIT. `TypeScript` · `Cross-platform` · `ready`.
```

## awesome-home-assistant (frenck)

**Rules** ([CONTRIBUTING.md](https://github.com/frenck/awesome-home-assistant/blob/main/.github/CONTRIBUTING.md)):
the repository must be at least **6 months old**, pushed to within 18 months, have a README and
an OSI license; custom integrations must ship a valid `hacs.json` and
`custom_components/<domain>/manifest.json`; fewer than 10 stars triggers a warning; PRs from the
project's owner are flagged as self-promotion and need a reason in the PR text; the description
must not start with the name or mention "Home Assistant", and ends with a period; add it as the
last item in its category; one link per PR.

**Sara doesn't qualify yet:** `farena-ai/hacs-sara` (the HACS repository) must be 6 months old
first. Ideally someone other than you suggests it once people use it.

**Section:** `Custom Integrations`.

**Line to add (then):**

```markdown
- [Sara](https://github.com/farena-ai/hacs-sara) - Self-hosted AI companion as an Assist conversation agent, with a send-message action, notes and a last-reply sensor.
```

**PR text (draft):**

> Adds the Sara integration (HACS-installable custom integration, MIT). It makes a self-hosted
> Sara server an Assist conversation agent and adds `sara.send_message`, `notify.sara_note` and a
> last-reply sensor. I'm the author, so this is flagged as self-promotion: it's included because
> <reason, e.g. number of users, issues answered, how long it's been maintained>.
