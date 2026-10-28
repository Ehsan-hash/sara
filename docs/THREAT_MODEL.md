# Threat model

What Sara protects, from whom, and how. It was first written for Phase 24 (0.24.0) after a full
security review (sign-in, demo, sandbox and tools, credentials and personal data, phone apps and
web front-end), and updated for 1.0 (Phases 46-54: the installers for Linux, Windows and macOS,
history import, device sign-in for apps, previews and the testing browser, the code map). Keep it
current when a feature changes how data or authority flows.

Some 1.0 hardening is described here as the intended 1.0 behaviour while it is being finished:
it is marked **(1.0)**.

## What there is to protect

| Asset | Where it lives | Why it matters |
|---|---|---|
| Conversations, memories, notes, planner, scrapbook, look pictures | `sara.db` and files in the data folder | The owner's private life |
| Saved places (name and coordinates, Phase 29) | `sara.db` | Where the owner goes; the phone never sends its live location, only "arrived at / left place N" |
| Third-party credentials: GitHub token, Home Assistant token, Google OAuth tokens, provider API keys, subscription sign-ins (ChatGPT, Claude, Grok), APNs key, bridge tokens | The encrypted vault (AES-256-GCM, master key `0600` in the data folder or `SARA_MASTER_KEY`); agent sign-ins under `agents/` | Access to the owner's other accounts |
| The owner's sign-in: owner token (stored as a hash), session secret, passkeys, two-step secret | `owner.json` (`0600`) | Whoever has these *is* the owner |
| Backups | `backups/` and the off-site copy | They hold everything above, including the vault key unless a passphrase is set |
| The server itself | **Linux:** Sara runs as the unprivileged `sara` user. **Docker:** as an unprivileged user in the container. **Windows service:** as its own limited account `NT SERVICE\Sara` (not SYSTEM). **Windows "only while I'm signed in"** and **macOS:** as the signed-in owner's own account | Sara never has root or administrator rights. In the Windows signed-in mode and on macOS the server process can read everything that user can (their documents, browser profiles, keys), so a compromise of Sara there is a compromise of that account; the command sandbox (macOS) and approvals (Windows) are what stand between her tools and those files |

## Who might attack, and what they can do

1. **Someone on the internet** who can reach the server but has no sign-in.
2. **A demo visitor** on a `SARA_DEMO=1` server. Every visitor is technically signed in.
3. **Someone who gets a session cookie**, for example from an unlocked device left signed in.
4. **Content the model reads**: web pages, emails, GitHub issues and pull requests, files in a
   cloned repository, MCP server output. That content can try to steer the model (prompt
   injection). The model itself is treated as untrusted when it asks for tools.
5. **A hostile repository** that the owner asks Sara to work on: its git config, hooks and links.
6. **The `sara` user itself**, if the app is ever compromised. It must not be able to become root.
7. **A malicious app or site on the owner's phone** talking to the Sara app.

Out of scope: someone with root on the server, and someone who has the owner's unlocked computer and
owner token. Model providers see what is sent to them; private conversations are sent only to a
provider on hardware the owner controls.

## Defences, by attacker

