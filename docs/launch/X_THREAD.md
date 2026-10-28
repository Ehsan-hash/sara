# X (Twitter): thread draft

Norms: one idea per post, no hashtag walls (one or two at most), the video in the first post,
links in a later post (X shows fewer people posts that open with an external link), no
engagement bait ("RT if…"), no claims you can't back with the repo. Each post under 280
characters. Post from your own account; reply to questions in the thread.

**1/** (attach the 60–90 s video)
> I made Sara: an AI companion you run on your own computer, who can also build and test
> software with you.
>
> Open source (MIT), zero runtime dependencies, works with local models.

**2/**
> She has a personality you set (name, pronouns, sliders or a ready-made character) and a memory
> you can see, correct and delete. Moods, her own day, running jokes, reminders and a morning
> briefing.

**3/**
> For coding: a workspace per project with files, shell and git. She asks before risky commands,
> opens a live preview of what she builds, tests it in a headless browser and attaches the
> screenshot.

**4/**
> Bring any model: Ollama, vLLM, llama.cpp, cloud APIs, or a subscription you already pay for.
> Everything in the demo ran on a local 27B model on one GPU: $0 per message.

**5/**
> I measured it, and the tools don't win yet: on 14 small multi-file repo tasks with hidden
> tests, 11/14 with her tools vs 12/14 for the same local model with everything pasted in.
> HumanEval: 158 vs 161/164. Method and caveats are in the repo.

**6/**
> Safety is code, not a prompt: AI disclosure, crisis resources, approval before risky actions,
> and hard limits no setting can turn off.

**7/**
> Also: Android and iPhone apps, Telegram and Discord, VS Code, Home Assistant both ways, an
> OpenAI-compatible API and an MCP server.

**8/**
> Code, install and results: github.com/farena-ai/sara
> Try the demo: demo.sara.backstagecoding.com
>
> Feedback and issues welcome.

## Before posting

- [ ] The video is uploaded natively to X (not a YouTube link) with captions burned in or added.
- [ ] Numbers match [RESULTS.md](../RESULTS.md) on the day you post.
- [ ] Repository public, demo up.
