# Sara 1.0 (draft release notes)

> **Draft.** Rewritten after 0.54.0 (Phase 54). 1.0 is Phase 55 and ships only on the owner's
> green light, after the release checklist and the lawyer review. Before publishing: fill in the
> version number, put the real installers on the releases page (`Sara-Setup-<version>.exe`,
> `Sara-<version>.dmg`, with their SHA-256), add the App Store and Google Play links once the
> phone apps are approved, and re-check the "Checked before release" list below.

Sara is an AI companion you run yourself, who is also a real coding partner. She chats,
remembers what matters to you, keeps your plans and reminders, reads your documents, writes,
runs and tests code in a sandbox, talks out loud, and reaches you on your phone, your computer,
Telegram and Discord. Your conversations, memories and keys stay on your own server, with the
models you choose, including the subscriptions you already pay for.

## Getting her

- **Linux server, one command:** `curl -fsSL …/get-sara.sh | sudo bash` asks four plain questions
  (how you'll reach her, a safer shell for her coding tools, local voice, the port), each with a
  suggestion you take by pressing Enter. Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch and openSUSE,
  on x86_64 or arm64. Or Docker Compose.
- **Reaching her:** Tailscale (private, works from your phone anywhere, HTTPS done for you), your
  own web address (Caddy gets the certificate for you), just this computer, or your home network.
  Change it any time with `sara access`.
- **Windows 10/11:** one installer for her server and the desktop app, as a Windows service or
  only while you're signed in. It isn't code-signed yet (see Known limits).
- **macOS 13+:** a signed and notarized `Sara-<version>.dmg` (Apple silicon and Intel). The app
  sets up her server on your Mac, from startup or only while you're signed in.
- **Phones:** the web app works now (add it to your home screen); the iPhone and Android apps are
  coming soon to the App Store and Google Play. Pair a phone by scanning a QR code.
- Step by step: [INSTALL.md](INSTALL.md), [PHONE.md](PHONE.md),
  [REQUIREMENTS.md](REQUIREMENTS.md), [CHOOSING_A_MODEL.md](CHOOSING_A_MODEL.md).

## What she does

- **A companion with a life of her own:** her own character, moods and day; she remembers what you
  tell her and the dates that matter, and you can see, correct and forget any of it.
- **Start from a character:** seven ready-made, original companions in a gallery, or make your
  own; share yours as a file. Work dials (banter while coding, celebrating, teasing about bugs,
  "Quiet when I'm focused") apply only while you work.
- **Your story together:** a timeline of milestones, decisions, promises and dates, and a warm look
  back ("write our year") that quotes only your real words.
- **Bring your history:** import your ChatGPT or Claude export; she learns about you from your own
  words, and "Remove imported history" undoes it all.
- **Your library:** PDFs (scans too), Word, Excel, PowerPoint, e-books and web pages; she answers
  from them and tells you which document and page.
- **A working partner:** files, shell and git in a sandbox, long jobs in the background, a team of
  helpers from a GitHub issue to a reviewed pull request; risky steps wait for your OK.
- **See it run:** a live preview of the web app she's building next to the chat, which she tests
  in her own browser and attaches screenshots of.
- **She knows your code:** a code map of each project (outline, find by name, words or meaning,
  what uses what) and recipes: how she did a tricky job, saved for next time.
- **Wherever you build:** `sara-chat` in any terminal and a Sara panel in VS Code, signed in with a
  short code you approve. Tested starter projects to begin from.
- **What it costs:** a usage line under each chat, a Usage and costs page (by model and by
  purpose), and token or dollar budgets for team tasks and coding jobs.
- **Voice:** live calls you can interrupt with Grok or OpenAI realtime voice, voice notes, read
  aloud, an animated portrait that talks.
- **Discord and Telegram:** her own bot account; on Discord she can also work with other bots
  (off by default, with loop limits).
- **Planner:** to-dos, notes and reminders that reach you wherever you are; a morning briefing, a
  Today page and a weekly look back.
- **In your language:** the app in English, Español, Français, Deutsch, Português (Brasil) and
  Italiano, and she talks to you in it.
- **Make her yours:** any name, pronouns, personality and look.
- **Build on her:** a guide to adding tools, bridges, characters, MCP servers and starters, with
  working examples ([EXTENDING.md](EXTENDING.md)).

## Always on

AI disclosure at the start and regularly after, an honest answer whenever she's sincerely asked if
she's an AI, crisis resources, and a hard block on sexual content involving minors. These can't be
switched off. Adult content is off until you turn on Adult mode (in a web browser only, with an
"I am 18 or older" confirmation; there's no ID check). See [DISCLOSURES.md](DISCLOSURES.md),
[COMPLIANCE.md](COMPLIANCE.md) and [PRIVACY.md](PRIVACY.md).

## Checked before release

Measured results, with the scripts to re-run them, are in [RESULTS.md](RESULTS.md): HumanEval
158/164 through her agent loop on a local 27B model, memory 11/12, library 8/8, code map 8/8.

Done for 0.45 (the Linux release candidate): independent reviews of security, correctness and the
installer; fresh installs on Debian 12, Ubuntu 24.04 and Docker; upgrades from 0.26 and 0.30
straight to the newest; a backup-and-restore drill; a load check with thousands of messages and
notes and a 500-page PDF. The Mac command sandbox was checked on a real Mac for 0.46.

**To re-run before 1.0** (list here only what was actually done): `get-sara.sh` on each named
distribution; the Windows installer in service and signed-in modes, upgrade and uninstall; the
Mac app as a LaunchAgent (the LaunchDaemon option was removed in 0.55), both in "Run Sara on
this Mac" and "Connect to a Sara somewhere else"; the Windows installer's app-only mode; `npm run check` on Windows and on Linux.

## Known limits

- **Windows has no command sandbox:** she asks before every command (you can still allow a tool).
  The Windows installer is unsigned until a code-signing certificate is in place: Windows shows
  "More info → Run anyway" the first time.
- **Local voice** (speech recognition and voices on your server) is Linux x86_64 only, and the
  local voices are English only. Elsewhere, use Grok or OpenAI voices.
- Server messages (the `sara` command, installer text, some errors) are in English only.
- **Docker** has no local voice and no subscription sign-ins, and weaker isolation than a native
  install: her commands run as a separate user that can't read her data but sees the container.
- **HumanEval** doesn't show what her tools add: the plain model already scores 161/164 on these
  short problems, and her loop scored three fewer. Her loop is for real projects, where she runs
  the tests and fixes what fails.
- While the testing browser runs, its DevTools port listens on 127.0.0.1 (closed after the turn or
  5 idle minutes); a local program that finds it could drive that browser, which can only reach
  her previews.
- Old .doc/.xls/.ppt files aren't read (save them in the newer format); JPEG 2000 and fax-style
  scans inside PDFs are skipped with a note.
- Telegram doesn't pass messages between bots, so working with other bots is Discord only.
