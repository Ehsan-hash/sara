# Sara for Mac and Windows (Phase 33)

Native apps around your own Sara server. They use the system's web view (WebKit on a Mac, Microsoft
Edge WebView2 on Windows), so there is no bundled browser. The Windows app is about 0.5 MB. Since
Phase 46d the Mac app also carries Sara's server and its own Node (the DMG is about 105 MB), so the
same download either sets her up on that Mac or connects to a Sara elsewhere (docs/INSTALL.md → Mac).
Since Phase 55 the Windows installer offers the same two choices (below).

What they add over a browser tab:

| | Mac | Windows |
|---|---|---|
| Keeps running when the window is closed | menu bar icon | icon next to the clock |
| Notifications (messages, reminders, calls) when the window isn't in front | ✓ | ✓ |
| Clicking a notification opens that conversation | ✓ | ✓ |
| A call brings the window to the front | ✓ | ✓ |
| Start when you sign in | Login Items | Start with Windows |
| Microphone for calls and voice messages | ✓ (asks once) | ✓ |
| Camera on video calls, if you turn it on (Phase 69; [VIDEO_CALLS.md](VIDEO_CALLS.md)) | ✓ (asks once) | ✓ |
| Settings → Connections → This computer | ✓ | ✓ |
| Several Sara servers, each signed in, switched from a menu (Phase 68) | ✓ (macOS 14+) | ✓ |

## Several servers (Phase 68)

Both apps keep a list of Sara servers, each with its own sign-in (Windows: its own WebView2
profile; Mac: its own WebKit data store), and switch without signing out: the tray icon's list
(Windows) or the menu bar's *Sara server* menu (Mac), and the **⇄** button in the app's top bar
once there are two. *Add a Sara…* replaces *Connect to a different Sara…* (which used to sign out
of the old server); *Remove* signs out of one server only. The server used before 1.8 becomes the
first in the list, still signed in. Notifications, the microphone and files you pick go to the
server in use only, and the desktop apps notify for that server only. Details for every app:
[SERVERS.md](SERVERS.md).

## Two ways to use the apps (Phase 55)

