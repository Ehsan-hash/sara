#!/usr/bin/env bash
# Optional (Phase 49): the browser Sara uses to test the web apps she builds (open the preview,
# click, type, read, take desktop and phone screenshots). Downloads Google's official "Chrome for
# Testing" headless shell for linux-x64, a pinned version checked against a hard-coded SHA-256,
# and unpacks it into /opt/sara-browser. Does not install system packages.
#
#   sudo ./deploy/install-browser.sh          # ~120 MB download, ~275 MB on disk
#   sudo ./deploy/install-browser.sh --remove # takes it out again
#
# Sara finds it on her next start (Settings → Abilities → Browser for testing shows "Found"). It
# runs inside the same bubblewrap sandbox as her commands, with a throwaway profile, and can only
# reach her own previews unless web tools are on.
set -euo pipefail

DIR=/opt/sara-browser
VERSION=156.0.8078.47
URL="https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-headless-shell-linux64.zip"
SHA256=0d5acc62c3e213f8c87d3c298d66ffcf9a236d12ea4b9f85318bf85dbc279daa
BIN="$DIR/chrome-headless-shell-linux64/chrome-headless-shell"

log() { printf '\033[1;35m[sara-browser]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[sara-browser]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo)."
if [[ "${1:-}" == "--remove" ]]; then
  rm -rf "${DIR:?}"
  log "Removed $DIR. Restart Sara (systemctl restart sara) so she notices."
  exit 0
fi
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || die "This build is for Linux x86_64 only. On other systems, set SARA_BROWSER to a Chromium-family browser."
for cmd in curl sha256sum; do command -v "$cmd" >/dev/null || die "Missing required command: $cmd"; done
unpack() {
  if command -v unzip >/dev/null; then unzip -q "$1" -d "$2"
  elif command -v python3 >/dev/null; then python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"
  else die "Need unzip or python3 to unpack the download."; fi
}

if [[ -x "$BIN" && -f "$DIR/VERSION" && "$(cat "$DIR/VERSION")" == "$VERSION" ]]; then
  log "Already installed: Chrome for Testing headless shell $VERSION in $DIR."
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  log "Downloading Chrome for Testing headless shell $VERSION (about 120 MB)..."
  curl -fsSL "$URL" -o "$TMP/shell.zip"
  echo "$SHA256  $TMP/shell.zip" | sha256sum -c --quiet - || die "Checksum mismatch: the download is not the expected file. Nothing was installed."
  # Unpack beside the target and move it into place only when complete.
  part="$DIR.partial"
  rm -rf "$part"; mkdir -p "$part"
  unpack "$TMP/shell.zip" "$part"
  [[ -f "$part/chrome-headless-shell-linux64/chrome-headless-shell" ]] || die "Unexpected contents in the download."
  # zip files don't keep the run bits everywhere: the program and its helpers must be runnable.
  chmod 0755 "$part/chrome-headless-shell-linux64/chrome-headless-shell"
  find "$part/chrome-headless-shell-linux64" -maxdepth 1 -type f \( -name '*.so' -o -name 'chrome_crashpad_handler' \) -exec chmod 0755 {} +
  echo "$VERSION" > "$part/VERSION"
  rm -rf "${DIR:?}"
  mv "$part" "$DIR"
  chmod -R a+rX "$DIR"
  log "Installed into $DIR."
fi

# The shell needs a few common system libraries (NSS, fonts, X11 client libraries that ship on most
# servers). They are not installed here: list any that are missing so the owner can decide.
missing="$(ldd "$BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u | tr '\n' ' ')"
if [[ -n "$missing" ]]; then
  log "The browser needs these system libraries, which this server doesn't have: $missing"
  log "Install them with your package manager (e.g. Debian/Ubuntu: apt install libnss3 libatk-bridge2.0-0 libgbm1 libxkbcommon0 libasound2; Fedora/Alma: dnf install nss atk at-spi2-atk mesa-libgbm libxkbcommon alsa-lib), then restart Sara."
else
  if "$BIN" --headless --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1; then
    log "Test run: ok."
  else
    log "Test run failed; run '$BIN --headless --no-sandbox --dump-dom about:blank' to see why."
  fi
fi
log "Restart Sara so she finds it: systemctl restart sara"
