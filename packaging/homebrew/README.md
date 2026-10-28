# Homebrew cask

`sara.rb` is a [Homebrew cask](https://docs.brew.sh/Cask-Cookbook) for the Mac app (`Sara-<version>.dmg`
from the GitHub Release). It is meant for a tap repository, **farena-ai/homebrew-tap**, not for
homebrew/cask itself (that needs a notable, already-public project; apply there later if wanted).

Users then install with:

```sh
brew install --cask farena-ai/tap/sara
```

## At each release (owner)

1. After the GitHub Release exists: `node scripts/update-packaging.ts <version>` fills `version` and
   `sha256` here from `outputs/release/<version>/SHA256SUMS`.
2. First time only: create the public repository `farena-ai/homebrew-tap` with a `Casks/` folder.
3. Copy `packaging/homebrew/sara.rb` to `Casks/sara.rb` in the tap, then check it on a Mac:

   ```sh
   brew tap farena-ai/tap
   brew audit --cask --strict --online farena-ai/tap/sara
   brew style farena-ai/tap/sara
   brew install --cask farena-ai/tap/sara && brew uninstall --cask farena-ai/tap/sara
   ```

4. Commit and push the tap.

The cask's `url` only works once the release is public (the sara repository is private until 1.0).
The DMG is signed and notarized by `desktop/mac/build.sh`; Homebrew no longer installs unsigned apps
without warnings, so release only notarized DMGs.
