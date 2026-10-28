#!/usr/bin/env bash
# Installs a DEMO copy of Sara next to the real one (Phase 16): for app-store review and for
# letting people try Sara. It runs the same code as /opt/sara with its own data folder and port,
# and SARA_DEMO=1: anyone can try it without a token, each visitor's conversations are private and
# never saved, settings are read-only, and there is a daily message limit.
#
#   sudo deploy/install-demo.sh [port]        (default 7861, or the port it already uses)
#
# The demo runs as its own system user, sara-demo, and can't see the real Sara's data
# (/var/lib/sara) or settings (/etc/sara/sara.env): a visitor who got the demo to run something
# still couldn't reach your conversations or keys.
#
# Then point a web address at it through your reverse proxy (see docs/INSTALL.md → "Demo server")
# and give it a model (same section).
set -euo pipefail
log() { printf '[sara-demo] %s\n' "$*"; }
die() { printf '[sara-demo] %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Run as root: sudo $0"
# The same Node.js the real Sara uses (install.sh may have chosen the private or a system one).
NODE_BIN="$(sed -n 's#^ExecStart=\([^ ]*\) .*#\1#p' /etc/systemd/system/sara.service 2>/dev/null | head -1 || true)"
[[ -x "${NODE_BIN:-}" && -f /opt/sara/src/main.ts ]] || die "Install Sara first (deploy/install.sh)."
DATA=/var/lib/sara-demo
ENV=/etc/sara/sara-demo.env
UNIT=/etc/systemd/system/sara-demo.service

if id sara-demo >/dev/null 2>&1; then
  [[ "$(id -u sara-demo)" -lt 1000 ]] || die "An ordinary account named 'sara-demo' already exists; rename it first."
else
  log "Creating system user 'sara-demo'..."
  useradd --system --user-group --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin sara-demo
fi
install -d -m 700 -o sara-demo -g sara-demo "$DATA"
# Older demos ran as sara: hand their files over.
chown -R sara-demo:sara-demo "$DATA"

if [[ ! -f "$ENV" ]]; then
  PORT="${1:-7861}"
  cat > "$ENV" <<EOF
# Sara DEMO server settings. Restart after editing: systemctl restart sara-demo
SARA_DEMO=1
SARA_HOST=127.0.0.1
SARA_PORT=$PORT
# Messages per day for all visitors together (keeps the model bill small).
SARA_DEMO_DAILY=300
# Live calls for app review: only with this reviewer code (unset = no calls), 5 minutes a call,
# this many call minutes a day for everyone together. Needs the demo's own Grok sign-in.
#SARA_DEMO_CALL_CODE=
#SARA_DEMO_CALL_MINUTES_PER_DAY=30
SARA_SECURE_COOKIES=1
SARA_TRUST_PROXY=1
EOF
  chmod 640 "$ENV"
  log "Wrote $ENV"
else
  if [[ -n "${1:-}" ]]; then
    if grep -q '^SARA_PORT=' "$ENV"; then sed -i "s#^SARA_PORT=.*#SARA_PORT=$1#" "$ENV"; else echo "SARA_PORT=$1" >> "$ENV"; fi
    log "Port set to $1 in $ENV"
  fi
  PORT="$(grep -E '^SARA_PORT=' "$ENV" | tail -1 | cut -d= -f2- | tr -d "\"'")"
  PORT="${PORT:-7861}"
fi
[[ "$PORT" =~ ^[0-9]+$ ]] || die "Not a port number: $PORT"

sed -e 's|^Description=.*|Description=Sara demo server (for trying Sara and app review)|' \
    -e 's|^User=sara$|User=sara-demo|' -e 's|^Group=sara$|Group=sara-demo|' \
    -e "s|SARA_DATA=/var/lib/sara$|SARA_DATA=$DATA|" \
    -e "s|SARA_PORT=7860|SARA_PORT=$PORT|" \
    -e "s|EnvironmentFile=-/etc/sara/sara.env|EnvironmentFile=-$ENV|" \
    -e "s|^ReadWritePaths=/var/lib/sara$|ReadWritePaths=$DATA\nInaccessiblePaths=-/var/lib/sara -/etc/sara/sara.env -/var/lib/sara-updater|" \
    -e 's|^StateDirectory=sara$|StateDirectory=sara-demo|' \
    -e 's|^MemoryHigh=.*|MemoryHigh=768M|' -e 's|^MemoryMax=.*|MemoryMax=1G|' -e 's|^CPUQuota=.*|CPUQuota=100%|' \
    /etc/systemd/system/sara.service > "$UNIT"
grep -q '^User=sara-demo$' "$UNIT" && grep -q '^InaccessiblePaths=' "$UNIT" || die "Couldn't build $UNIT from sara.service (re-run deploy/install.sh first)."
systemctl daemon-reload
systemctl enable sara-demo >/dev/null
START=$(date +%s)
systemctl restart sara-demo
ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  if systemctl is-failed --quiet sara-demo; then break; fi
  sleep 0.5
done
[[ $ok -eq 1 ]] || die "The demo isn't answering on port $PORT: journalctl -u sara-demo -n 50"
log "The demo server is running on 127.0.0.1:$PORT."
TOKEN=""
for _ in $(seq 1 10); do
  if [[ -f "$DATA/first-token.txt" ]]; then
    TOKEN="$(runuser -u sara-demo -- head -c 200 "$DATA/first-token.txt" 2>/dev/null | tr -d '\r\n ' || true)"
    break
  fi
  sleep 0.5
done
if [[ -n "$TOKEN" ]]; then
  log "Its owner token (the app-review sign-in): $TOKEN"
elif journalctl -u sara-demo --since "@$START" --no-pager | grep -q "owner token"; then
  log "Its owner token (the app-review sign-in) was printed in the log: journalctl -u sara-demo --since \"@$START\" --no-pager"
fi
