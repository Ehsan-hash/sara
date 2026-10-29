#!/usr/bin/env bash
# Sara's one-command installer for Linux servers with systemd (Debian/Ubuntu, Fedora/RHEL/Alma/
# Rocky, Arch, openSUSE; x86_64 or arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
#   sudo bash get-sara.sh [options]
#
# It downloads Sara into /opt/sara-src (root's own copy, which `sara update` uses later), checks
# it, asks a few questions (Enter takes the answer in [brackets]), then runs deploy/install.sh.
#
# Options for installs without questions: bash get-sara.sh --help
#
# The only system packages it installs are git, curl and ca-certificates (if missing), plus what
# you choose: bubblewrap, caddy (for your own web address) and bzip2 (for voice). It asks first
# whenever someone is there to answer.

main() {
set -euo pipefail

REPO="${SARA_REPO:-https://github.com/farena-ai/sara.git}"
REF="${SARA_REF:-main}"
# One source copy for every Sara on this server (each instance installs her own copy of the
# program from it into /opt/<name>, and updates only herself).
SRC=/opt/sara-src
INSTANCE="${SARA_INSTANCE:-sara}"

log() { printf '\033[1;35m[sara]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[sara]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[sara]\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Install Sara (asks a few questions; Enter takes the answer in [brackets]):
  curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
  sudo bash get-sara.sh [options]

Options (for installs without questions):
  --yes                    ask nothing, take the suggested answers (and the options given)
  --access HOW             how you'll reach her: tailscale | local | domain | lan
  --domain NAME            your web address, for --access domain (sara.example.com)
  --email ADDRESS          email for Let's Encrypt certificate notices (--access domain)
  --port N                 her port on this machine (default 7860)
  --sandbox | --no-sandbox install bubblewrap, a safer shell for her coding tools (default: yes)
  --voice | --no-voice     local voice on this server, about 650 MB download (default: no)
  --source PATH            install from a local folder or .tar(.gz) instead of downloading
  --instance NAME          another, separate Sara next to an existing one (e.g. work): her own
                           user, data, settings, port, service and admin command, all named NAME
  --help                   this text

Environment: SARA_REPO (git URL or path; default the GitHub repository), SARA_REF (branch or
tag; default main). Change how you reach her later with: sudo sara access
EOF
}

# ---- Options -----------------------------------------------------------------
YES=0 ACCESS="" PORT="" SANDBOX="" VOICE="" SOURCE=""
SARA_DOMAIN="" SARA_EMAIL=""
need_val() { [[ -n "${2:-}" && "${2:0:2}" != -- ]] || die "$1 needs a value (see --help)."; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    --access) need_val "$@"; ACCESS="$2"; shift 2 ;;
    --access=*) ACCESS="${1#*=}"; shift ;;
    --domain) need_val "$@"; SARA_DOMAIN="$2"; shift 2 ;;
    --domain=*) SARA_DOMAIN="${1#*=}"; shift ;;
    --email) need_val "$@"; SARA_EMAIL="$2"; shift 2 ;;
    --email=*) SARA_EMAIL="${1#*=}"; shift ;;
    --port) need_val "$@"; PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --sandbox) SANDBOX=y; shift ;;
    --no-sandbox) SANDBOX=n; shift ;;
    --voice) VOICE=y; shift ;;
    --no-voice) VOICE=n; shift ;;
    --source) need_val "$@"; SOURCE="$2"; shift 2 ;;
    --source=*) SOURCE="${1#*=}"; shift ;;
    --instance) need_val "$@"; INSTANCE="$2"; shift 2 ;;
    --instance=*) INSTANCE="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done
