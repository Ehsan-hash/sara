#!/usr/bin/env bash
# Native install / upgrade of Sara as a systemd service on any systemd Linux distribution
# (Debian/Ubuntu, Fedora/RHEL/AlmaLinux/Rocky, Arch, openSUSE, ...).
#
#   sudo git clone https://github.com/farena-ai/sara /opt/sara-src
#   sudo /opt/sara-src/deploy/install.sh                       # install or upgrade
#   sudo SARA_BEHIND_PROXY=1 /opt/sara-src/deploy/install.sh   # (any time) Sara is behind an HTTPS reverse proxy
#
# The guided installer (deploy/get-sara.sh) runs this script with SARA_ACCESS=local|tailscale|
# domain|lan (plus SARA_PORT, SARA_DOMAIN, SARA_EMAIL) to also set up how she's reached
# (deploy/lib-access.sh; later: sudo sara access).
#
# Re-running upgrades the code in /opt/sara and keeps /var/lib/sara (your data) untouched.
# Sara uses her own pinned, checksum-verified Node.js in /opt/sara/node, so she never depends on
# (or changes) a Node.js that other software on the server uses. SARA_USE_SYSTEM_NODE=1 uses the
# system's Node.js 24+ instead (not recommended: other packages decide when it changes, and one
# under /home can't be reached by the hardened service).
set -euo pipefail

APP_DIR=/opt/sara
DATA_DIR=/var/lib/sara
ENV_FILE=/etc/sara/sara.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=24
# Pinned Node.js release (newest 24.x in https://nodejs.org/dist/index.json when last bumped) and
# the SHA-256 of each build from that release's SHASUMS256.txt. Bump all three together.
NODE_VERSION=v24.22.1
NODE_SHA256_x64=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c
NODE_SHA256_arm64=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3

