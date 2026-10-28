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
