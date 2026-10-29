# shellcheck shell=bash
# Several Saras on one server: the names and places of one instance. Shared by deploy/install.sh,
# deploy/get-sara.sh and the tests. Sourced, never run; it changes nothing by itself.
#
# An instance is a name (default "sara"; 2-32 characters: lowercase letters, digits and dashes,
# starting with a letter). Everything else follows from it:
#
#   system user and group   <name>
#   program                 /opt/<name>            (own copy of the code and its own Node.js)
#   data                    /var/lib/<name>
#   settings                /etc/<name>/<name>.env (and /etc/<name>/instance, /etc/<name>/source-dir)
#   service                 <name>.service
#   updates from Settings   <name>-updater.path / <name>-updater.service, status in /var/lib/<name>-updater
#   admin command           /usr/local/bin/<name>
#   port                    7860 for the default; others take the next free one (or --port N)
#
# The default name gives exactly the paths a single install has always used.

SI_DEFAULT=sara
SI_FIRST_PORT=7860
# Tests point these at a scratch folder (only honoured by install.sh --dry-run).
: "${SI_ROOT:=}"

# Names that would take over a system account, a well-known command or another instance's
# folders (/opt/sara-src, /opt/sara-voice, ... and <name>-updater, <name>-src).
SI_RESERVED=" root daemon bin sys sync games man lp mail news uucp proxy www-data backup list irc gnats nobody nogroup
  admin administrator operator adm wheel sudo staff users user guest ftp sshd ssh systemd messagebus dbus polkitd
  syslog tss uuidd avahi colord cups postfix exim dovecot named bind ntp chrony apache httpd nginx caddy tailscale
  tailscaled mysql mariadb postgres redis mongodb docker podman containerd ollama node npm git test local opt etc var
  tmp home srv usr lib run proc dev boot mnt media snap
  sara-src sara-demo sara-voice sara-agents sara-browser sara-node sara-soak sara-root sara-updater "