The first question, worded the same on both systems: **Run Sara on this computer** (Mac: *this
Mac*; her server and the app) or **Connect to a Sara somewhere else** (the app only, for a Sara on
another computer or server). Remote mode shows everything on that server live, exactly like a local
install: every conversation, notifications, calls bringing the window up, the microphone, opening a
conversation from a notification, start at sign-in. Addresses without `https://` or `http://` get
HTTPS, except `localhost`, `*.local` and IP addresses (a home network, Tailscale's `100.x`), which get
HTTP (the Windows installer, the Windows app and the Mac app use the same rule).

- **Windows:** `Sara-Setup.exe`'s first page. *Connect to a Sara somewhere else* installs only
  `Sara.exe` for you (`%LOCALAPPDATA%\Programs\Sara`, Start menu entry, Settings → Apps entry; no
  administrator, no Node, no server files, no service, no `sara` command on the PATH, no data folder,
  no firewall rule), asks *Where is your Sara?* and writes the address to
  `%LOCALAPPDATA%\Sara\desktop.ini`, so the first start opens her sign-in with a code. Setup starts
  without administrator rights so this question comes first; *Run Sara on this computer* → *as a
  Windows service* starts Setup again as administrator (`/ALLUSERS /MODE=service`). Updates keep the
  mode (the first page pre-selects what's installed); running Setup again and choosing *Run Sara on
  this computer* turns an app-only install into a full one. The other way round, uninstall first (her
  data stays). Uninstalling an app-only install removes the app, its settings and its sign-in here;
  no server's data is touched. Silent: `Sara-Setup.exe /VERYSILENT /MODE=remote
  /SERVER=sara.example.com`.
- **The Windows app** (any install): tray menu → *Add a Sara…* and the list of saved servers
  (Phase 68: each in its own web view profile, so no server receives another's sign-in; before 1.8
  this was *Connect to a different Sara…*, which signed out of the old one), and a *Can't reach your
  Sara* page with the address, *Try again*, *Add a Sara* and the other saved servers. There are no server items (start, stop, logs) in its
  menu; with her server on the same PC, `sara status` and `sara logs` do that.
- **Mac:** the first launch shows the two choices. The menu bar's *Sara server* menu switches later
  without reinstalling: the saved servers (Phase 68), *Add a Sara…*, and when connected elsewhere
  *Set up Sara on this Mac…*; when she runs on the Mac, *Connect to a Sara somewhere else instead…* (after a confirm:
  she stops and her LaunchAgent is unregistered; her data stays in
  `~/Library/Application Support/Sara` until `sara uninstall --delete-data`, and *Set up Sara on this
  Mac…* brings her back as she was).

## Private: everything on this computer (Phase 67)

In *Run Sara on this computer* mode both installers ask one more thing: **Private: everything on
this computer** or **Use cloud models too** (Windows: the page *Where may Sara's AI run?*, after the
port; Mac: the *Where her AI runs* tick box in the setup sheet; not asked on updates or in *Connect to
a Sara somewhere else*). Private writes `SARA_PRIVATE_LOCAL=start` to her settings file (`sara.env`
on Windows, `service/server.env` on a Mac): *Nothing leaves this computer* is then on from her first
start until the owner turns it off. Silent Windows install: `/PRIVATE=1`. The installer passes it on
as `sara setup … --private start|off`.

The apps themselves need nothing more: Settings → Models → **On this computer** (part of the web
app) finds Ollama, suggests a model for the computer's graphics card or memory and downloads it, and
holds the switch. A **🔒 Only this computer** badge shows in the top bar while it's on. What the
switch guarantees and what it can't (her commands on Windows, the web view's own updates, the system
itself): [PRIVATE_LOCAL.md](PRIVATE_LOCAL.md). Servers can set `SARA_PRIVATE_LOCAL=1` (always on) or
`SARA_PRIVATE_LOCAL=start` themselves.

## Sara on this Mac (Phase 46d)

On first launch the Mac app asks *Run Sara on this Mac* (how you reach her, the port) or *Connect to
a Sara somewhere else*. How it works:

- `Contents/Resources/server` (src, web, persona, package.json, LICENSE) and
  `Contents/Resources/node` (one universal `node`, lipo'd from the official arm64 and x64 builds of
  the pinned version, SHA-256 checked, plus npm for her commands).
- A launchd job inside the bundle, registered with `SMAppService`:
  `Contents/Library/LaunchAgents/com.backstagecoding.sara.server.plist` ("while you're signed in").
  It runs `Sara --run-server`, a small supervisor in the app's own program: it reads
  `~/Library/Application Support/Sara/service/server.env`, starts Node with the server, restarts it
  after a crash, and honours Stop/Start (a `service/stopped` file) without administrator rights.
  Node's stdout is discarded (the one-time owner key is only in `first-token.txt`); its stderr and
  the supervisor's lines go to `logs/service.log`.
- Phase 55: the "from startup" LaunchDaemon was removed (owner decision for 1.0: only "while you're
  signed in"). An update from a Mac that used it (`SARA_MAC_RUN=daemon`) unregisters the daemon,
  stops it and registers the agent with the same data and settings; `sara setup --mode daemon` says
  the option was removed and uses the agent. The supervisor refuses to run as root.
- Upgrades: when the app's server version differs from `service/version`, the app restarts the
  supervisor (SIGHUP → exit 1 → launchd starts the new copy), which backs her data up to
  `backups/before-<version>-….tar.gz` before the new server starts.
- If Sara's switch in System Settings → General → Login Items is off, the agent answers "Operation
  not permitted" with status *requires approval*; the app opens Login Items and waits.
- `Sara --cli <command>` is the `sara` command (installed from the menu into `~/.local/bin`).

## Signing in

1. Choose *Connect to a Sara somewhere else* (the Windows installer's first page or the Mac app's
   first launch) and type your server address (for example `sara.example.com`).
2. On a device where you're already signed in: Settings → Devices and sign-in → **Add a phone or
   computer**, and type the code in the app.

The app keeps only the server addresses and its own settings. Each sign-in is that server's session
cookie, stored in the app's own web view profile for that server; sign it out from Settings →
Devices and sign-in like any other device, or remove the server in the app (Phase 68). Adult mode can't be turned on from the apps (web browser only).

## Building

**Windows** (Visual Studio 2022 Build Tools with C++, CMake):

```
bash desktop/windows/build.sh            # → build/Release/Sara.exe and SaraService.exe
bash desktop/windows/build-installer.sh  # → outputs/windows/Sara-Setup-<version>.exe
```

`build.sh` downloads the WebView2 SDK once (pinned version, SHA-256 checked) into
`desktop/windows/third_party/` (not committed). `build-installer.sh` also downloads, once and
checked the same way, Node.js (the version `deploy/install.sh` pins; only `node.exe` is shipped) and
Inno Setup 6 (build time only, unpacked in portable mode inside `third_party/`), stages the server
files (`src`, `web`, `persona`, `package.json`, `LICENSE`) with the two programs and `sara.cmd`, and
compiles `desktop/windows/installer/sara.iss`.

### Sara-Setup.exe: her server and the app together (Phase 46c)

What the Windows installer puts on the computer (details for owners: docs/INSTALL.md → Windows):

| | Service (default) | Only while signed in |
|---|---|---|
| Program | `C:\Program Files\Sara` | `%LOCALAPPDATA%\Programs\Sara` |
| Her data | `C:\ProgramData\Sara` (service account, administrators, SYSTEM only) | `%LOCALAPPDATA%\Sara\data` |
| Starts | service **Sara**, `NT SERVICE\Sara`, delayed automatic start, restart on failure | HKCU Run entry "Sara server" |
| `sara` command | on the system PATH (run it as administrator) | on your PATH |

Inside the program folder: `Sara.exe` (this app), `SaraService.exe`, `node\node.exe`, `server\`
(her code), `bin\sara.cmd`, and `sara.env` (her settings: `SARA_DATA`, `SARA_PORT`, `SARA_HOST`,
`SARA_ACCESS`, `SARA_PUBLIC_URL`, …; changed by `sara access`, read at every start).

`SaraService.exe` (desktop/windows/src/service.cpp) is a small service host: as the Windows service
(`--service`) or in the signed-in session (`--run`) it starts `node\node.exe server\src\main.ts`
with the variables from `sara.env`, starts her again with a growing pause (2 s … 60 s) if she stops by
herself, keeps everything she starts in a job object (it all ends with her), and stops her cleanly by
closing her stdin (`SARA_STOP_ON_STDIN_END=1` makes the server shut down as on SIGTERM; she's killed
only after 20 s). Its own lines and her error output go to `<data>\logs\service.log`; her normal log
is `<data>\logs\sara.log`. Her normal output (where the owner token is printed) is not kept: the
installer reads the token from `<data>\first-token.txt`. Other switches: `--start`, `--stop`,
`--state`, `--install-service`, `--remove-service`, `--port-free N`, `--lan-ip`.

When the app sits next to `SaraService.exe` it doesn't install itself and its *Uninstall* opens the
installer's uninstaller. The installer pre-sets the app's server address to
`http://127.0.0.1:<port>` (`%LOCALAPPDATA%\Sara\desktop.ini`, only when it was empty or already a
local address) and *Open Sara* passes `--server http://127.0.0.1:<port>`. A stand-alone `Sara.exe`
that installed itself into the same folder is taken over (its own uninstall entry is removed). The
stand-alone app's uninstall now keeps a `data` folder it finds in `%LOCALAPPDATA%\Sara` (a server's
data) and removes only its own files.

