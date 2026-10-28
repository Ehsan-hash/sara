# Release checklist (1.0)

Owner decisions are marked **(owner)**; nothing here happens without them.

## Before release

- [ ] **(owner)** Lawyer review of `docs/COMPLIANCE.md` and `docs/DISCLOSURES.md` (age
      verification laws for adult content, SB 243 "operator", subscription terms).
- [ ] **(owner)** Release decision and date.
- [x] MIT `LICENSE`: "Copyright (c) 2026 Frank Arena and Backstage Coding" (owner, 2026-10-26).
- [x] Credits: `docs/CREDITS.md`, and "License and credits" in the in-app guide.
- [ ] Make the public copy: `node scripts/public-export.ts` copies the tracked files into
      `outputs/public-export/` with no git history, leaves out the private notes below, and fails
      on secrets or private machine details (0 found in 0.42.0). The domain backstagecoding.com
      and the farena-ai GitHub stay in the public copy (owner, 2026-10-26). Then create a fresh
      public repository from that folder.
- [x] Scrub owner-specific material from the public repository (left out of the public copy by
      `scripts/public-export.ts`):
  - `docs/ops/DEPLOYMENT.md` (server address, cPanel/Apache details, deploy key alias) → move to a
    private ops note; keep a generic version in `docs/INSTALL.md`.
  - `docs/handoffs/*` and `docs/SOURCE_OF_TRUTH.md` "where things live" (server, URLs, paths).
  - `AGENTS.md` lines about this owner's machines.
  - `evals/results/*` hardware notes (fine to keep, but check for personal data).
  - `git log` check: `git log -p | grep -iE "<owner name>|<server IP>"` (the real values are in the
    private ops notes); decide whether to
    publish history or squash into a fresh public repository (recommended: fresh repo, no history).
- [ ] Secret scan of the whole tree and history (`gitleaks` or a manual `grep -rE "sk-|xai-|
      BEGIN .*PRIVATE|oat01"`). Expect zero hits outside tests' fake values.
- [ ] Persona: `persona/sara.json` uses `{owner}` everywhere (no owner name baked in).
- [ ] Screenshots in `docs/screenshots/` from a clean demo instance (no real conversations).
- [ ] Fresh-machine install test: Debian 12 VM and Ubuntu 24.04 VM (native), Docker on one of them;
      run `npm run check` and the sandbox suite on each. Follow docs/INSTALL.md word for word, and
      also cover:
  - [ ] upgrade from the previous release (install it, sign in, add data, then update): data kept;
  - [ ] HTTPS added later: `sudo SARA_BEHIND_PROXY=1 /opt/sara-src/deploy/install.sh` updates
        `/etc/sara/sara.env` and sign-in works through the proxy (cookies, live replies, live calls);
  - [ ] the updater: `sudo sara update` and Settings → Updates (check, then update) from
        `/opt/sara-src`; a checkout in a home folder gets the "move it" warning;
  - [ ] first sign-in through the SSH tunnel with the token the installer printed;
  - [ ] an arm64 machine (private Node.js download and checksum);
  - [ ] a host without systemd (plain container): the installer stops with the Docker hint and
        changes nothing;
  - [ ] a minimal image (no curl / CA certificates): friendly errors, nothing changed;
  - [ ] Ubuntu 24.04 bubblewrap with the AppArmor profile from INSTALL Troubleshooting;
  - [ ] demo server: runs as `sara-demo` and can't read `/var/lib/sara`;
  - [ ] `sudo sara uninstall` (data kept, reinstall picks it up) and `--delete-data`;
  - [ ] Docker: update (`git pull && docker compose up -d --build`), backup, restore, reset-token,
        behind a proxy with the `.env` file, host Ollama via `host.docker.internal`.
- [ ] Subscription logins re-checked against each provider's terms on release day (they change).
- [ ] Version 1.0.0, CHANGELOG, tag, GitHub release notes linking to DISCLOSURES.md.

## After release

- [ ] Watch issues for install failures on other distributions.
- [ ] Re-verify subscription flows monthly.
