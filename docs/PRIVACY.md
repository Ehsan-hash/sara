# What leaves your server

Sara keeps your conversations, memories, notes, documents and keys on your own server. This page
lists every connection Sara makes to anything outside it, when it happens, and how to turn it off.
It was made by searching the code (`src/` and `deploy/`) for every outgoing address.

Short version: **nothing leaves until you set something up**, with one exception you control: a
reply you report with ⚑ is also sent to the app's developer unless you untick the box.

## While she runs

| What | Goes to | When | How to turn it off |
|---|---|---|---|
| **Your messages** (with the context she needs: her character, the memories that fit, recent messages) | The model provider you chose: your own Ollama/vLLM/llama.cpp (stays on your hardware), or OpenAI, Anthropic, xAI, OpenRouter, Ollama Cloud, a subscription | Every reply, and background work (memory notes, summaries, her diary, the library) on the model you picked for that job | Use a local model. Private conversations only ever use models on your own hardware |
| **Reports** (⚑ on a reply) | The developer's report inbox, `sara.backstagecoding.com` | Only when you press ⚑ and send a report. Sent: that reply's text (secrets scrubbed), the reason, your note, the model name, the Sara version and whether it came from the web or a phone app. Nothing else from the conversation | Untick **Also send it to the app's developer** in the report box (it's ticked by default), or set `SARA_REPORT_TO=off` on the server. The report always stays in Settings → Data & health → Reports |
| **Update checks** | GitHub (`api.github.com` on Windows and macOS; `git fetch` from github.com on Linux) | When you press *Check for updates* (Settings → Data & health → Updates) or run `sara check-updates` / `sara update` | Don't press it. Sara doesn't check on her own |
| **Weather** | Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`), free, no account | Once you set a city for the morning briefing: finding the city, then the forecast for the briefing (and, at most hourly, for her outfit when *Dress automatically* is on) | Leave the city empty (Settings → You → Morning briefing) |
| **Place look-ups and travel times** | OpenStreetMap: `nominatim.openstreetmap.org` (address search) and `routing.openstreetmap.de` (travel time) | When you save a place by address (Planner → Reminders → Places), and for leave-by reminders on calendar events with an address | Save places with "Save where I am" in the phone app; leave Leave-by reminders off (Settings → You) |
| **Web search and web pages** | The search service you set (Brave, Tavily, Ollama web search or your SearXNG), and the pages she opens with `web_fetch` | Only when web tools are on and she searches or reads a page | Settings → Abilities → Tools and approvals; leave Web search empty. Never in private conversations |
| **Gmail and Google Calendar** | Google (`googleapis.com`, `accounts.google.com`), through your own Google app | After you connect it (Settings → Abilities → Gmail and Calendar), when she reads mail or the calendar, or for Today and the briefing | Disconnect it there |
| **GitHub** | `api.github.com`, `github.com` | After you add a GitHub token: issues and pull requests, push, watched repositories (every 15 minutes or hourly, if you chose any) | Remove the token (Settings → Abilities → GitHub) |
| **Home Assistant** | Your own Home Assistant address | After you connect it, when she reads or changes something | Settings → Abilities → Home Assistant |
| **Other programs (MCP)** | Whatever MCP servers you add (for example a CalDAV calendar) | When she uses their tools | Settings → Abilities → Other programs (MCP) |
| **Telegram and Discord** | `api.telegram.org`; `discord.com` and `gateway.discord.gg` | While a bot token is set | Settings → Connections → Telegram / Discord |
| **Notifications in the browser or the home-screen app** | Your browser's push service (Google for Chrome, Microsoft for Edge, Mozilla for Firefox, Apple for Safari), end-to-end encrypted | When she has something to tell you and you allowed notifications | Turn notifications off (Settings → Connections → Phone and notifications). Your phone's own settings can hide the message text on the lock screen |
| **iPhone app notifications and calls** | Apple's push service (`api.push.apple.com`) | Only if an Apple push key is set on the server | Leave the APNs key out |
| **Android app** | Nothing: the app checks your server itself (no Google services) | | |
| **Voices and hearing** | The voice service you choose: xAI (Grok voice), OpenAI, ElevenLabs, or local voice on the server (Linux) | When she speaks, hears a voice note, or you press a voice sample | Settings → Her → Voice: choose local voice or none |
| **Live calls** | xAI (Grok voice) or OpenAI Realtime, relayed through your server | Only during a call | Don't start calls. (In 1.0, calls are refused on private conversations) |
| **Pictures of her** | xAI Grok Imagine (`api.x.ai`): her portrait and a short scene description | When you make a new look, or she takes a new picture (she asks first unless you allow it) | Settings → Her → Pictures from her. Sharing an existing portrait sends nothing |
| **Off-server backups** | The folder or S3-compatible storage you chose, encrypted with your passphrase before it leaves | After each daily backup, once you set it up | Settings → Data & health → Backups |
| **Subscription programs** | OpenAI (Sign in with ChatGPT), Anthropic (Claude Code), xAI (Grok) | When a subscription is your model for a job | Sign out in Settings → Models → Subscriptions |
| **The testing browser** | Only her own previews, plus public websites when web tools are on and the conversation isn't private | When she tests an app she built | Settings → Abilities → Tools and approvals |
| **A model on this computer** (Settings → Models → On this computer) | Ollama's model library (`registry.ollama.ai`, fetched by your Ollama); for *Install Ollama with winget*, winget's sources | Only when you press **Download this model** or **Install Ollama with winget**. Finding Ollama and looking at the hardware sends nothing (`127.0.0.1:11434`, `nvidia-smi`, `sysctl`) | Don't press them (both are refused while *Nothing leaves this computer* is on) |
| **Tailscale** | Tailscale's coordination servers (that's how Tailscale works) | If you chose "Tailscale" for how you reach her | `sara access local` (or another way) |
| **Certificates for your own web address** | Let's Encrypt (through Caddy) | If you chose "My own web address" on Linux | `sara access local` (or another way) |

Commands she runs in her workspace (builds, tests, `npm install`) can reach the internet only if
**Allow internet access for shell commands** is on (Settings → Abilities → Tools and approvals),
and never in private conversations.

The demo server (`SARA_DEMO=1`) and the developer's report inbox (`SARA_REPORT_INBOX=1`) are
separate modes you won't run unless you set them up on purpose.

## While installing

| What | Goes to |
|---|---|
| Sara herself | `github.com` / `raw.githubusercontent.com` (the one-command installer and `git clone`), or the releases page for the Windows and Mac installers |
| Her own Node.js (Linux) | `nodejs.org` (a pinned version checked against its SHA-256) |
| System packages you agree to (git, curl, bubblewrap, bzip2, Caddy) | Your Linux distribution's package mirrors |
| Local voice (optional) | `github.com` (the sherpa-onnx releases with the speech models), checked by SHA-256 |
| Testing browser on Linux (optional) | `storage.googleapis.com` (Google's Chrome for Testing), checked by SHA-256 |
| Subscription programs (optional) | `registry.npmjs.org` (Claude Code and the Grok program, pinned by a lockfile) |
| Docker (optional) | Docker Hub (the `node:24-slim` image, and `ollama/ollama` with the Ollama profile) |
| Tailscale (optional) | Tailscale, if you install it |

## Bringing her from another app

Importing chats (*Settings → Her → Bring her from another app*, [IMPORT.md](IMPORT.md)) sends
nothing anywhere until you press **Let her read them**; then the chosen conversations go, with
secrets blanked out, to the companion's background model. With **Only models on this server** (on
by default) that is only ever a model on your own hardware; untick it and it can be a cloud model,
whose estimated cost you see first. **Read without a model** sends nothing.

What is kept: only the notes you tick and press Save on (facts about you, dated summaries of your
history together, and, if you tick it, lines for her personality). The chats themselves are kept
only if you tick *Also keep the chats* (off by default), archived and never shown to other apps,
MCP or the API. The uploaded file is deleted as soon as it's read, and the parsed chats are held
in the server's memory for two hours at most. *Remove imported history* (Data & health → Export and
import) deletes everything an import kept.

## Group chats

In a group chat ([GROUP_CHATS.md](GROUP_CHATS.md)) each companion's reply goes to **her own** model
and provider, with her own memories, so what reaches a cloud model depends on each member's model
choice; a group chat made **Private** uses only models on your own hardware for every member. Each
member keeps her own copy of the chat in her own database and remembers it as she heard it: your
lines as yours, the other companions' lines as theirs, tagged with the chat's name. Companions who
aren't in the chat learn nothing from it. Group chats are never shown to other apps, MCP or the API,
and deleting one deletes every member's copy.

## Her logs

Her logs stay on your server (`<data>/logs/sara.log`, the system journal or `docker logs`, and a
`SARA_LOG_FILE` if you set one); nothing sends them anywhere. They record what the server does
(started, which model failed and why, backups, updates, connections), never what you say: your
messages, her replies, memories, documents, photos and tool output are not logged. Every line, on
the console and in every log file, first has your saved keys and anything shaped like a key or token
replaced. The owner token and setup code are printed once at start-up straight to the console (the journal or
`docker logs` on a server), never into her log files. Before
you share a log (for a bug report), still read it: it can name your server's folders, models and
connected services. See [INSTALL.md → Logs](INSTALL.md#logs).

## Turning everything off at once

**Nothing leaves this computer** (Settings → Models → On this computer, or `SARA_PRIVATE_LOCAL=1`)
does it with one switch, enforced in Sara's code: while it's on, her server connects only to the
computer she runs on (`127.0.0.0/8`, `::1`, `localhost`), decided by the address before any DNS
lookup, and every table row above that would reach another computer is refused or paused (cloud
models and subscriptions, web search and pages, reports to the developer, update checks, weather
and travel times, Gmail and Calendar, GitHub, MCP and Home Assistant on other computers, Telegram
and Discord, notifications through browser and Apple push services, voices and calls, pictures of
her, off-server S3 backups, the testing browser's public web, and internet for her commands). The
same page finds Ollama on that computer and downloads a model that fits it. What it guarantees and
what it can't (her commands on Windows, the system itself, your browser):
[PRIVATE_LOCAL.md](PRIVATE_LOCAL.md).

To do it by hand instead, with nothing leaving the server: a local model (Ollama on the same machine or your own
network) for every job, local voice or no voice, no city for the weather, no connected accounts, no
bridges, web tools off, reports set to `SARA_REPORT_TO=off`, and "Just this computer" or your home
network for how you reach her. Private conversations already enforce most of this per
conversation.

See also: [DISCLOSURES.md](DISCLOSURES.md) (what to know before you use her) and
[THREAT_MODEL.md](THREAT_MODEL.md) (how the data is protected).
