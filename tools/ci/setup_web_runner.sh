#!/usr/bin/env bash
# Registers one GitHub Actions runner for a public web repo on this PC.
# Run it as the unprivileged `ghrunner` user, never as your own account:
#
#   REPO=rhicksrad/NASA TOKEN=<registration token> bash setup_web_runner.sh
#
# The token comes from someone with admin on the repo and lasts one hour:
#   gh api -X POST repos/rhicksrad/NASA/actions/runners/registration-token -q .token
#
# It is safe to run again: a runner that is already configured is left alone
# and only its environment, hook, service and cleanup timer are refreshed.
set -euo pipefail

REPO=${REPO:?set REPO=owner/name}
RUNNER_VERSION=${RUNNER_VERSION:-2.338.2}
HOST=$(hostname | tr 'A-Z' 'a-z')
SHORT=$(printf '%s' "${REPO#*/}" | tr 'A-Z' 'a-z')
NAME=${NAME:-$HOST-$SHORT}
LABELS=${LABELS:-web,web-trusted,playwright,python,$HOST}
BASE=$HOME/actions-runners
DIR=$BASE/$SHORT
UNITS=$HOME/.config/systemd/user
HERE=$(cd "$(dirname "$0")" && pwd)

if [ "$(id -un)" = "ryan" ] && [ "${ALLOW_OWN_ACCOUNT:-0}" != 1 ]; then
  echo "Run this as ghrunner: a public repo's jobs must not be able to read your gh login, SSH keys or clones." >&2
  exit 1
fi

mkdir -p "$DIR" "$BASE/_toolcache" "$BASE/ms-playwright" "$UNITS"
install -m 0755 "$HERE/refuse_untrusted.sh" "$BASE/refuse_untrusted.sh"

if [ ! -x "$DIR/run.sh" ]; then
  curl -fsSL "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz" | tar xz -C "$DIR"
fi
if [ ! -f "$DIR/.runner" ]; then
  : "${TOKEN:?set TOKEN to a registration token for $REPO}"
  (cd "$DIR" && ./config.sh --unattended --url "https://github.com/$REPO" --token "$TOKEN" \
    --name "$NAME" --labels "$LABELS" --work _work)
fi

# The service has no login shell, so everything a job needs goes here.
cat > "$DIR/.env" <<ENV
PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
RUNNER_TOOL_CACHE=$BASE/_toolcache
PLAYWRIGHT_BROWSERS_PATH=$BASE/ms-playwright
ACTIONS_RUNNER_HOOK_JOB_STARTED=$BASE/refuse_untrusted.sh
ENV

# One ceiling for every web runner on this PC, so several repos firing at once cannot starve it.
cat > "$UNITS/web-runners.slice" <<UNIT
[Slice]
CPUQuota=400%
MemoryMax=8G
UNIT

cat > "$UNITS/runner-$SHORT.service" <<UNIT
[Unit]
Description=GitHub Actions runner $NAME ($REPO)
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$DIR/run.sh
Restart=always
RestartSec=10
Nice=15
Slice=web-runners.slice

[Install]
WantedBy=default.target
UNIT

# Weekly: prune the shared pnpm store and drop old temp files and runner logs.
cat > "$BASE/weekly_cleanup.sh" <<'CLEAN'
#!/usr/bin/env bash
set -u
base=$HOME/actions-runners
command -v pnpm >/dev/null 2>&1 && pnpm store prune || true
find "$base"/*/_work/_temp -mindepth 1 -mtime +14 -delete 2>/dev/null || true
find "$base"/*/_diag -name '*.log' -mtime +14 -delete 2>/dev/null || true
CLEAN
chmod 0755 "$BASE/weekly_cleanup.sh"
cat > "$UNITS/web-runners-cleanup.service" <<UNIT
[Unit]
Description=Weekly cleanup for the web runners

[Service]
Type=oneshot
ExecStart=$BASE/weekly_cleanup.sh
UNIT
cat > "$UNITS/web-runners-cleanup.timer" <<UNIT
[Unit]
Description=Weekly cleanup for the web runners

[Timer]
OnCalendar=Sun 05:30
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "runner-$SHORT.service" web-runners-cleanup.timer
systemctl --user --no-pager status "runner-$SHORT.service" | head -5 || true
echo "Runner $NAME registered for $REPO with labels: $LABELS"
