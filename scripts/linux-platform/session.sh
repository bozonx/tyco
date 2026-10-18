#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
session=${1:?Expected x11, kwin, or sway}
case "$session" in x11|kwin|sway) ;; *) echo "Unknown session: $session" >&2; exit 2 ;; esac
export TYCO_PLATFORM_SESSION="$session"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
export XDG_CONFIG_HOME="$XDG_RUNTIME_DIR/config"
export XDG_CACHE_HOME="$XDG_RUNTIME_DIR/cache"
export XDG_DATA_HOME="$XDG_RUNTIME_DIR/data"
mkdir -p "$XDG_CONFIG_HOME"
export LIBGL_ALWAYS_SOFTWARE=1
export QT_ACCESSIBILITY=0
export NO_AT_BRIDGE=1
log_dir=${TYCO_PLATFORM_LOG_DIR:-/tmp/tyco-platform-logs}
mkdir -p "$log_dir"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT
wait_for() {
  local attempt
  for attempt in {1..200}; do
    if "$@" >/dev/null 2>&1; then return; fi
    sleep 0.05
  done
  echo "Session readiness timed out: $*" >&2
  cat "$log_dir"/*.log >&2
  exit 1
}
case "$session" in
  x11)
    export XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=Openbox GDK_BACKEND=x11 DISPLAY=:99
    unset WAYLAND_DISPLAY
    Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >"$log_dir/xvfb.log" 2>&1 &
    pids+=("$!")
    wait_for xdpyinfo
    openbox >"$log_dir/openbox.log" 2>&1 &
    pids+=("$!")
    wait_for bash -c 'xprop -root _NET_SUPPORTING_WM_CHECK | grep -q "window id"'
    ;;
  kwin)
    export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE GDK_BACKEND=x11
    # Direct XSendEvent in the XWayland fixture requires GTK core events.
    export GDK_CORE_DEVICE_EVENTS=1
    export WAYLAND_DISPLAY=wayland-tyco
    unset DISPLAY XAUTHORITY
    # Read the display and authentication chosen by KWin from its child.
    kwin_wayland --virtual --no-lockscreen --no-global-shortcuts --no-kactivities \
      --socket "$WAYLAND_DISPLAY" --xwayland \
      "$repo_root/scripts/linux-platform/kwin-ready.sh" \
      >"$log_dir/kwin.log" 2>&1 &
    pids+=("$!")
    wait_for test -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
    wait_for test -f "$XDG_RUNTIME_DIR/xdisplay"
    export DISPLAY XAUTHORITY
    DISPLAY=$(cat "$XDG_RUNTIME_DIR/xdisplay")
    XAUTHORITY=$(cat "$XDG_RUNTIME_DIR/xauthority")
    wait_for xdpyinfo
    ;;
  sway)
    export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=sway GDK_BACKEND=wayland
    unset DISPLAY WAYLAND_DISPLAY
    export WLR_BACKENDS=headless,libinput WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman
    export LIBSEAT_BACKEND=seatd
    cat >"$XDG_CONFIG_HOME/sway-config" <<'EOF'
xwayland disable
output HEADLESS-1 mode 1280x800
seat seat0 fallback true
focus_follows_mouse no
EOF
    sway --unsupported-gpu -c "$XDG_CONFIG_HOME/sway-config" >"$log_dir/sway.log" 2>&1 &
    pids+=("$!")
    wait_for bash -c 'compgen -G "$XDG_RUNTIME_DIR/wayland-*" | grep -v "\.lock$"'
    for socket in "$XDG_RUNTIME_DIR"/wayland-*; do
      if [[ -S "$socket" ]]; then export WAYLAND_DISPLAY="${socket##*/}"; break; fi
    done
    ;;
esac
cd "$repo_root/src-tauri"
# Each matrix leg has its own process and session cache. Missing tests must fail.
binary=${TYCO_PLATFORM_TEST_BINARY:-/usr/local/bin/tyco-platform-tests}
"$binary" --list --ignored | grep '^services::platform::linux::headless_tests::integration_headless_platform: test$' >/dev/null
timeout 120 "$binary" --ignored --exact services::platform::linux::headless_tests::integration_headless_platform --nocapture --test-threads=1