log() { printf '\033[1;35m[sara]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[sara]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[sara]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- Checks (nothing is changed before these pass) ---------------------------
[[ $EUID -eq 0 ]] || die "Run as root (sudo ./deploy/install.sh)."
if ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  die "This system isn't running systemd (common in containers, WSL without systemd and some minimal images), so the native install can't work here. Use Docker Compose instead: docs/INSTALL.md, 'Docker Compose'."
fi
[[ -f "$SRC_DIR/src/main.ts" ]] || die "Run this script from a Sara checkout."
for cmd in curl tar gzip sha256sum; do
  command -v "$cmd" >/dev/null || die "Missing required command: $cmd (install it with your package manager, e.g. apt install $cmd or dnf install $cmd)"
done
CA_OK=0
for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem; do
  if [[ -s "$f" ]]; then CA_OK=1; break; fi
done
[[ $CA_OK -eq 1 ]] || die "No CA certificates found, so secure (HTTPS) downloads would fail. Install them first: sudo apt install ca-certificates (or: sudo dnf install ca-certificates), then run this again."
# Never take over an ordinary account that happens to be called sara (a person on this server).
if id sara >/dev/null 2>&1 && [[ "$(id -u sara)" -ge 1000 ]]; then
  die "An ordinary (non-system) account named 'sara' already exists (uid $(id -u sara)). Sara needs that name for her own locked-down service account; rename the existing account first. Nothing was changed."
fi

# Read a value from sara.env, without surrounding quotes.
env_get() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}
# Set (or add) KEY=VALUE in sara.env, keeping every other line.
env_set() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# ---- Node.js runtime -------------------------------------------------------
NODE_BIN=""
if [[ "${SARA_USE_SYSTEM_NODE:-0}" == 1 ]]; then
  if ! command -v node >/dev/null || [[ "$(node_major node)" -lt $NODE_MAJOR ]]; then
    die "SARA_USE_SYSTEM_NODE=1 but there is no Node.js $NODE_MAJOR+ on PATH."
  fi
  NODE_BIN="$(readlink -f "$(command -v node)")"
  case "$NODE_BIN" in
    /home/*|/root/*|/run/user/*) die "The system Node.js is in $(dirname "$NODE_BIN"), which the hardened service can't reach. Leave SARA_USE_SYSTEM_NODE unset to use Sara's own Node.js." ;;
  esac
  log "Using system Node.js $(node -v) at $NODE_BIN (SARA_USE_SYSTEM_NODE=1)"
else
  case "$(uname -m)" in
    x86_64) ARCH=x64; SUM="$NODE_SHA256_x64" ;;
    aarch64|arm64) ARCH=arm64; SUM="$NODE_SHA256_arm64" ;;
    *) die "Unsupported CPU architecture: $(uname -m) (the installer supports x86_64 and arm64)." ;;
  esac
  if [[ -x "$APP_DIR/node/bin/node" && "$("$APP_DIR/node/bin/node" -v 2>/dev/null)" == "$NODE_VERSION" ]]; then
    log "Private Node.js $NODE_VERSION already installed."
  else
    FILE="node-${NODE_VERSION}-linux-${ARCH}.tar.gz"
    log "Installing private Node.js $NODE_VERSION to $APP_DIR/node (system Node is left alone)..."
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    if ! curl -fsSL --retry 3 --connect-timeout 20 "https://nodejs.org/dist/${NODE_VERSION}/${FILE}" -o "$TMP/$FILE"; then
      if [[ -x "$APP_DIR/node/bin/node" && "$(node_major "$APP_DIR/node/bin/node")" -ge $NODE_MAJOR ]]; then
        warn "Couldn't reach nodejs.org; keeping Node.js $("$APP_DIR/node/bin/node" -v) already in $APP_DIR/node."
      else
        die "Couldn't download Node.js from nodejs.org. Check this server's internet connection and DNS (try: curl -I https://nodejs.org), then run the installer again. Nothing was changed."
      fi
    else
      echo "$SUM  $TMP/$FILE" | sha256sum -c --quiet - || die "Node.js checksum mismatch: the download was damaged or tampered with. Nothing was changed."
      mkdir -p "$APP_DIR"
      rm -rf "$APP_DIR/node.new"
      mkdir "$APP_DIR/node.new"
      tar -xzf "$TMP/$FILE" -C "$APP_DIR/node.new" --strip-components=1
      rm -rf "$APP_DIR/node"
      mv "$APP_DIR/node.new" "$APP_DIR/node"
    fi
  fi
  NODE_BIN="$APP_DIR/node/bin/node"
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"

# ---- User, code, data ------------------------------------------------------
if ! id sara >/dev/null 2>&1; then
  log "Creating system user 'sara'..."
  useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin sara
fi

log "Installing application to $APP_DIR..."
mkdir -p "$APP_DIR"
for item in src web persona templates package.json package-lock.json; do
  rm -rf "${APP_DIR:?}/$item"
  cp -r "$SRC_DIR/$item" "$APP_DIR/"
done
SRC_OWNER="$(stat -c %u "$SRC_DIR")"
if [[ -d "$SRC_DIR/.git" ]] && command -v git >/dev/null; then
  git -C "$SRC_DIR" rev-parse --short HEAD > "$APP_DIR/REVISION" 2>/dev/null || rm -f "$APP_DIR/REVISION"
fi
(cd "$APP_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
chown -R root:root "$APP_DIR"

mkdir -p "$DATA_DIR" /etc/sara
chown sara:sara "$DATA_DIR"
chmod 700 "$DATA_DIR"
PROXY_CHANGED=0
if [[ ! -f "$ENV_FILE" ]]; then
  PROXY="${SARA_BEHIND_PROXY:-0}"; [[ "$PROXY" == 1 ]] || PROXY=0
  cat > "$ENV_FILE" <<EOF
# Sara settings. Restart after editing: systemctl restart sara
SARA_HOST=${SARA_HOST:-127.0.0.1}
SARA_PORT=${SARA_PORT:-7860}
# 1 when Sara is served over HTTPS through a reverse proxy on this machine.
SARA_SECURE_COOKIES=${PROXY}
SARA_TRUST_PROXY=${PROXY}
EOF
  chmod 640 "$ENV_FILE"
elif [[ -n "${SARA_BEHIND_PROXY:-}" ]]; then
  # The documented order is "install, then add HTTPS": a re-run with SARA_BEHIND_PROXY updates just
  # these two lines of the existing settings and keeps every other line.
  PROXY="$SARA_BEHIND_PROXY"; [[ "$PROXY" == 1 ]] || PROXY=0
  if [[ "$(env_get SARA_SECURE_COOKIES)" != "$PROXY" || "$(env_get SARA_TRUST_PROXY)" != "$PROXY" ]]; then
    env_set SARA_SECURE_COOKIES "$PROXY"
    env_set SARA_TRUST_PROXY "$PROXY"
    PROXY_CHANGED=1
    log "Set SARA_SECURE_COOKIES=$PROXY and SARA_TRUST_PROXY=$PROXY in $ENV_FILE (other settings kept)."
  else
    log "Proxy settings in $ENV_FILE already match SARA_BEHIND_PROXY=$PROXY."
  fi
fi

# How she's reached (guided install): Tailscale serve, a Caddy site, or plain local/home network.
GUIDED=0
if [[ -n "${SARA_ACCESS:-}" ]]; then
  GUIDED=1
  SA_INTERACTIVE=0
  # shellcheck source=deploy/lib-access.sh
  . "$SRC_DIR/deploy/lib-access.sh"
  ACCESS_PORT="${SARA_PORT:-$(env_get SARA_PORT)}"; ACCESS_PORT="${ACCESS_PORT:-7860}"
  sa_valid_port "$ACCESS_PORT" || die "SARA_PORT must be a number from 1024 to 65535."
  if [[ "${SARA_ACCESS_CHECKED:-0}" != 1 ]]; then
    sa_check "$SARA_ACCESS" "$ACCESS_PORT" || die "Can't set up '$SARA_ACCESS' (see above). Sara's settings were kept as they were."
    sa_prepare "$SARA_ACCESS"
  fi
  sa_apply "$SARA_ACCESS" "$ACCESS_PORT"
fi

# Admin command (sara status/update/backup/restore/logs/access) and where `sara update` pulls from.
install -m 755 "$SRC_DIR/deploy/sara" /usr/local/bin/sara
install -m 644 "$SRC_DIR/deploy/lib-access.sh" "$APP_DIR/lib-access.sh"
UPDATES_OK=1
if [[ -d "$SRC_DIR/.git" ]]; then
  if [[ "$SRC_OWNER" == 0 ]]; then
    echo "$SRC_DIR" > /etc/sara/source-dir
  else
    # Updates run git as root in this folder. git refuses a checkout owned by another user
    # ("dubious ownership"), and rightly: that user could plant hooks or config in .git that root
    # would then run. Marking it safe.directory for root would hand that user root, so the
    # installer doesn't; the checkout must be root's own. It is not recorded, and the end of this
    # script tells the user the one command that moves it.
    UPDATES_OK=0
    rm -f /etc/sara/source-dir
  fi
fi
mkdir -p "$DATA_DIR/backups"
chown sara:sara "$DATA_DIR/backups"
chmod 700 "$DATA_DIR/backups"

# ---- systemd ---------------------------------------------------------------
sed "s#@NODE@#$NODE_BIN#g" "$SRC_DIR/deploy/sara.service" > /etc/systemd/system/sara.service
chmod 644 /etc/systemd/system/sara.service
# Phase 23: updates from Settings. Sara (an unprivileged user) can only drop a one-word request
# file ("check" or "update"); root does the work with `sara web-request`.
install -d -o root -g sara -m 750 /var/lib/sara-updater
rm -f "$DATA_DIR/update-status.json" "$DATA_DIR/update-status.json.tmp" # (older place, inside sara's folder)
install -m 644 "$SRC_DIR/deploy/sara-updater.path" /etc/systemd/system/sara-updater.path
install -m 644 "$SRC_DIR/deploy/sara-updater.service" /etc/systemd/system/sara-updater.service
systemctl daemon-reload
systemctl enable sara >/dev/null
systemctl enable --now sara-updater.path >/dev/null 2>&1 || log "Couldn't enable sara-updater.path (updates from Settings won't work; sara update still does)."

START_TS="$(date +%s)"
systemctl restart sara

# Health check on the address Sara listens on (loopback when she listens on every address).
PORT="$(env_get SARA_PORT)"; PORT="${PORT:-7860}"
HOST="$(env_get SARA_HOST)"
case "$HOST" in ''|0.0.0.0|::|'[::]') HOST=127.0.0.1 ;; esac
if [[ "$HOST" == *:* && "$HOST" != \[* ]]; then HOST="[$HOST]"; fi
HEALTH="http://${HOST}:${PORT}/api/health"
for _ in $(seq 1 30); do
  curl -fsS "$HEALTH" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "$HEALTH" >/dev/null 2>&1 || die "Sara failed to start. Check: journalctl -u sara -n 50"

log "Sara $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$APP_DIR/package.json" | head -1) is running on ${HOST}:${PORT}"
# First start: the server writes the one-time owner token to <data>/first-token.txt (0600, owned
# by sara; deleted after the first sign-in). Read it as sara, so a planted symlink can't make root
# print some other file.
TOKEN=""
for _ in $(seq 1 10); do
  if [[ -f "$DATA_DIR/first-token.txt" ]]; then
    TOKEN="$(runuser -u sara -- head -c 200 "$DATA_DIR/first-token.txt" 2>/dev/null | tr -d '\r\n ' || true)"
    break
  fi
  sleep 0.5
done
if [[ -n "$TOKEN" ]]; then
  log ""
  log "Your owner token (sign in with it, then keep it in a password manager):"
  log "    $TOKEN"
  log ""
elif journalctl -u sara --no-pager --since "@${START_TS}" 2>/dev/null | grep -q 'owner token'; then
  log "First start: your owner token was printed once. View it with:"
  log "  sudo journalctl -u sara --no-pager | grep -A1 'owner token' | tail -1"
fi
if [[ $PROXY_CHANGED -eq 1 ]]; then log "HTTPS proxy settings are active (Sara was restarted with them)."; fi
# How to sign in the first time: only until the owner has (afterwards an update stays short).
if [[ $GUIDED -eq 1 ]] || { [[ -n "$TOKEN" ]] && grep -q '^SARA_ACCESS=' "$ENV_FILE"; }; then
  if ! declare -F sa_print_next >/dev/null; then
    SA_INTERACTIVE=0
    # shellcheck source=deploy/lib-access.sh
    . "$SRC_DIR/deploy/lib-access.sh"
  fi
  sa_print_next
elif [[ -n "$TOKEN" ]]; then
  log "Next steps:"
  log "  On this machine:     open http://127.0.0.1:${PORT}"
  log "  From your computer:  ssh -L ${PORT}:127.0.0.1:${PORT} ${SUDO_USER:-you}@<this-server's-address>"
  log "                       then open http://localhost:${PORT} (Sara only listens on this server)"
  log "  Phones and everyday remote use: set up HTTPS, docs/INSTALL.md section 2."
fi
log "Manage her with: sudo sara status | sudo sara update | sudo sara backup | sudo sara restore <file> | sudo sara logs"
log "Lost the token? sudo sara reset-token"
if [[ $UPDATES_OK -eq 0 ]]; then
  warn "This checkout ($SRC_DIR) isn't owned by root, so 'sara update' and Settings → Updates can't"
  warn "use it (git won't run as root in another user's folder; that protects root). Move it once:"
  warn "  sudo mv '$SRC_DIR' /opt/sara-src && sudo chown -R root:root /opt/sara-src && sudo /opt/sara-src/deploy/install.sh"
fi
if ! command -v bwrap >/dev/null; then
  log "Tip: for a safer shell for her coding tools, install bubblewrap and restart:"
  if command -v apt-get >/dev/null; then log "  sudo apt install bubblewrap && sudo systemctl restart sara"
  elif command -v dnf >/dev/null; then log "  sudo dnf install bubblewrap && sudo systemctl restart sara"
  else log "  (install the 'bubblewrap' package) then: sudo systemctl restart sara"; fi
fi
