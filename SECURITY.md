# Security policy

Sara runs on your own server and holds private conversations, memories and the keys to your other
accounts, so security reports are very welcome.

## Supported versions

Security fixes go into the **latest release** only; please update (`sudo sara update`, or
Settings → Data & health → Updates) before reporting.

| Version | Supported |
|---|---|
| Latest release (0.x until 1.0, then 1.x) | Yes |
| Anything older | No: update first |

What that means for you:

- There are no long-term support branches. A fix ships as a new release, and the way to get it is
  to update.
- Updating from any older version straight to the newest is supported and tested: her data is
  brought up to date on the first start, with a backup made first (see
  [docs/INSTALL.md, Upgrading](docs/INSTALL.md#upgrading)).
- Before a big jump, read what changed in [CHANGELOG.md](CHANGELOG.md).

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Report it privately through GitHub: on the repository page open the **Security** tab and choose
**Report a vulnerability** (GitHub's private vulnerability reporting). Only the maintainers can
see the report, and we can work on a fix and an advisory together there. You need a (free) GitHub
account for this. Without one, email **sara@backstagecoding.com** with "Security" in the subject.

For problems that aren't sensitive (a hardening idea, a confusing warning, a broken link in the
docs), a normal [GitHub issue](https://github.com/farena-ai/sara/issues) is fine.

Helpful to include:

- what an attacker can do, and which of the attackers in the threat model it needs (for example
  "someone on the internet with no sign-in" or "a web page she reads");
- the Sara version and how she's installed (Linux service, Docker, Windows, macOS);
- steps to reproduce, ideally against a fresh install with a throwaway data folder;
- never real tokens, keys or personal data: use fake values.

What to expect: an acknowledgement within a few days, a first assessment within two weeks, and
credit in the advisory and release notes if you'd like it. Please give us a reasonable time to
ship a fix before talking about it publicly.

## Scope

In scope: the Sara server (`src/`), the web app (`web/`), the installers and update tools
(`deploy/`), the desktop and phone apps, the terminal and VS Code clients (`clients/`), and the
sandbox around her coding tools.

Especially interesting: sign-in and session bypasses, ways for content she reads (web pages,
emails, files, MCP servers, chat messages from other people) to make her use tools without the
owner's approval, escapes from the workspace or the command sandbox, secrets leaking into logs,
exports, backups or model requests, and anything that defeats the safety layer (AI disclosure,
crisis resources, the minor-content block).

Out of scope: someone who already has root on the server or the owner's unlocked device and owner
token; what model providers do with what is sent to them; denial of service by the signed-in owner;
missing hardening headers with no concrete attack; reports from automated scanners without a
working example.

## How Sara is defended

[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) describes what Sara protects, from whom, and how:
sign-in, the demo mode, the tools and their approvals, the sandbox, the encrypted vault, backups
and the apps. [docs/COMPLIANCE.md](docs/COMPLIANCE.md) covers the safety layer.

## Her security pass over your code (Phase 81)

This is about the code Sara writes for you, not about Sara herself. After a coding turn that
changed files she checks them for common mistakes (secrets in code, commands or SQL built from
input, path traversal, TLS checks off, unsafe deserialization, CORS with credentials, a route
without the file's sign-in check, weak crypto for secrets, HTML from input, debug on), with an
optional second look by the Reviewing model. Every finding must quote a real line of the file or it
is dropped. These are shape checks for textbook mistakes, not an audit, and they only read and fix
your own projects: no scanning of other systems, no exploit or payload generation.

- **Dependency advisories** (OSV.dev) are off until the owner switches them on, after seeing the
  package list; only package names and versions are sent, never code, and never from private
  conversations or private local mode.
- **Fix branches** are local `sara/fix-<id>` branches in a separate worktree; the owner's checked-out
  branch is never touched, and Sara's git calls for them have no push, fetch or remote command at
  all (hooks, credential helpers and prompts are switched off). Publishing still goes through the
  normal approvals.
- **Threat model (Phase 82):** after the same turns she maps the entry points of the project (HTTP
  routes, uploads, message handlers, the command line) and follows them through the project's own
  functions to dangerous lines (shell, SQL, file paths, outgoing requests, unsafe loaders, HTML,
  redirects, eval, secrets in responses), plus routes that change things without a sign-in check
  and sign-in routes without a rate limit. Every threat quotes its entry line and its sink line
  (both checked against the files) and names the path; the Reviewing model may only add threats
  from an entry point the code listed. *Fix these* (the owner's click, never automatic) runs a
  fix-only pass on one local branch: edits outside the threats' functions are refused, the threat
  rule re-checks, the project's tests run in a sandbox copy, one diff to Apply / Keep / Discard,
  nothing pushed. It reads and fixes your own code only; it never probes a running app.
- Everything is owner-only (`/api/findings`, `/api/security-pass`, `/api/threat-model`); household
  members and the demo get 403. Details: [docs/design/HARNESS_TRACK.md § M6, M7](docs/design/HARNESS_TRACK.md).
