#!/usr/bin/env bash
set -euo pipefail
session=${1:?Expected session}
mkdir -p /tmp/tyco-platform-logs
chmod 1777 /tmp/tyco-platform-logs
if [[ "$session" == sway ]]; then
  # Only the isolated container gets device access. No host desktop sockets.
  test -c /dev/uinput
  udevd=$(command -v systemd-udevd || echo /usr/lib/systemd/systemd-udevd)
  "$udevd" --daemon
  export SEATD_VTBOUND=0
  seatd -g video >/tmp/tyco-platform-logs/seatd.log 2>&1 &
  ydotoold --socket-path=/tmp/tyco-ydotool.sock --socket-perm=0666 \
    >/tmp/tyco-platform-logs/ydotoold.log 2>&1 &
  export YDOTOOL_SOCKET=/tmp/tyco-ydotool.sock
  for attempt in {1..100}; do
    if [[ -S "$YDOTOOL_SOCKET" ]]; then break; fi
    sleep 0.05
  done
  test -S "$YDOTOOL_SOCKET"
  udevadm trigger --subsystem-match=input
  udevadm settle
fi
exec runuser -u tester -- dbus-run-session -- bash /workspace/scripts/linux-platform/session.sh "$session"