**Mac** (Xcode command line tools), on the Mac:

```
bash desktop/mac/build.sh            # → desktop/mac/build/Sara.app, Sara.dmg and Sara-<version>.dmg
```

It needs the repository's `src`, `web`, `persona`, `package.json` and `LICENSE` next to `desktop/`
(they go into the app), downloads the two pinned Node builds once into `~/Library/Caches/sara-build`
(`SARA_BUILD_CACHE`) and checks their SHA-256. The app's version is `package.json`'s. It signs with
a "Developer ID Application" certificate when the keychain has one: hardened runtime, Node first with
`node.entitlements` (`allow-jit` and `allow-unsigned-executable-memory`, which V8 needs), then the
app; and notarizes when `NOTARY_PROFILE` names a stored `notarytool` profile (`SARA_NOTARIZE=0`
skips it). Without a certificate it signs ad hoc. There's no Developer ID *Installer* certificate,
so the download is a DMG, not a .pkg.

To keep signing separate from your login keychain, put the certificate and the `notarytool`
profile in a keychain of their own, `~/Library/Keychains/sara-signing.keychain-db`, and point
`SARA_KEYCHAIN_PASS_FILE` at a file (mode 600, outside the repository) holding its password:
`build.sh` then unlocks it, signs with a timestamp, notarizes and staples, so the DMG opens on any
Mac without warnings.

