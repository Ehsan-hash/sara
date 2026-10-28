# Packaging and releasing Sara (maintainer guide)

How a Sara release gets to the places self-hosters look: GitHub Releases, the GitHub container
registry, Homebrew, winget and the self-hosting app stores (Unraid, CasaOS, Umbrel, TrueNAS,
Proxmox). Everything here is a **manual** step the owner runs at release time: there is no CI and
no automatic publishing (owner rule: no GitHub Actions or paid services without permission). Every
script below only builds or prints until a step is explicitly marked as publishing.

## What lives where

| Path | What |
|---|---|
| `Dockerfile` | the container image: Node.js pinned to the same release as `deploy/install.sh`, OCI labels, health check on `/api/health`, data volume `/data`, port 7860 |
| `scripts/release-docker.sh` | builds the image with `docker buildx`; pushes `ghcr.io/farena-ai/sara:<version>` and `:latest` (linux/amd64 + linux/arm64) **only with `--push`** |
| `scripts/release-assets.sh` | collects installers, source tarball and VS Code extension into `outputs/release/<version>/`, writes `SHA256SUMS` and `notes.md`, prints the `gh release create` command |
| `scripts/update-packaging.ts` | fills version + checksums into the cask and winget manifests, and the image tag/version into the app templates |
| `packaging/homebrew/` | Homebrew cask for the Mac DMG (tap `farena-ai/homebrew-tap`) |
| `packaging/winget/` | winget manifests in `manifest/` (`BackstageCoding.Sara`, schema 1.10) |
| `packaging/unraid/` | Unraid Community Applications template |
| `packaging/casaos/` | CasaOS / ZimaOS app (compose + `x-casaos`) |
| `packaging/umbrel/` | Umbrel app (`umbrel-app.yml` + compose) |
| `packaging/truenas/` | TrueNAS SCALE custom app (Install via YAML) |
| `packaging/proxmox/` | Proxmox VE helper script (Debian 12 LXC + `get-sara.sh`) |

Each `packaging/*/README.md` explains how to test and submit that one. `test/packaging.test.ts`
checks they all agree on image name, port and version, and that the release scripts can't push by
accident.

## Release steps, in order

Version `X.Y.Z` = `package.json`'s (`CHANGELOG.md` has its `## X.Y.Z` section). Run from the
repository root on the dev PC (git-bash) unless a step says Mac.

1. **Export the public copy** (no private notes, scanned for secrets):

   ```sh
   node scripts/public-export.ts
   ```

   It must end with "No secrets or private machine details found". The source tarball is made
   from this copy.

2. **Build the installers** (the version comes from `package.json`):

   ```sh
   bash desktop/windows/build-installer.sh        # → outputs/windows/Sara-Setup-X.Y.Z.exe
   node scripts/pack-vscode.ts                    # → outputs/vscode/sara-vscode-<ext version>.vsix
   # on the Mac (signed + notarized):
   bash desktop/mac/build.sh                      # → desktop/mac/build/Sara-X.Y.Z.dmg
   ```

   Copy the DMG to `outputs/mac/Sara-X.Y.Z.dmg` on the dev PC.

3. **Collect the release files** (publishes nothing):

   ```sh
   bash scripts/release-assets.sh X.Y.Z --strict
   ```

   Check `outputs/release/X.Y.Z/notes.md` and `SHA256SUMS`.

4. **Create the GitHub Release** (publishing): tag, push the tag, then run the
   `gh release create …` command that step 3 printed. Use `--draft` first if you want to look at
   it on GitHub before it goes out.

5. **Push the container image** (publishing). Once per machine, sign in to the registry with a
   token that has `write:packages`:

   ```sh
   gh auth refresh -s write:packages
   gh auth token | docker login ghcr.io -u <github user> --password-stdin
   bash scripts/release-docker.sh                 # local build + try it first (port 7860)
   bash scripts/release-docker.sh --push          # amd64 + arm64 → ghcr.io/farena-ai/sara:X.Y.Z and :latest
   docker buildx imagetools inspect ghcr.io/farena-ai/sara:X.Y.Z   # shows the digest
   ```

   First push only: on GitHub, *Packages → sara → Package settings*: make it **public** and link it
   to the `farena-ai/sara` repository.

6. **Fill the packaging** from the release's checksums:

   ```sh
   node scripts/update-packaging.ts X.Y.Z --image-digest sha256:<digest from step 5>
   winget validate --manifest outputs/release/X.Y.Z/winget/manifests/b/BackstageCoding/Sara/X.Y.Z
   npm run check
   ```

   Commit the updated `packaging/` files.

7. **Submit to the stores** (publishing; each folder's README has the details):
   - **Homebrew:** copy `outputs/release/X.Y.Z/homebrew/sara.rb` to `Casks/sara.rb` in
     `farena-ai/homebrew-tap`, `brew audit --cask --strict --online`, push.
   - **winget:** PR the folder `outputs/release/X.Y.Z/winget/manifests/b/BackstageCoding/Sara/X.Y.Z`
     to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) (or `wingetcreate submit`).
   - **Unraid:** publish the template and submit it at https://ca.unraid.net/submit/new (first
     time); later releases need nothing (`:latest`).
   - **CasaOS:** PR `Apps/Sara/` to IceWhaleTech/CasaOS-AppStore.
   - **Umbrel:** PR `sara/` to getumbrel/umbrel-apps.
   - **TrueNAS:** the custom-app YAML needs no submission; the catalog is optional (see its README).
   - **Proxmox:** the script runs from the public repository; listing it in community-scripts is
     optional (see its README).

## Notes

- **Why the container starts as root:** Sara's server starts as the container's root only to run
  her shell commands and MCP servers as the separate `sara-tools` user, which can't read her data
  (keys, database). Every capability except six is dropped and `no-new-privileges` is set (in
  `docker-compose.yml` and every template). Running the container as a plain user works too, but
  then her commands can read her keys. TrueNAS's catalog and Umbrel reviewers may ask about this.
- **Owner token in app stores:** the first owner token is printed in the container log. App-store
  users read it from their platform's log view; Umbrel's store asks for browser-only setup, which
  would need a change in Sara.
- **Nothing works before the repository is public:** release URLs, raw template URLs and the icon
  URL point at `github.com/farena-ai/sara`, which is private until 1.0.
