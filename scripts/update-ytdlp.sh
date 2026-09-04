#!/usr/bin/env bash
# update-ytdlp.sh - keep yt-dlp current for the ytdlp-extension native host.
# YouTube frequently breaks older yt-dlp releases (mid-download HTTP 403,
# 'Sign in to confirm...', extractor errors). Update yt-dlp at least when
# downloads break; a weekly timer keeps it ahead of the breakage.
#
# Usage:
#   ./scripts/update-ytdlp.sh                 # update now
#   ./scripts/update-ytdlp.sh --install-timer     # install weekly systemd user timer + update now
#   ./scripts/update-ytdlp.sh --uninstall-timer   # remove the timer
#   ./scripts/update-ytdlp.sh --quiet             # minimal output (used by the timer)
set -euo pipefail

PY="${PYTHON:-python3}"
QUIET=0
ACTION="update"
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --install-timer) ACTION="install-timer" ;;
    --uninstall-timer) ACTION="uninstall-timer" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-ytdlp.sh"

version() {
  "$PY" -m pip show yt-dlp 2>/dev/null | awk '/^Version:/{print $2}' || echo "not installed"
}

do_update() {
  local before after
  before="$(version)"
  "$PY" -m pip install --user --break-system-packages --no-cache-dir -U yt-dlp >/dev/null
  after="$(version)"
  if [ "$QUIET" -eq 0 ]; then
    echo "yt-dlp: $before -> $after"
  fi
  if [ "$before" != "$after" ]; then
    echo "yt-dlp updated to $after" >&2
  fi
}

case "$ACTION" in
  update)
    do_update
    ;;
  install-timer)
    unit_dir="$HOME/.config/systemd/user"
    unit="$unit_dir/ytdlp-update.service"
    timer="$unit_dir/ytdlp-update.timer"
    mkdir -p "$unit_dir"
    cat >"$unit" <<EOF
[Unit]
Description=Update yt-dlp for ytdlp-extension
After=network-online.target

[Service]
Type=oneshot
ExecStart=$SCRIPT_ABS --quiet
EOF
    cat >"$timer" <<'EOF2'
[Unit]
Description=Weekly yt-dlp update for ytdlp-extension

[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=6h

[Install]
WantedBy=timers.target
EOF2
    systemctl --user daemon-reload
    systemctl --user enable --now ytdlp-update.timer
    echo "Weekly timer installed:"
    systemctl --user list-timers ytdlp-update.timer --no-pager
    do_update
    ;;
  uninstall-timer)
    systemctl --user disable --now ytdlp-update.timer 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/ytdlp-update.service" \
          "$HOME/.config/systemd/user/ytdlp-update.timer"
    systemctl --user daemon-reload
    echo "Timer removed."
    ;;
esac
