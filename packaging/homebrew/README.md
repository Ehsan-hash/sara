# Homebrew cask

`sara.rb` is a [Homebrew cask](https://docs.brew.sh/Cask-Cookbook) for the Mac app (`Sara-<version>.dmg`
from the GitHub Release). It is meant for a tap repository, **farena-ai/homebrew-tap**, not for
homebrew/cask itself (that needs a notable project; apply there later if wanted).

Users then install with:

```sh
brew install --cask farena-ai/tap/sara
```

`outputs/homebrew-tap/` is the tap repository, ready to push: `Casks/sara.rb` (1.0.0, filled from
the release's `SHA256SUMS`; the checksum matches the DMG on the GitHub Release), `README.md`,
`LICENSE`. Not checked with `brew audit` yet: the Mac has no Homebrew installed and it wasn't
installed for this.

## At each release (owner)

1. After the GitHub Release exists: `node scripts/update-packaging.ts <version>` fills `version` and
   `sha256` here from `outputs/release/<version>/SHA256SUMS` (and writes
   `outputs/release/<version>/homebrew/sara.rb`).
2. First time only: create the public repository `farena-ai/homebrew-tap` and push
   `outputs/homebrew-tap/` to `main`.
3. Later releases: copy `packaging/homebrew/sara.rb` to `Casks/sara.rb` in the tap, then check it on
   a Mac with Homebrew:

   ```sh
   brew tap farena-ai/tap
   brew audit --cask --strict --online farena-ai/tap/sara
   brew style farena-ai/tap/sara
   brew install --cask farena-ai/tap/sara && brew uninstall --cask farena-ai/tap/sara
   ```

4. Commit and push the tap. No review and no GitHub Actions: a tap is ours.

The DMG is signed and notarized by `desktop/mac/build.sh`; Homebrew no longer installs unsigned apps
without warnings, so release only notarized DMGs.
