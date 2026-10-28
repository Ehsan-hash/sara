# Launch video: script and shot list (60–90 seconds)

One short, real video for the README, the release page, Show HN, Reddit and X. Everything in it
must be something Sara really does on the day you record: no mock-ups, no sped-up model replies
without saying so, no edited answers. If a take goes wrong, record it again instead of editing the
reply.

**Target length:** 75 seconds (hard limits 60–90). **Format:** 1920×1080 landscape for GitHub,
YouTube and X; cut a 1080×1920 vertical version from the same footage if you want one for phones.
**Voice:** your own voice-over (recorded separately is fine), plus Sara's real voice during the
call.

## Before you record

- A clean test server (not your real one): a fresh install, the default character or a gallery
  character, no private chats, memories, names, addresses or keys anywhere on screen.
- A local model connected (the README results use `qwen3.8:27b-mtp-q4_K_M` on Ollama). For the
  voice call you need Grok or OpenAI live voice (a subscription or API key), which is a cloud
  service: say so on screen during that shot.
- Browser at 100 % zoom, window 1600×900 or larger, bookmarks bar hidden, notifications off, a
  plain desktop background. Phone: Do Not Disturb on, battery and clock tidy, no personal
  notifications.
- Have the phone app paired to the same test server and a few to-dos in the planner so Today isn't
  empty.

## Shot list

| # | Time | On screen (exact actions) | Spoken (voice-over unless marked) |
|---|---|---|---|
| 1 | 0:00–0:06 | Title card: the logo, "Sara", "a self-hosted AI companion who is also a real coding partner". Use `docs/social-preview.png` or a crop of it. | "This is Sara. She's an AI companion you run on your own computer, and she can actually build software with you." |
| 2 | 0:06–0:18 | The web app, a new conversation. Type: *"Long day. Cheer me up for a second, then I've got a small coding job."* Let her full reply appear at normal speed. | "She has a personality you set yourself, and she remembers what matters to you. You can see, fix or delete every memory." |
| 3 | 0:18–0:36 | Type: *"Build me a tip calculator web page and show it to me."* Show the approval card when she wants to start the preview server; click **Allow**. The live preview opens beside the chat; she tests it in her own browser and attaches the screenshot. Type numbers into the app yourself. If the model is slow, cut out the waiting and put a small "sped up 4×" label on that part. | "She writes the code, asks before she runs anything, opens a live preview and tests it herself, with a screenshot as proof." |
| 4 | 0:36–0:48 | Start a live voice call (the call button). Ask out loud: *"What's on my list for tomorrow?"* Let her answer by voice; interrupt her once mid-sentence to show you can. Lower-third label: "Live voice: Grok/OpenAI realtime (cloud)". | (Your real question and her real answer; no voice-over here.) |
| 5 | 0:48–0:58 | The phone: open the Sara app, show the **Today** page (briefing, to-dos, reminders), then a short chat message from the phone. | "The same Sara on your phone: Android and iPhone apps, Telegram and Discord too." |
| 6 | 0:58–1:06 | Settings → Models: the local Ollama model selected; then the usage line under the chat ("… tokens · local": local models have no per-token price). Lower-third: "$0 per message with a local model (one RTX 5090 here)". | "With a local model, chatting costs nothing beyond your own electricity. Cloud models work too, if you want them." |
| 7 | 1:06–1:12 | The safety settings: show that the safety layer has no off switch, then the AI disclosure line at the top of a chat. | "Her safety layer is always on: she says she's an AI, asks before risky actions, and some lines can't be crossed by any setting." |
| 8 | 1:12–1:18 | End card: `github.com/farena-ai/sara` · "MIT · self-hosted · zero dependencies" · `demo.sara.backstagecoding.com`. | "Sara is MIT licensed and free. The link is below." |

Keep the claims in the voice-over to these. Don't say "the best", "revolutionary", "replaces your
IDE", or quote benchmark numbers without their caveats (if you mention a number, use the ones in
[RESULTS.md](../RESULTS.md) with their model and date).

## How to record

### Windows

- **Screen:** the Snipping Tool's video mode (Windows 11: Win + Shift + S, then the video icon) or
  Xbox Game Bar (Win + G, record with Win + Alt + R; records one app window). For more control use
  [OBS Studio](https://obsproject.com/) (free): Display Capture, 1920×1080, 30 fps, MP4.
- **Voice-over:** OBS with your microphone, or record separately with the Sound Recorder app and
  add it in the editor.
- **Edit:** Clipchamp (built into Windows 11) or DaVinci Resolve (free). Trim waiting time, add
  the lower-third labels, export 1080p MP4 under 100 MB.

### Mac

- **Screen:** Cmd + Shift + 5 → "Record Selected Portion" → Options → choose your microphone. Or
  QuickTime Player → File → New Screen Recording.
- **Edit:** iMovie (free) or DaVinci Resolve. Export 1080p.

### iPhone (for shot 5)

- Settings → Control Center → add **Screen Recording**. Open Control Center, long-press the record
  button and turn the microphone on if you want sound. The video lands in Photos; AirDrop it to
  your computer.
- Or film the phone in your hand with a second phone or camera for a more personal shot (keep the
  screen readable, no glare).
- On Android: Quick Settings → **Screen record**.

## Checklist before you publish

- [ ] Watched it once with the sound off: the captions/labels alone explain what's happening.
- [ ] Nothing private on screen (names, addresses, tokens, other chats, browser tabs, email).
- [ ] Every sped-up part is labelled; no replies were edited.
- [ ] The cloud voice is labelled as cloud; "$0" is said only about the local model.
- [ ] Captions added (YouTube auto-captions, checked by hand, or an `.srt` file).
- [ ] Uploaded where the README and the posts can link to it (a GitHub release asset, YouTube or
      both).
