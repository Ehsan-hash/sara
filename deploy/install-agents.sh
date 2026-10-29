#!/usr/bin/env bash
# Optional: installs the official Claude Code and Grok command-line programs that Sara uses for
# "Claude (your subscription)" and "Grok (SuperGrok / X Premium+)". Versions are pinned in
# deploy/agents/package-lock.json and npm verifies every download against its checksum.
# Nothing is installed system-wide; no system packages are touched. ~520 MB in /opt/sara-agents.
#
#   sudo ./deploy/install-agents.sh
#   sudo ./deploy/install-agents.sh --instance work   # another Sara on this server (programs shared)
#
# Then sign in from Settings → Subscriptions (Claude: paste a `claude setup-token` token;
# Grok: "Sign in to Grok" shows a code to confirm at accounts.x.ai).
set -euo pipefail

AGENTS_DIR="${SARA_AGENTS_DIR:-/opt/sara-agents}"
# Several Saras on one server: --instance NAME (or SARA_INSTANCE) picks whose settings to update.
INSTANCE="${SARA_INSTANCE:-sara}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) INSTANCE="${2:-}"; shift 2 ;;
    --instance=*) INSTANCE="${1#*=}"; shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
# shellcheck source=deploy/lib-instance.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-instance.sh"
si_valid_name "$INSTANCE" || { printf 'Not an instance name: %s\n' "$INSTANCE" >&2; exit 2; }
ENV_FILE="/etc/$INSTANCE/$INSTANCE.env"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[1;35m[sara]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[sara]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo ./deploy/install-agents.sh)."
NODE_BIN="$(sed -n 's#^ExecStart=\([^ ]*\) .*#\1#p' /etc/systemd/system/$INSTANCE.service 2>/dev/null | head -1)"
[[ -x "${NODE_BIN:-}" ]] || die "Install Sara first (deploy/install.sh)."
NPM_BIN="$(dirname "$NODE_BIN")/npm"

log "Installing Claude Code and Grok CLI (pinned) into $AGENTS_DIR..."
mkdir -p "$AGENTS_DIR"
cp "$SRC_DIR/deploy/agents/package.json" "$SRC_DIR/deploy/agents/package-lock.json" "$AGENTS_DIR/"
# Install scripts stay off; the only one needed is Claude Code's, which just copies its bundled
# native binary (from the verified platform package) over the placeholder. Run it explicitly.
(cd "$AGENTS_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --ignore-scripts --omit=dev --no-audit --no-fund >/dev/null)
(cd "$AGENTS_DIR" && "$NODE_BIN" node_modules/@anthropic-ai/claude-code/install.cjs >/dev/null)
chown -R root:root "$AGENTS_DIR"
chmod -R go-w "$AGENTS_DIR"

# Grok's package ships its native binary brotli-compressed and normally unpacks it into ~/.grok
# with a launcher that needs a system Node. Unpack it once into $AGENTS_DIR/bin instead.
mkdir -p "$AGENTS_DIR/bin"
"$NODE_BIN" -e '
const fs = require("fs"), zlib = require("zlib");
const [src, dst] = process.argv.slice(1);
fs.writeFileSync(dst + ".tmp", zlib.brotliDecompressSync(fs.readFileSync(src)));
fs.chmodSync(dst + ".tmp", 0o755);
fs.renameSync(dst + ".tmp", dst);
' "$AGENTS_DIR/node_modules/@xai-official/grok-linux-$( [[ "$(uname -m)" == aarch64 ]] && echo arm64 || echo x64 )/bin/grok.br" "$AGENTS_DIR/bin/grok"
ln -sf "$AGENTS_DIR/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$AGENTS_DIR/bin/claude"
CLAUDE="$AGENTS_DIR/bin/claude"
GROK="$AGENTS_DIR/bin/grok"
log "Checking they run on this system as the $INSTANCE user..."
runuser -u "$INSTANCE" -- env HOME=/tmp "$CLAUDE" --version || die "Claude Code does not run on this system."
runuser -u "$INSTANCE" -- env HOME=/tmp "$GROK" --version || die "Grok CLI does not run on this system."

if grep -q '^SARA_AGENTS_DIR=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^SARA_AGENTS_DIR=.*#SARA_AGENTS_DIR=$AGENTS_DIR#" "$ENV_FILE"
else
  echo "SARA_AGENTS_DIR=$AGENTS_DIR" >> "$ENV_FILE"
fi
systemctl restart "$INSTANCE"
log "Done. Sign in under Settings → Subscriptions."