# (the full checks, such as reserved names and existing accounts, run once Sara is downloaded)
if ! [[ ${#INSTANCE} -ge 2 && ${#INSTANCE} -le 32 && "$INSTANCE" =~ ^[a-z][a-z0-9-]*$ && "$INSTANCE" != *- ]]; then
  die "--instance must be 2 to 32 lowercase letters, digits or dashes, starting with a letter (for example: work)."
fi
ENV_FILE="/etc/$INSTANCE/$INSTANCE.env"
# The admin command (and the name in messages) is the instance name.
CMD="$INSTANCE"
ACCESS="${ACCESS,,}"
case "$ACCESS" in ''|tailscale|local|domain|lan) ;; *) die "--access must be tailscale, local, domain or lan." ;; esac
if [[ -n "$PORT" ]] && ! { [[ "$PORT" =~ ^[0-9]+$ ]] && (( 10#$PORT >= 1024 && 10#$PORT <= 65535 )); }; then
  die "--port must be a number from 1024 to 65535."
fi
if [[ -n "$SARA_DOMAIN" && -z "$ACCESS" ]]; then ACCESS=domain; fi
if [[ -n "$SOURCE" ]]; then
  [[ -e "$SOURCE" ]] || die "--source $SOURCE doesn't exist."
  SOURCE="$(realpath "$SOURCE")"
fi

# Questions go to the terminal (/dev/tty), so `curl … | sudo bash` can still ask them.
SA_INTERACTIVE=0
if [[ $YES -eq 0 ]] && (exec </dev/tty) 2>/dev/null; then SA_INTERACTIVE=1; fi
# Nothing below reads the script's own input (with `curl | bash` that is this script).
exec </dev/null

# ---- Checks (nothing is changed before these pass) -----------------------------
[[ $EUID -eq 0 ]] || die "Run as root: curl -fsSL <address of get-sara.sh> | sudo bash   (or: sudo bash get-sara.sh)"
if ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  die "This system isn't running systemd (common in containers and WSL without systemd), so Sara can't be installed as a service here. Use Docker Compose instead: docs/INSTALL.md, 'Docker Compose'."
fi
case "$(uname -m)" in
  x86_64|aarch64|arm64) ;;
  *) die "Unsupported CPU: $(uname -m). Sara's installer supports x86_64 and arm64." ;;
esac
if id "$INSTANCE" >/dev/null 2>&1 && [[ "$(id -u "$INSTANCE")" -ge 1000 ]]; then
  if [[ "$INSTANCE" == sara ]]; then
    die "An ordinary account named 'sara' already exists here (uid $(id -u sara)). Sara needs that name for her own service account; rename the existing account first. Nothing was changed."
  fi
  die "An ordinary account named '$INSTANCE' already exists here (uid $(id -u "$INSTANCE")). Pick another --instance name. Nothing was changed."
fi

# Quick checks of what was asked for on the command line, before anything is downloaded.
if [[ $SA_INTERACTIVE -ne 1 && "$ACCESS" == domain ]]; then
  [[ -n "$SARA_DOMAIN" ]] || die "--access domain needs --domain <your web address>. Nothing was changed."
  if [[ -z "$(getent ahosts "$SARA_DOMAIN" 2>/dev/null || true)" ]]; then
    die "$SARA_DOMAIN doesn't point anywhere yet (no DNS record found), so no HTTPS certificate can be issued for it. At your domain provider, add an 'A' record for it with this server's public IP address, wait a few minutes, then run this again. Nothing was changed."
  fi
fi
if [[ $SA_INTERACTIVE -ne 1 && "$ACCESS" == tailscale ]]; then
  command -v tailscale >/dev/null || die "--access tailscale, but Tailscale isn't installed. Install it (https://tailscale.com/download), sign in with 'sudo tailscale up', then run this again. Nothing was changed."
  [[ "$(tailscale status --json 2>/dev/null || true)" =~ \"BackendState\":[[:space:]]*\"Running\" ]] || die "--access tailscale, but Tailscale isn't signed in. Run 'sudo tailscale up', then run this again. Nothing was changed."
fi

if [[ $SA_INTERACTIVE -eq 1 ]]; then
  log "Welcome! This installs Sara on this server. A few questions follow; just press Enter to"
  log "take the suggestion in [brackets]."
elif [[ $YES -eq 0 ]]; then
  log "No terminal to ask questions on, so the suggested answers are used (add --yes to skip this note)."
fi

ask_yn() {
  # ask_yn "Question" default(y|n): 0 = yes. Uses sa_yes once the library is loaded.
  local a shown
  if [[ $SA_INTERACTIVE -ne 1 ]]; then [[ $2 == y ]]; return; fi
  if [[ $2 == y ]]; then shown=Y/n; else shown=y/N; fi
  while :; do
    printf '%s [%s] ' "$1" "$shown" >/dev/tty
    IFS= read -r a </dev/tty || a=""
    [[ -n "$a" ]] || a=$2
    case "${a,,}" in y|yes) return 0 ;; n|no) return 1 ;; *) printf 'Please answer y or n.\n' >/dev/tty ;; esac
  done
}

# ---- 1. Basic tools (git, curl, CA certificates) ----------------------------------
PM=""
for m in apt-get dnf zypper pacman; do if command -v "$m" >/dev/null; then PM=$m; break; fi; done
pkg_install() {
  case "$PM" in
    apt-get)
      if [[ "${APT_UPDATED:-0}" == 0 ]]; then DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null || return 1; APT_UPDATED=1; fi
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
    dnf) dnf install -y -q "$@" >/dev/null ;;
    zypper) zypper --non-interactive --quiet install "$@" >/dev/null ;;
    pacman) pacman -S --needed --noconfirm "$@" >/dev/null ;;
    *) return 1 ;;
  esac
}
have_ca() {
  local f
  for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem; do
    [[ -s "$f" ]] && return 0
  done
  return 1
}
MISSING=()
command -v git >/dev/null || MISSING+=(git)
command -v curl >/dev/null || MISSING+=(curl)
have_ca || MISSING+=(ca-certificates)
if [[ ${#MISSING[@]} -gt 0 ]]; then
  [[ -n "$PM" ]] || die "Please install ${MISSING[*]} with your package manager, then run this again."
  if ! ask_yn "Sara needs ${MISSING[*]}, which this server doesn't have yet. Install them now (with $PM)?" y; then
    die "Install them yourself, then run this again: $PM install ${MISSING[*]}. Nothing was changed."
  fi
  log "Installing ${MISSING[*]}..."
  pkg_install "${MISSING[@]}" || die "Couldn't install ${MISSING[*]} with $PM. Check this server's internet connection, install them by hand, then run this again."
fi

# ---- 2. Download Sara into /opt/sara-src, and check it ------------------------------
# A copy from --source is unpacked next to the old one and swapped in only when complete.
put_in_place() {
  local new=$1
  [[ -f "$new/src/main.ts" && -f "$new/deploy/install.sh" && -f "$new/deploy/lib-access.sh" ]] || { rm -rf "$new"; die "That doesn't look like a complete copy of Sara (deploy/install.sh or deploy/lib-access.sh missing). Nothing was changed."; }
  chown -R root:root "$new"
  if [[ -e "$SRC" ]]; then
    local old
    old="$SRC.old-$(date +%Y%m%d-%H%M%S)"
    mv "$SRC" "$old"
    log "Kept the previous copy in $old"
  fi
  mv "$new" "$SRC"
}
export GIT_TERMINAL_PROMPT=0
if [[ -n "$SOURCE" ]]; then
  NEW="$SRC.new"
  rm -rf "$NEW"; mkdir -p "$NEW"
  if [[ -f "$SOURCE" ]]; then
    log "Unpacking Sara from $SOURCE..."
    tar -xf "$SOURCE" -C "$NEW" || { rm -rf "$NEW"; die "Couldn't unpack $SOURCE. Nothing was changed."; }
    # A tarball with one top folder (sara-main/…): use that folder.
    if [[ ! -f "$NEW/deploy/install.sh" ]]; then
      mapfile -t TOP < <(find "$NEW" -mindepth 1 -maxdepth 1)
      if [[ ${#TOP[@]} -eq 1 && -f "${TOP[0]}/deploy/install.sh" ]]; then
        mv "${TOP[0]}" "$NEW.inner" && rm -rf "$NEW" && mv "$NEW.inner" "$NEW"
      fi
    fi
  elif [[ -d "$SOURCE/.git" ]]; then
    log "Copying Sara from the git checkout in $SOURCE..."
    rm -rf "$NEW"
    git -c safe.directory="$SOURCE" -c safe.directory="$SOURCE/.git" clone -q --no-hardlinks "$SOURCE" "$NEW" || die "Couldn't copy $SOURCE with git. Nothing was changed."
  else
    log "Copying Sara from $SOURCE..."
    cp -a "$SOURCE/." "$NEW/"
  fi
  put_in_place "$NEW"
elif [[ -d "$SRC/.git" ]]; then
  [[ "$(stat -c %u "$SRC")" == 0 ]] || die "$SRC isn't owned by root, so it can't be used safely for updates. Fix it: sudo chown -R root:root $SRC, then run this again."
  log "Getting the latest Sara into $SRC..."
  git -C "$SRC" fetch -q --tags origin || die "Couldn't reach $(git -C "$SRC" remote get-url origin 2>/dev/null || echo the repository). Check the internet connection, then run this again."
  git -C "$SRC" checkout -q "$REF" || die "Couldn't switch $SRC to '$REF' (local changes there?)."
  if git -C "$SRC" symbolic-ref -q HEAD >/dev/null; then
    git -C "$SRC" merge -q --ff-only '@{u}' 2>/dev/null || die "$SRC has changes of its own, so it can't be updated automatically. Look at: git -C $SRC status"
  fi
elif [[ -e "$SRC" ]]; then
  die "$SRC already exists but isn't a git copy of Sara. Move it away (sudo mv $SRC $SRC.old) or use --source, then run this again."
else
  log "Downloading Sara from $REPO..."
  if ! git clone -q --branch "$REF" "$REPO" "$SRC.new"; then
    rm -rf "$SRC.new"
    die "Couldn't download Sara from $REPO. Check this server's internet connection. (If the repository isn't public yet, copy it to this server and use: --source <folder or .tar>.) Nothing was changed."
  fi
  put_in_place "$SRC.new"
fi
[[ -f "$SRC/src/main.ts" && -f "$SRC/deploy/install.sh" && -f "$SRC/deploy/lib-access.sh" ]] || die "The copy in $SRC is incomplete (deploy/install.sh missing)."
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"
log "Sara ${VERSION:-?}$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null | sed 's/^/ (/;s/$/)/' || true) is ready to install."

if [[ -f "$SRC/deploy/lib-instance.sh" ]]; then
  # shellcheck source=deploy/lib-instance.sh
  . "$SRC/deploy/lib-instance.sh"
  si_set "$INSTANCE"
  if [[ "$INSTANCE" != sara ]]; then
    WHY="$(si_check_name "$INSTANCE" 2>&1)" || die "$WHY"
  fi
else
  [[ "$INSTANCE" == sara ]] || die "This copy of Sara ($SRC) is too old to install a second Sara (--instance). Update it first. Nothing was installed."
  SI_NAME=sara
fi
# shellcheck source=deploy/lib-access.sh
. "$SRC/deploy/lib-access.sh"
# Is port $1 used by another Sara here (her settings), when the library knows?
port_of_other() { declare -F si_port_assigned >/dev/null && si_port_assigned "$1"; }

# ---- 3. Questions ----------------------------------------------------------------
CUR_PORT="$(sa_env_get SARA_PORT)"
SARA_RUNNING=0
systemctl is-active --quiet "$INSTANCE" 2>/dev/null && SARA_RUNNING=1
# The suggested port: the one she has, else 7860 for the default Sara, else the next free one.
DEF_PORT="${CUR_PORT:-}"
if [[ -z "$DEF_PORT" ]]; then
  if [[ "$INSTANCE" == sara ]]; then DEF_PORT=7860; else DEF_PORT="$(si_pick_port)" || die "No free port from 7860 up."; fi
fi

# (a) How will you reach her?
if sa_ts_running; then DEF_ACCESS=tailscale; else DEF_ACCESS=local; fi
if [[ -f "$ENV_FILE" ]] && grep -q '^SARA_ACCESS=' "$ENV_FILE"; then DEF_ACCESS="$(sa_env_get SARA_ACCESS)"; fi
while :; do
  if [[ -z "$ACCESS" ]]; then
    if [[ $SA_INTERACTIVE -eq 1 ]]; then
      sa_say ""
      sa_say "How will you reach her?"
      sa_say "  1) Tailscale: private to your own devices, works from your phone anywhere, HTTPS done for you$(sa_ts_installed || echo ' (install Tailscale first)')"
      sa_say "  2) Just this computer (from another computer: through an SSH tunnel)"
      sa_say "  3) My own web address, with HTTPS set up for you"
      sa_say "  4) My home network (plain HTTP: only on a network you trust)"
      case "$DEF_ACCESS" in tailscale) d=1 ;; domain) d=3 ;; lan) d=4 ;; *) d=2 ;; esac
      sa_ask a "Choose 1-4" "$d"
      case "$a" in 1|tailscale) ACCESS=tailscale ;; 2|local) ACCESS=local ;; 3|domain) ACCESS=domain ;; 4|lan) ACCESS=lan ;; *) sa_say "Please type 1, 2, 3 or 4."; continue ;; esac
    else
      ACCESS="$DEF_ACCESS"
    fi
  fi
  if sa_check "$ACCESS" "${PORT:-$DEF_PORT}"; then break; fi
  [[ $SA_INTERACTIVE -eq 1 ]] || die "Can't set up '$ACCESS' (see above). Nothing was installed or changed: run this again once that's fixed, or choose another way (--access local)."
  sa_say "Let's pick another way (you can change it later with: sudo $CMD access)."
  ACCESS="" SARA_DOMAIN="" SARA_EMAIL="" DEF_ACCESS=local
