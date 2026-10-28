# What it costs

Sara herself is free (MIT license). What can cost money is the model she uses, a few optional
services, and the computer she runs on. Prices change often, so this page gives ways to work out
your own numbers rather than fixed prices: **always check the provider's own pricing page.**

## Seeing what you spend

- **A usage line under each chat** shows the tokens and the estimated cost of that conversation.
- **Settings → Data & health → Usage and costs**: today, 7 and 30 days, by model and by purpose
  (chat, coding, team tasks, background jobs, memory, library…). Local models show as "local" and
  subscriptions as "$0 (subscription)".
- The costs are **estimates** from a price table. Sara ships with list prices for a few OpenAI,
  Anthropic and xAI models, copied from the providers' pricing pages on 2026-10-27. Other models
  (OpenRouter, Ollama Cloud, anything new) show tokens only until you type in their price on the
  same page. Your provider's bill is the real number.
- **Budgets:** team tasks and coding-agent jobs can have a token or dollar limit. At the limit she
  stops cleanly, says so, and offers *Continue with more budget*.
- Most providers also let you set a monthly spending limit on the key itself. Do that too.

## Models

### On your own hardware: no per-use cost

Ollama, vLLM or llama.cpp on your own GPU cost only electricity. A gaming GPU under load draws
roughly 200-500 W, but only while it's answering; idle it's much less.

### Cloud models with an API key: you pay per token

Providers charge per million **tokens** (a token is about ¾ of an English word), with different
prices for what goes **in** (your message plus everything Sara sends with it) and what comes
**out** (her reply).

The list prices Sara ships with (USD per million tokens, standard tier, checked 2026-10-27; they
will change):

| Provider | Model | In | Out |
|---|---|---|---|
| OpenAI | `gpt-6-luna` | $0.10 | $0.50 |
| OpenAI | `gpt-6.1-terra` | $1 | $5 |
| OpenAI | `gpt-6.1-sol` | $2 | $10 |
| OpenAI | `gpt-6-astra` | $10 | $50 |
| Anthropic | `claude-sonnet-5-5` | $2 | $10 |
| Anthropic | `claude-opus-5-5` | $4 | $20 |
| Anthropic | `claude-fable-5-1` | $10 | $50 |
| xAI | `grok-4.7` | $2 | $6 |

Pricing pages: [OpenAI](https://developers.openai.com/api/docs/pricing),
[Anthropic](https://platform.claude.com/docs/en/about-claude/pricing),
[xAI](https://docs.x.ai/developers/models). OpenRouter and Ollama Cloud list theirs on their own
sites.

**Working out a month.** Each message to her sends more than what you typed: her character, the
memories that fit, recent messages and, in coding, the files and tool results. Look at the usage
line under a few of your own chats for real numbers. As an example only: if each message sends
8,000 tokens in and gets 300 out, on a $2 / $10 model that is about 1.9 cents a message, so 50
messages a day comes to about $1 a day, or about $30 a month. The same use on a $0.10 / $0.50
model is about 5 cents a day. Coding sessions and team tasks use far more tokens than chat.

Ways to spend less:

- Put the **Memory and summaries** and **Quick replies** jobs on a cheap or local model: they run
  often. ([CHOOSING_A_MODEL.md](CHOOSING_A_MODEL.md) explains the jobs.)
- Use **Meaning search** with a local embedding model (`nomic-embed-text`): free.
- Lower *How much she brings to mind each message* (on her Memory page) if your messages are
  expensive.
- Set budgets on team tasks and jobs.

### Subscriptions: no extra bill, but limits

Signing in with a **ChatGPT plan, Claude Pro/Max or SuperGrok / X Premium+** (Settings → Models →
Subscriptions) costs nothing on top of your plan. What she does counts toward your plan's usage
limits, the same as using it yourself, and the provider can slow you down or pause you when you
reach them. The usage page shows these as "$0 (subscription)".

## Optional services

| Service | How it's paid |
|---|---|
| **Live calls with OpenAI** | An OpenAI API key, billed per use by OpenAI (realtime audio is priced per token of audio; check OpenAI's pricing page). A ChatGPT plan can't be used for calls |
| **Live calls with Grok** | Your Grok sign-in (counts toward your SuperGrok / X Premium+ usage) or an xAI API key (billed to that key) |
| **New pictures of her** (xAI Grok Imagine) | Your Grok sign-in (counts toward your subscription's usage) or an xAI API key (billed per picture). Sharing an existing portrait is free |
| **Cloud voices** (Grok, OpenAI, ElevenLabs) | Your subscription or that service's API key. Local voice on a Linux server is free |
| **Web search** | Brave and Tavily need an account and key (check their plans; they have offered free tiers); SearXNG on your own server is free |
| **Weather and maps** | Open-Meteo and OpenStreetMap are free and need no account |
| **Off-server backups** | Free to a folder or drive; S3-compatible storage (Backblaze B2, Cloudflare R2, AWS S3, Wasabi) charges per GB stored, usually little for Sara's size |
| **Tailscale** | Has a free plan for personal use (check Tailscale's pricing page) |
| **Your own web address** | A domain name from a registrar, usually paid yearly. The certificate (Let's Encrypt through Caddy) is free |

## The server

- **A computer you already have** (a spare PC, a mini PC, a Mac): free apart from electricity.
- **A VPS (rented server):** Sara alone runs on a small one. Use at least 2 GB of memory and 20 GB
  of disk (see [REQUIREMENTS.md](REQUIREMENTS.md)). In late 2026 plans of that size from the
  common hosting companies typically cost somewhere around $5-20 a month; check the provider. A
  VPS with a GPU big enough for local models costs far more, often more than a cloud model or a
  subscription would for one person.