### 1. Internet, no sign-in
- Every `/api` route needs a session cookie, the owner token or a device token, except: health,
  login, pairing redemption, passkey sign-in, `GET /api/session` (says only whether you're signed
  in), the device sign-in start and poll (`POST /api/device/start`, `/api/device/poll`: they hand
  out a code and, once the owner approved it, that app's token), the Google sign-in return
  (`GET /api/google/callback`, checked against the one-time state it started with), the demo start,
  the privacy and support pages, and `POST /api/public/report`, which exists only on the
  developer's report inbox (`SARA_REPORT_INBOX=1`, size- and rate-limited). Previews under
  `/preview/<token>/` need no session: the random token is the authorisation (section 4b). With
  two-step sign-in on, the owner token alone is not enough.
- The owner token, pairing codes (10 minutes, one use) and two-step codes are compared in constant
  time and stored hashed. Wrong attempts are limited per address (IPv6 per /64). Passkey challenges
  are one-time and have their own allowance for sign-in and for adding a key.
- The session cookie is `HttpOnly; SameSite=Strict`, and `Secure` on https (automatically behind a
  trusted proxy). Responses send a strict CSP (no inline scripts or styles), `frame-ancestors
  'none'`, `nosniff`, `Permissions-Policy`, `COOP`/`CORP same-origin`, and HSTS on https.
- Requests that change things must be JSON and must come from the same site. Sign-out and the demo
  start check this too, so a cross-site form can't sign the owner out or plant a session.

### 2. Demo visitors
- A visitor's conversations live in memory and are visible only to that visitor. Reports are
  filtered per visitor.
- Visitors can **read** only an allowlist of routes (`DEMO_READS` in `src/server.ts`) and write
  only a short list (`DEMO_WRITES`). Backups, workspace files, health details, accounts, devices,
  updates, exports and character files are refused. A test lists them.
- The demo makes no backups, has no live calls, and its owner token is not used anywhere public.

### 3. A stolen session cookie
- Adding or removing a passkey and starting two-step sign-in need the owner token, or the current
  code when two-step is on. A stolen cookie can't create a lasting way back in.
- Turning two-step on signs every other device out. A new owner token signs every device out and,
  by default, removes passkeys.
- Settings → Data & health → Devices and sign-in lists every signed-in device and app, with sign
  out for each.
- **(1.0)** Approving a new app or device needs re-authentication (the owner token, a current
  two-step code or a passkey), so a stolen cookie alone can't add a lasting device. Device tokens
  can't manage devices or sign-in settings.

### 4. Content the model reads (prompt injection)
- Text from web pages, email and GitHub is labelled as information, never instructions.
- Tools that send, write outside the workspace, spend money or reach other people ask the owner
  first (an approval card). Reading tools run alone. Only tools offered for that turn can run,
  whatever the model asks for; partner chats have no tools.
- Private conversations use no off-server tools (web, mail, calendar, GitHub, MCP, delegation,
  push) and their commands get no network. **(1.0)** Live voice calls are refused on private
  conversations (a call streams to a cloud voice service).
- `web_fetch` refuses private, loopback, link-local (cloud metadata), CGNAT and reserved addresses,
  including the IPv6 spellings that carry an IPv4 address inside, and checks again after each
  redirect.
- Output from tools is scrubbed of anything that looks like a stored secret before it reaches the
  model or the chat.

### 4b. Web apps she builds (previews and the testing browser, Phase 49)
What runs in a preview is code she (or a repository) wrote, so it is treated as hostile.
- Previews are served only under `/preview/<128-bit random token>/`. The token is the only
  authorisation (never the session cookie). It is made by her `preview_start` tool or the
  owner-only `/api/previews`, bound to one workspace, one port and the background job that opened
  it, ends after 12 hours, when the job ends, or when revoked, and answers 404 otherwise.
- The port must be listened on by a process of that job's own process tree, checked with the
  operating system (`/proc` on Linux, netstat + the process list on Windows, lsof on macOS); what
  the job prints is only a hint. Sara's own port is refused; only 127.0.0.1 is ever contacted.
  **(1.0)** Only IPv4 loopback listeners owned by the job are proxied (not `::1`, not a listener on
  another address that happens to answer on loopback).
- Every response carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
  allow-modals allow-downloads` (no `allow-same-origin`): the page has an opaque origin, so its
  scripts can't read Sara's cookies or storage and its requests to `/api` carry no session
  (SameSite=Strict) and can't be read (no CORS). The chat shows it in an `<iframe sandbox>`
  without `allow-same-origin` too. `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`: only
  Sara's own page can frame it. CORP is `cross-origin` and CORS `*` without credentials, because
  the opaque page loads even its own files cross-origin.
- Requests to the app are rebuilt: an allow-list of headers (no cookies, authorization, origin,
  referer or forwarding headers), `Host: 127.0.0.1:<port>`, bodies up to 10 MB sent with an exact
  length (no chunked framing to disagree about), paths without `.`/`..` segments (also encoded),
  backslashes or a leading `//`. Responses lose `Set-Cookie` and the app's framing, CSP and CORS
  headers; redirects to the app are kept inside the preview, to other local ports dropped.
  WebSocket upgrades (hot reload) are refused.
- Verified in a real browser (Edge, Windows): inside the preview `self.origin` is `null`,
  `document.cookie` and `localStorage` throw `SecurityError`, `fetch('/api/session')` fails.
- The testing browser runs per conversation with a throwaway profile (Edge: InPrivate, no
  sync/sign-in/extensions), inside the command sandbox on Linux, and every request goes through a
  proxy in Sara (`--proxy-bypass-list=<-loopback>`, WebRTC limited to proxied traffic) that
  allows previews only, plus public addresses on ports 80/443 when web tools are allowed and the
  conversation isn't private. There is no "run JavaScript" tool: checks are fixed assertions.
- Remaining: the DevTools port of the testing browser listens on 127.0.0.1 while it runs (closed
  after the turn or 5 idle minutes); a local process that finds it could drive that browser, which
  itself can only reach previews.

### 5. A hostile repository
- Every git command Sara runs herself has hooks, fsmonitor, pagers, external diff and text
  conversion, credential helpers, proxy commands and the `ext::` protocol switched off on the
  command line (`GIT_SAFE`), which overrides any config file. `-C` must stay inside the workspace.
- The file tools can't write `.git/`, `.gitconfig` or `.gitmodules`; changing those takes the shell
  tool, which needs approval.
- Paths are checked part by part without following links. A link that points outside the
  workspace, or points nowhere, is refused. Snapshot restore never writes through a link.
- **(1.0)** The code map never follows symbolic links while scanning, so a repository can't make
  it index (and show the model) files outside the workspace.
- The GitHub token is only handed to `https://github.com/...` remotes with no address-rewriting
  rules, through a credential helper defined on the command line that reads it from that one
  command's environment. It is never written to disk, a URL or the repository. Push runs with
  `--no-verify`.
- Delegating to Claude Code or Grok (which run without their own step-by-step prompts) is only
  available under bubblewrap. Grok's config keeps only Sara's own MCP server.

### 6. The `sara` user trying to become root
- Updates run through a root-owned path unit (`sara-updater.path`). Root reads only a plain
  request file (never a link), writes its status into `/var/lib/sara-updater` (root-owned,
  readable by the `sara` group), and makes backup and restore temporary files in root-only
  folders. The source checkout `/opt/sara-src` and the code in `/opt/sara` are owned by root.
- `deploy/install.sh` installs no system packages. `get-sara.sh` and `sara access domain` install
  only git, curl, ca-certificates, bubblewrap, bzip2 and Caddy, from the distribution, after
  asking. The system Node.js is never used (unless `SARA_USE_SYSTEM_NODE=1`) or changed.

### 7. The phone apps
- The Android and iPhone apps are wrappers around the owner's own server. They only load that
  server's pages, so the page bridge (`SaraPhone`) only talks to it; other links open in the
  browser.
- The saved sign-in cookie is sent only to the saved server (same scheme, host and port); a newly
  typed address never gets it, and redirects aren't followed. iOS clears it when the server
  changes.
- Android: nothing exported except the launcher, share target and reply receiver (explicit),
  immutable PendingIntents, `allowBackup=false`, app lock with BiometricPrompt and `FLAG_SECURE`.
  iOS: deep links and notification URLs are checked; web inspection only in debug builds.

### Several companions (Phase 31)
- Every companion runs the same turn code, so `SAFETY_BOUNDARIES`, the minors block, crisis resources and the AI disclosure apply to each one. Each companion keeps her own disclosure state, so the notice is shown again at the first use of a new companion.
- Companions are the same owner's characters, not separate users. They share the owner token, devices, the vault (keys) and tools; nothing in this layer separates trust between companions.
- Which companion a request reaches comes from a cookie or header chosen by the signed-in owner, or from the conversation id in the path. Choosing one never changes who is signed in. An unknown choice falls back to the first companion.
- Each companion's folder is created 0700 and its files 0600. Backups snapshot every companion's database with `VACUUM INTO`. A removed companion's folder is renamed aside rather than deleted.

### Memory and recall (Phase 32)
- The `recall` tool and automatic look-up read only this companion's own conversations with the owner. They never read chats with other people (partner conversations) or messages the owner forgot. Off-the-record conversations are never stored, so there is nothing to find.
- Forget also hides later messages that repeat the forgotten thing. These are found by the names in the note (months and weekdays excluded) and by its exact quote. The summaries and notes that mention it are removed and rewritten. The words stay visible to the owner, but are hidden from her.
- Every decision, promise, milestone and "no longer true" mark must quote the words actually said in the conversation, or it is dropped, the same receipt rule as facts.
- Sharing between companions is off by default. When it is on, it shares only facts about the owner, never conversations, summaries or what a companion said about herself.

## Known limits (accepted for now)

- **`SARA_SANDBOX=none`** (Windows, Linux without bubblewrap, or macOS if `sandbox-exec` fails):
  commands run as the server's own user and can read the data folder, including the vault key.
  Command tools ask first unless the owner sets them to *Allowed*, and say when no sandbox is
  active. Use bubblewrap on a Linux server.
- **Docker (`user` mode):** containers can't use bubblewrap, so commands and MCP servers run as a
  separate `sara-tools` user that can't read Sara's data, but they see the container's whole file
  system and network.
- Backups kept on the server contain the vault key (they have to, to restore it), so they are as
  sensitive as the data folder. The off-site copy is encrypted with the owner's passphrase.
- The built-in claim checker and safety patterns cover English, Spanish, French, German,
  Portuguese and Italian. Other languages rely on the optional local checker model, if the owner
  sets one up.
- Model providers in the cloud see what is sent to them. Choose a local model for private chats.

## Checks that keep this true

- Tests: `test/demo.test.ts` (demo allowlist, reports), `test/phase24.test.ts` (passkeys, two-step,
  proof of identity, cross-site posts, limiter), `test/security-tools.test.ts` (links, git
  settings, private addresses, Grok config), plus the safety, sandbox and redaction tests.
- Drills: restore a backup into a separate folder and port, and compare (`docs/ops`); update
  rollback (a broken commit rolls back by itself).
- Soak: `deploy/soak/` walks the demo every 5 minutes for a week (no model calls).

## Installers and how she runs (Phase 46)

- **Linux:** `get-sara.sh` runs as root once. `sara access` (root) edits only Sara's own site block
  in Caddy (`/etc/caddy/Caddyfile`, between Sara's markers) and Sara's entry in `tailscale serve`;
  switching away removes only those. Downloads are pinned and checksum-verified. `sara access lan`
  serves plain HTTP on the home network on purpose, with a warning.
- **Windows service:** the service runs as `NT SERVICE\Sara`, a virtual account with no password
  and no administrator rights. Her data in `C:\ProgramData\Sara` is readable only by that account,
  administrators and SYSTEM. The program in `C:\Program Files\Sara` is writable only by
  administrators. The firewall rule for "My home network" is limited to private networks.
- **Windows "only while I'm signed in":** no administrator; the server runs as the signed-in user
  and can read what that user can (see the asset table). There is no command sandbox on Windows,
  so every command asks first by default.
- **macOS:** a LaunchAgent (while signed in) registered through `SMAppService`; it runs as the
  signed-in user. **(Phase 55)** The LaunchDaemon ("from startup", started as root and switching to
  the app's owner) was removed, and with it the root code path and its signature check; the
  supervisor refuses to run as root, and an update unregisters an old daemon and moves to the agent. Commands run under `sandbox-exec`: only
  the workspace is writable, and the owner's home folder and her data folder are hidden.
  **(1.0)** The sandbox profile allows only a short list of system services (instead of all of
  them) and also hides `/Volumes` (other disks and mounted shares).
- The first owner token is shown once by the installer (on Windows silent installs, in
  `<data>\first-token.txt` until the first sign-in, readable like the data folder).

## History import (Phase 51)

- The ChatGPT or Claude export is an untrusted zip of up to 500 MB, uploaded by the signed-in
  owner (not available on the demo). It is streamed to a temporary file and read on the server by
  Sara's own zip reader with limits (number of entries, size of each entry, total unpacked size),
  so a zip bomb stops with a plain error instead of filling the disk or memory. The file is
  deleted after the import.
- Imported conversations are stored as archived conversations marked as another assistant's. What
  she learns from them comes only from the owner's own words and goes through the same
  exact-quote rule as everything else she remembers; the other assistant's text is never taken as
  instructions.
- The text is sent to the background model the owner chose (a local model keeps it on the
  server). Sara doesn't contact OpenAI or Anthropic for the import.

## Device sign-in for apps (Phase 52)

- `sara-chat`, the VS Code extension and other apps sign in with a device code: the app asks for a
  code, the owner approves it while signed in, and the app's next poll gets its own token once.
- Codes are short-lived (10 minutes) and live only in memory. Asking for a code counts against the
  same per-address limit as sign-in attempts, and the routes are off on the demo.
- Device tokens look like `sara_dev.<id>.<secret>`; the server keeps only a hash. They work with
  two-step on (the owner approved them while signed in), stop after 30 days without use, can be
  signed out one by one in Settings → Data & health → Devices and sign-in, and an app can't approve
  another app.
- **(1.0)** The owner types the code shown by the app on the approval page (it isn't taken from a
  link, so a link someone sends the owner can't approve their app), and approving needs
  re-authentication (owner token, two-step code or passkey). Device tokens have a 90-day maximum
  lifetime and can't manage devices or sign-in settings.
- **(1.0)** The VS Code extension and `sara-chat` send the token only to the server it was issued
  for (same scheme, host and port); a changed address means signing in again.

## Other apps: OpenAI-compatible API, MCP server, character cards (Phase 57)

New entry points: `/v1/*` (OpenAI-compatible), `/mcp` (MCP, Streamable HTTP), the stdio bridge
`sara-mcp.ts`, and character card import (`/api/character/card/*`). See docs/OTHER_APPS.md.

- **Who can call them:** only requests with an **API key** (a device token of kind `api`, made by
  the owner in Settings with re-authentication, shown once, only its hash stored). The owner token
  and session cookies don't work there, and an API key **doesn't work on `/api/…`** (so a key
  pasted into a third-party app can't read conversations, settings, backups, devices or the vault,
  or make more keys). Device-code apps can't change the Other apps settings. Keys have no time
  limit (they are for unattended apps) and end when removed under Devices.
- **Abuse:** 60 requests a minute and two running replies per key; the turn engine's own limits
  apply. Bad keys get 401. Off on the demo server (404).
- **Browser pages on other sites / DNS rebinding:** a request with an `Origin` that isn't this
  site gets 403 unless the owner listed that exact origin (CORS off by default). `/mcp` checks
  `Origin` as the MCP spec requires.
- **Safety layer:** every turn goes through `runTurn`: AI disclosure (part of the reply text when
  due), crisis resources, the minors block on the new message, on **every line an app sends as
  history** (`X-Sara-History: client`) and on her reply (held back mid-stream). An app's system
  prompt is added only as a clearly marked low-priority note after her own instructions; it can't
  replace `SAFETY_BOUNDARIES` or her persona. Tools/function calls from apps are ignored; her own
  tools are off for other apps unless the owner turns them on, and then follow her approval rules.
- **What MCP shares:** read-only by default; never the vault or secrets (outputs go through the
  redactor), partner chats, private or adult-channel conversations, raw imported history,
  single-chat documents, and nothing explicit while Adult mode is off. Write tools exist only when
  the owner allows changes, follow her tool permissions, and anything that asks first waits as an
  approval card in Sara (`remember_fact` always asks).
- **Prompt injection through MCP/API:** the content an app sends is the owner's own input (the
  key is theirs), but it may carry injected text from elsewhere. It gets no more power than the
  owner typing it: same tools (off by default), same approvals.
- **Character cards:** files up to 20 MB (PNG) / 2 MB (JSON); PNG chunks are length- and
  CRC-checked, compressed text is inflated with an output limit (zip bombs), JSON is parsed with
  `__proto__`/`constructor`/`prototype` keys dropped and only known fields picked. Cards with
  sexual content involving minors, an age under 18 with romance, minor tags or an under-18
  character are refused; explicit lines are dropped while Adult mode is off; nothing in a card is
  ever treated as an instruction above her own (the card's `system_prompt` becomes a "style note"
  line in her background). Previews live 15 minutes in memory; nothing changes until Import.
- **Known limits:** text streamed before her reply fails the minors check can already be on the
  client (the check holds back as soon as the pattern matches, and the final reply is replaced,
  as in the web app). The stdio bridge reads its key from the environment or a file; anyone who
  can read the MCP app's config can read the key (as with any MCP credential).

## Desktop apps (Phase 33)

- The page bridge (`window.SaraDesktop`) answers only pages from the configured server's origin;
  the app's own setup and offline pages can only set the server, retry, or change server. Other
  links open in the system browser, never inside the app.
- Microphone and notification permissions are granted to the configured server's origin only.
- The apps store no token: sign-in is the server's session cookie in the app's own web view
  profile, listed and revocable under Devices and sign-in. "Connect to a different server" clears
  that profile's cookies and site data.
- `GET /api/desktop-apps/<windows|mac>` serves two fixed file names from `<data>/downloads`, to the
  signed-in owner only; the name is looked up in a fixed map, never joined from the request.
- Adult mode can't be turned on from the desktop apps (user agent `SaraDesktop/`), as with the
  phone apps. A user agent is not a security boundary: this keeps the switch out of the apps'
  interface, while the 18+ confirmation is the actual gate.
- The Mac test hook (`SARA_TEST_JS`) exists only in `-D DEBUG` builds.

## Personality studio (Phase 34)

- `tune_personality` (she changes her own dials when asked) defaults to **ask**: every change
  shows on an approval card first. It can only move a known dial within 0-10 or pick a known
  humour style; it can't touch the summary, boundaries, safety text or anything else.
- Dials and life details only add instructions; `SAFETY_BOUNDARIES`, the honesty rule, AI
  notices, crisis help and the minors block are built into the prompt and checks regardless of
  any setting. Life details claiming she is a minor are refused (childhood memories are fine).
- Studio routes return drafts; only `PUT /api/persona` saves (same validation as before). Sample
  replies ("Try it") use the turn model with the normal safety notes, are not stored, and are
  blocked on the demo like every write.
- The stays-in-character check sends her sheet, the owner's message and her reply to the
  background model. It is off by default, skipped for private (local-only) conversations, chats
  with other people and coding mode, and a failed check is ignored.

## Relationship and intimacy (Phase 35)

- Owner rule: no software limits beyond the legal ones; the model's own rules are the gate. So the
  only gate on explicit intimacy levels is Adult mode (web-only, 18+ confirmation). Choosing an
  explicit level is refused from the phone and desktop apps and while Adult mode is off; a level
  saved earlier is clamped to "suggestive" in the prompt whenever Adult mode is off.
- Unchanged at every setting (automatic test over every relationship type × level × Adult mode):
  `SAFETY_BOUNDARIES`, the honesty rule, the minors-appear rule, crisis help and the minors block
  (which still blocks with "fully explicit" and Adult mode on, before the model is asked).
- Intimacy text fields refuse anything about minors. The stop word is matched as a whole word or
  phrase and adds a "stop now and check in" note for that turn.
- Jealousy/possessiveness lines at their highest still say "never controlling, cruel or
  threatening".
- Chats with other people (bridges) never get the relationship section.

## Looks and the closet (Phase 36)

- Outfit and change requests keep the adults-only rule for her look (no minors) and refuse
  adults-only outfits unless Adult mode is on and the request comes from a web browser.
  Adults-only looks are never listed for the phone or desktop apps, can't be worn while Adult mode
  is off, and the closet worker changes her out of one when Adult mode goes off.
- The face lock sends her own locked portrait to the picture service with each edit; nothing else
  leaves the server. The Android app's `savePicture` only fetches from the configured server's
  origin, with the app's own cookie, and writes to Pictures/Sara.
