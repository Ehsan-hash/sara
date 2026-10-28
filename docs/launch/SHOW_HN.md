# Show HN: draft notes

**Read first.** Hacker News asks that Show HN text be **written by hand**: the moderators have
said not to use an LLM to write or even polish what you post there, because readers spot it and
react badly ([dang's Show HN tips](https://news.ycombinator.com/item?id=22336638), updated
2026-03-28). So this file is **not** a ready-to-paste post: it's the facts, the structure and the
traps, for you to write the text yourself in your own words.

Rules checked on 2026-10-27 ([showhn.html](https://news.ycombinator.com/showhn.html)):

- Show HN is for something people can **try**: Sara qualifies (install it, or the demo).
- It must be your own work, and you must be around to answer in the thread.
- No marketing language; plain, factual, personal. Backstory and technical detail go down well.
- Make it easy to try without sign-ups: link the demo and the one-line install.
- Don't ask friends to upvote or comment (that gets posts penalised).
- Use a username that's a person, not the project.
- Post when the repository is public, the installer line works and the demo is up.

## Title (pick one, keep it plain; 80 characters max)

- `Show HN: Sara – a self-hosted AI companion that can also write and test code`
- `Show HN: Sara – self-hosted AI companion and coding agent, zero dependencies, MIT`

## URL

`https://github.com/farena-ai/sara` (the repository; the README has the demo link and the video).

## What to cover in your text (in this order)

1. **One sentence: what it is.** A self-hosted AI companion with a personality you set, who is
   also a coding partner with real tools; runs on your own server or PC; MIT.
2. **Why you built it** (your own story, a few sentences): what you wanted that companion apps and
   coding agents didn't give you together.
3. **What's different**, as facts:
   - Bring any model: local (Ollama, vLLM, llama.cpp), cloud APIs, or subscriptions you already
     pay for. Ships with no credentials.
   - TypeScript that Node 24 runs directly: no build step, **zero runtime dependencies**, written
     from scratch.
   - Coding: a workspace per project with files, shell and git, live preview she tests in a
     headless browser, background jobs, a check that what she *says* she ran matches what ran.
   - Risky actions wait for approval; a safety layer (AI disclosure, crisis resources, a hard
     block on sexual content involving minors) runs in code and can't be switched off.
   - Phone apps, Telegram/Discord, a VS Code panel, an OpenAI-compatible API and an MCP server.
4. **Honest numbers** (link [docs/RESULTS.md](../RESULTS.md)); give the caveats with them:
   - On 14 small, original multi-file repository tasks (bugs across modules, features from a
     spec, refactors; hidden tests), her agent loop solved **11/14** and the same model answering
     in one reply with every file pasted in and no tools solved **12/14** (qwen3.8 27B, local; the
     same scores in two runs each). So her tools didn't add points; say so. The misses in both
     modes were rules written only in a README/SPEC that no test checked. Small set, one model: a
     sanity check, not a leaderboard.
   - HumanEval through her agent loop: 158/164; the same model with no tools: 161/164. The tools
     don't help there: the problems are short and probably in the model's training data.
   - 493 automated tests (486 run on Windows; 7 Linux-only sandbox tests).
5. **What's not done / known limits** (HN respects this): Windows has no command sandbox (so
   every command asks first); live voice calls use Grok or OpenAI realtime (cloud); the iPhone
   app depends on App Store review; it's a one-owner-per-server design, not multi-user.
6. **How AI was used to build it.** Say it plainly and truthfully (for example which coding agents
   you used and how you reviewed their work). People will ask; answering first avoids a
   distracting thread.
7. **How to try it:** the demo address, the one-line installer, Docker, the Windows/macOS
   installers.
8. **What feedback you want** (one or two concrete questions).

## Before posting

- [ ] Repository public, README renders, `curl … get-sara.sh | sudo bash` works on a fresh VM.
- [ ] Demo server up and reset; it can take a traffic spike (or say it's small).
- [ ] The video is linked from the README.
- [ ] You have 2–3 hours free after posting to answer comments.
- [ ] Text written by you, by hand.

## Answers worth preparing (facts only)

- *"Why not build on Open WebUI / SillyTavern / an agent framework?"* Sara is one small codebase
  with no runtime dependencies; she can still be used from SillyTavern and Open WebUI through her
  OpenAI-compatible API ([OTHER_APPS.md](../OTHER_APPS.md)).
- *"Is the companion part safe?"* Point to [COMPLIANCE.md](../COMPLIANCE.md) and
  [THREAT_MODEL.md](../THREAT_MODEL.md); the safety layer is in code, not a prompt.
- *"What does it cost to run?"* [COSTS.md](../COSTS.md) and
  [CHOOSING_A_MODEL.md](../CHOOSING_A_MODEL.md).
- *"What leaves my server?"* [PRIVACY.md](../PRIVACY.md).