done

# (b) Safer shell for her coding tools.
HAVE_BWRAP=0; command -v bwrap >/dev/null && HAVE_BWRAP=1
if [[ $HAVE_BWRAP -eq 1 ]]; then
  SANDBOX=y
elif [[ -z "$SANDBOX" ]]; then
  if sa_yes "Safer shell for her coding tools (installs bubblewrap, recommended)?" y; then SANDBOX=y; else SANDBOX=n; fi
fi

# (c) Voice on this server.
# Local voice lives in /opt/sara-voice and is shared by every Sara here; install-voice.sh
# --instance points this instance at it (and only downloads what is missing).
if [[ "$(uname -m)" != x86_64 ]]; then
  [[ "$VOICE" == y ]] && warn "Local voice is x86_64 only for now; skipping it (cloud voices work in Settings → Voice)."
  VOICE=n
elif [[ -z "$VOICE" ]]; then
  if [[ -x /opt/sara-voice/voice.json || -f /opt/sara-voice/voice.json ]]; then
    VOICE=n
  elif sa_yes "Voice on this server, so speech never leaves it (downloads about 650 MB)?" n; then VOICE=y; else VOICE=n; fi
fi

# (d) Port.
while :; do
  if [[ -z "$PORT" ]]; then sa_ask PORT "Port on this machine" "$DEF_PORT"; fi
  if ! sa_valid_port "$PORT"; then
    warn "The port must be a number from 1024 to 65535."
  elif sa_port_busy "$PORT" && ! [[ $SARA_RUNNING -eq 1 && "$PORT" == "$DEF_PORT" ]]; then
    warn "Something else is already using port $PORT."
  elif [[ "$PORT" != "${CUR_PORT:-}" ]] && port_of_other "$PORT"; then
    warn "Port $PORT belongs to another Sara on this server."
  else
    break
  fi
  [[ $SA_INTERACTIVE -eq 1 ]] || die "Pick another port with --port N. Nothing was installed or changed."
  PORT=""