## Offering them for download

Put the files in the server's data folder; Settings → Devices and sign-in then shows a
*Download for Mac / Windows* button in a web browser on that kind of computer:

```
/var/lib/sara/downloads/Sara.exe
/var/lib/sara/downloads/Sara.dmg
```

Only the signed-in owner can download them (`GET /api/desktop-apps/windows|mac`).

## Installing

- **Windows, with her server on the same PC:** run `Sara-Setup.exe` (above, and docs/INSTALL.md →
  Windows) and choose *Run Sara on this computer*. It installs the app too.
- **Windows, for a Sara somewhere else:** run `Sara-Setup.exe` and choose *Connect to a Sara
  somewhere else* (the app only, no administrator).
- **Windows, app only, without the installer:** open `Sara.exe`. It copies itself to `%LOCALAPPDATA%\Programs\Sara`, adds a Start
  menu entry, appears in Settings → Apps (with Uninstall) and starts. No administrator rights.
  Until the app is signed with a code-signing certificate, Windows SmartScreen says "Windows
  protected your PC": choose **More info → Run anyway**.
  Uninstall removes the app, its shortcut, the start-with-Windows entry and its data on the PC.
- **Mac:** open `Sara.dmg` and drag Sara to Applications. The DMG is signed with a Developer ID
  and notarized, so it opens like any downloaded app. (An ad-hoc build from a Mac without the
  certificate needs right-click Sara → **Open** the first time.)

## Testing without a screen

The Mac app has test hooks compiled only into `-D DEBUG` builds (`SARA_DEBUG=1 bash
desktop/mac/build.sh`): `SARA_TEST_JS=<file>` runs that script after each page load and appends the
result to `SARA_TEST_OUT`; `SARA_TEST_SETUP=agent,local,7861` runs the first-launch setup without the
sheet and skips the owner-key sheet. Release builds don't contain them. The server side can be
driven entirely over SSH with `Sara.app/Contents/MacOS/Sara --cli setup|status|stop|start|uninstall…`
(`SMAppService.agent` registers fine from an SSH session). The Windows app can be driven with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` and `--portable` (runs
without installing itself). Phase 68: a test build (`cmake -DSARA_TEST_HOOKS=ON`, never for
release) also honours `SARA_DESKTOP_TEST_DIR=<folder>` (its own settings, web view profiles and
single-instance lock), so it runs next to the real app without touching its sign-ins. Phase 55 was checked that way: the installer in remote mode
(`/VERYSILENT /CURRENTUSER /MODE=remote /SERVER=http://127.0.0.1:<port>` against a scratch server),
then pairing with a code, *Connect to a different Sara…*, the unreachable page and the uninstall.