# Is $1 a well-formed instance name? (no system checks; see si_check_name)
si_valid_name() { [[ ${#1} -ge 2 && ${#1} -le 32 && $1 =~ ^[a-z][a-z0-9-]*$ && $1 != *- && $1 != *--* ]]; }
si_reserved_name() {
  [[ $SI_RESERVED == *" $1 "* || $1 == *-updater || $1 == *-src || $1 == systemd-* ]]
}

# si_set NAME: sets every name and path of that instance (globals, see the list above).
si_set() {
  SI_NAME=$1
  SI_USER=$1
  SI_GROUP=$1
  SI_APP_DIR=/opt/$1
  SI_DATA_DIR=/var/lib/$1
  SI_ETC_DIR=/etc/$1
  SI_ENV_FILE=/etc/$1/$1.env
  SI_INSTANCE_FILE=/etc/$1/instance
  SI_SOURCE_FILE=/etc/$1/source-dir
  SI_UNIT=$1.service
  SI_UNIT_FILE=/etc/systemd/system/$1.service
  SI_UPDATER_PATH=$1-updater.path
  SI_UPDATER_SERVICE=$1-updater.service
  SI_UPDATER_DIR=/var/lib/$1-updater
  SI_ADMIN=/usr/local/bin/$1
  SI_CADDY_TAG=$1
}

# Value of KEY in an env file, without quotes.
si_file_get() {
  local v
  v="$(grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

# Ports other Sara instances on this machine already use (one per line): every SARA_PORT in
# /etc/*/*.env (sara.env, sara-demo.env, <name>.env) and every Environment=SARA_PORT= in a
# systemd unit, except this instance's own env file and unit.
si_assigned_ports() {
  local f
  for f in "$SI_ROOT"/etc/*/*.env; do
    [[ -f $f && $f != "$SI_ROOT$SI_ENV_FILE" ]] || continue
    si_file_get "$f" SARA_PORT; echo
  done
  for f in "$SI_ROOT"/etc/systemd/system/*.service; do
    [[ -f $f && $f != "$SI_ROOT$SI_UNIT_FILE" ]] || continue
    grep -q 'src/main.ts' "$f" 2>/dev/null || continue
    sed -n 's/^Environment=SARA_PORT=\([0-9]*\).*/\1/p' "$f"
  done
}
# (grep reads everything: with -q it could stop early and, under pipefail, report "not found")
si_port_assigned() { si_assigned_ports | grep -x "$1" >/dev/null; }
# Is something listening on TCP port $1 (IPv4 or IPv6)?
si_port_listening() {
  local hex f files=()
  hex="$(printf '%04X' "$1")"
  # (only files that exist: awk fails on a missing one, e.g. tcp6 with IPv6 off)
  for f in "$SI_ROOT/proc/net/tcp" "$SI_ROOT/proc/net/tcp6"; do [[ -r $f ]] && files+=("$f"); done
  [[ ${#files[@]} -gt 0 ]] || return 1
  awk -v p=":$hex" '$4 == "0A" && toupper(substr($2, length($2) - 4)) == p { found = 1 } END { exit !found }' "${files[@]}" 2>/dev/null
}
si_port_taken() { si_port_listening "$1" || si_port_assigned "$1"; }
# First port from 7860 up that nothing listens on and no other instance has.
si_pick_port() {
  local p=$SI_FIRST_PORT
  while (( p <= 65535 )); do
    if ! si_port_taken "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  return 1
}

# Tailscale gives the whole machine one name, so each instance gets its own HTTPS port on it:
# the default instance 443, every other one 8443 + (its port - 7860).
si_ts_https_port() {
  local port=${1:-$SI_FIRST_PORT}
  if [[ $SI_NAME == "$SI_DEFAULT" ]]; then echo 443; return; fi
  if (( port >= SI_FIRST_PORT && port < SI_FIRST_PORT + 1000 )); then echo $((8443 + port - SI_FIRST_PORT)); else echo $((port + 1000)); fi
}

# Does an existing account / command / folder named like this instance belong to a Sara?
# (Lets the installer adopt a hand-built instance and refuse to take over anything else.)
si_is_ours() {
  local home
  [[ -f $SI_INSTANCE_FILE || -f $SI_ENV_FILE || -f $SI_APP_DIR/src/main.ts ]] && return 0
  home="$(getent passwd "$SI_USER" 2>/dev/null | cut -d: -f6 || true)"
  [[ -n $home && $home == "$SI_DATA_DIR" ]]
}
# Is the existing /usr/local/bin/<name> Sara's: ours, or a hand-made one for this same instance
# (it names both /opt/<name> and /var/lib/<name>)? Only then may the installer replace it.
si_admin_is_ours() {
  [[ -f $SI_ADMIN ]] || return 1
  grep -q 'Sara admin command' "$SI_ADMIN" 2>/dev/null && return 0
  grep -q "/opt/$SI_NAME\b" "$SI_ADMIN" 2>/dev/null && grep -q "/var/lib/$SI_NAME\b" "$SI_ADMIN" 2>/dev/null
}
# si_check_name NAME: prints why NAME can't be used and returns 1, or returns 0.
si_check_name() {
  local n=$1 uid c
  if ! si_valid_name "$n"; then
    echo "'$n' can't be an instance name: use 2 to 32 lowercase letters, digits or dashes, starting with a letter (for example: work)."
    return 1
  fi
  if [[ $n != "$SI_DEFAULT" ]] && si_reserved_name "$n"; then
    echo "'$n' is reserved (a system account, a well-known program or one of Sara's own folders). Pick another name."
    return 1
  fi
  si_set "$n"
  if id "$n" >/dev/null 2>&1; then
    uid="$(id -u "$n")"
    if [[ $uid -ge 1000 ]]; then
      echo "An ordinary (non-system) account named '$n' already exists (uid $uid). Each Sara needs her own locked-down service account of that name; pick another name. Nothing was changed."
      return 1
    fi
    if [[ $n != "$SI_DEFAULT" ]] && ! si_is_ours; then
      echo "A system account named '$n' already exists and doesn't belong to a Sara (no $SI_ENV_FILE, no $SI_APP_DIR). Pick another name. Nothing was changed."
      return 1
    fi
  fi
  if [[ $n != "$SI_DEFAULT" ]]; then
    if [[ -e $SI_ADMIN ]] && ! si_admin_is_ours; then
      echo "$SI_ADMIN already exists and isn't Sara's admin command. Pick another name. Nothing was changed."
      return 1
    fi
    c="$(command -v "$n" 2>/dev/null || true)"
    if [[ -n $c && $c != "$SI_ADMIN" ]]; then
      echo "There is already a command called '$n' ($c); Sara's admin command would hide it. Pick another name. Nothing was changed."
      return 1
    fi
  fi
  return 0
}

# Every Sara instance installed here (names, one per line), from /etc/<name>/instance and the
# default install (which may predate those files).
si_list() {
  local f
  {
    [[ -f $SI_ROOT/etc/sara/sara.env ]] && echo sara
    for f in "$SI_ROOT"/etc/*/instance; do
      [[ -f $f ]] && si_file_get "$f" SARA_INSTANCE && echo
    done
  } | sed '/^$/d' | sort -u
}

# si_render_unit NODE_BIN PORT < deploy/sara.service: the service unit for this instance. The
# default instance gets the template unchanged (only @NODE@ filled in), byte for byte.
si_render_unit() {
  local node=$1 port=$2 n=$SI_NAME
  if [[ $n == "$SI_DEFAULT" ]]; then
    sed "s#@NODE@#$node#g"
    return
  fi
  sed -e "s#@NODE@#$node#g" \
    -e "s|^# Template: .*|# Sara instance '$n' (built by deploy/install.sh from deploy/sara.service).|" \
    -e "s|^Description=.*|Description=Sara AI companion ($n)|" \
    -e "s|^User=sara$|User=$n|" -e "s|^Group=sara$|Group=$n|" \
    -e "s|^WorkingDirectory=/opt/sara$|WorkingDirectory=/opt/$n|" \
    -e "s|^Environment=SARA_DATA=/var/lib/sara$|Environment=SARA_DATA=/var/lib/$n|" \
    -e "s|^Environment=SARA_PORT=7860$|Environment=SARA_PORT=$port|" \
    -e "s|^EnvironmentFile=-/etc/sara/sara.env$|EnvironmentFile=-/etc/$n/$n.env|" \
    -e "s| /opt/sara/src/main.ts$| /opt/$n/src/main.ts|" \
    -e "s|^# drop-in: systemctl edit sara$|# drop-in: systemctl edit $n|" \
    -e "s|^ReadWritePaths=/var/lib/sara$|ReadWritePaths=/var/lib/$n\\nInaccessiblePaths=-/var/lib/sara -/etc/sara -/var/lib/sara-demo -/var/lib/sara-updater\\nEnvironment=SARA_INSTANCE=$n|" \
    -e "s|^StateDirectory=sara$|StateDirectory=$n|"
}
# The updater units for this instance (from deploy/sara-updater.path / .service).
si_render_updater_path() {
  [[ $SI_NAME == "$SI_DEFAULT" ]] && { cat; return; }
  sed -e "s|^Description=Sara:|Description=Sara ($SI_NAME):|" \
    -e "s|^PathExists=/var/lib/sara/update-request$|PathExists=/var/lib/$SI_NAME/update-request|" \
    -e "s|^Unit=sara-updater.service$|Unit=$SI_NAME-updater.service|"
}
si_render_updater_service() {
  [[ $SI_NAME == "$SI_DEFAULT" ]] && { cat; return; }
  sed -e "s|^Description=Sara:|Description=Sara ($SI_NAME):|" \
    -e "s|^ExecStart=/usr/local/bin/sara web-request$|ExecStart=/usr/local/bin/$SI_NAME web-request|"
}
# The admin command for this instance (deploy/sara with its instance name filled in).
si_render_admin() {
  sed "s|^SARA_INSTANCE_NAME=sara # set by install.sh$|SARA_INSTANCE_NAME=$SI_NAME # set by install.sh|"
}

# What an install of this instance would create (install.sh --dry-run prints this).
si_plan() {
  local port=$1 node=$2
  cat <<EOF
instance=$SI_NAME
user=$SI_USER
group=$SI_GROUP
app_dir=$SI_APP_DIR
data_dir=$SI_DATA_DIR
backups_dir=$SI_DATA_DIR/backups
etc_dir=$SI_ETC_DIR
env_file=$SI_ENV_FILE
instance_file=$SI_INSTANCE_FILE
source_dir_file=$SI_SOURCE_FILE
unit=$SI_UNIT
unit_file=$SI_UNIT_FILE
updater_path_unit=$SI_UPDATER_PATH
updater_service_unit=$SI_UPDATER_SERVICE
updater_dir=$SI_UPDATER_DIR
admin_command=$SI_ADMIN
node=$node
port=$port
tailscale_https_port=$(si_ts_https_port "$port")
caddy_block=$SI_CADDY_TAG
EOF
}