done

# ---- 4. Summary --------------------------------------------------------------------
PKGS=()
[[ "$SANDBOX" == y && $HAVE_BWRAP -eq 0 ]] && PKGS+=(bubblewrap)
[[ "$VOICE" == y ]] && ! command -v bzip2 >/dev/null && PKGS+=(bzip2)
sa_say ""
log "About to install Sara ${VERSION:-}$([[ "$INSTANCE" == sara ]] || echo " as '$INSTANCE'") with:"
log "  Reach her:      $(sa_mode_label "$ACCESS")$([[ $ACCESS == domain ]] && echo " at https://$SARA_DOMAIN")$([[ $ACCESS == tailscale ]] && echo " at $(sa_ts_url "$(sa_ts_https_port "$PORT")")")"
log "  Safer shell:    $([[ $SANDBOX == y ]] && echo yes || echo no)"
log "  Local voice:    $([[ $VOICE == y ]] && echo 'yes (about 650 MB)' || echo no)"
log "  Port:           $PORT"
log "  Files:          program in /opt/$INSTANCE, your data in /var/lib/$INSTANCE, settings in /etc/$INSTANCE"
[[ "$INSTANCE" == sara ]] || log "  Admin command:  sudo $CMD (service $INSTANCE.service)"
[[ ${#PKGS[@]} -gt 0 || "${SA_NEED_CADDY:-0}" == 1 ]] && log "  Also installs:  ${PKGS[*]}$([[ "${SA_NEED_CADDY:-0}" == 1 ]] && echo ' caddy') (from $PM)"
if [[ $SA_INTERACTIVE -eq 1 ]] && ! sa_yes "Go ahead?" y; then
  die "Stopped. Nothing was installed (the downloaded copy stays in $SRC; run this again any time)."
fi

# ---- 5. Install -----------------------------------------------------------------------
if [[ ${#PKGS[@]} -gt 0 ]]; then
  log "Installing ${PKGS[*]}..."
  if ! pkg_install "${PKGS[@]}"; then
    warn "Couldn't install ${PKGS[*]}; going on without. Later: $(sa_pkg_hint "${PKGS[@]}")"
    [[ " ${PKGS[*]} " == *" bzip2 "* ]] && VOICE=n
  fi
fi
# Ubuntu 23.10+ only lets programs with an AppArmor profile use the sandboxing feature bubblewrap
# needs. A profile for bubblewrap alone (not the system-wide switch) fixes that.
if [[ "$SANDBOX" == y ]] && command -v bwrap >/dev/null && [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" == 1 ]] \
   && command -v apparmor_parser >/dev/null && [[ ! -f /etc/apparmor.d/bwrap ]]; then
  BWRAP_PATH="$(command -v bwrap)"
  cat > /etc/apparmor.d/bwrap <<EOF
abi <abi/4.0>,
include <tunables/global>
profile bwrap ${BWRAP_PATH} flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
  if apparmor_parser -r /etc/apparmor.d/bwrap 2>/dev/null; then
    log "Allowed bubblewrap its sandbox under Ubuntu's AppArmor rules (/etc/apparmor.d/bwrap)."
  else
    warn "Couldn't load /etc/apparmor.d/bwrap now; it takes effect after a reboot."
  fi
fi
sa_prepare "$ACCESS"

log "Installing Sara (about a minute)..."
INSTANCE_ENV=()
[[ "$INSTANCE" == sara ]] || INSTANCE_ENV=(SARA_INSTANCE="$INSTANCE")
env ${INSTANCE_ENV[@]+"${INSTANCE_ENV[@]}"} SARA_ACCESS="$ACCESS" SARA_ACCESS_CHECKED=1 SARA_PORT="$PORT" SARA_DOMAIN="$SARA_DOMAIN" SARA_EMAIL="$SARA_EMAIL" \
  bash "$SRC/deploy/install.sh" || die "The install didn't finish (see above). Fix that and run this again; your data, if any, is untouched."

if [[ "$VOICE" == y ]]; then
  log "Installing local voice (about 650 MB; this takes a while)..."
  bash "$SRC/deploy/install-voice.sh" --instance "$INSTANCE" || warn "Local voice didn't install (see above). Sara works without it; try again later: sudo $SRC/deploy/install-voice.sh --instance $INSTANCE"
fi
log "All done. Sign in with the owner token above, then the setup guide takes you through the rest."
}

main "$@"
