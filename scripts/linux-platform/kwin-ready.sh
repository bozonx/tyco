#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${XAUTHORITY:-}" >"$XDG_RUNTIME_DIR/xauthority"
printf '%s\n' "$DISPLAY" >"$XDG_RUNTIME_DIR/xdisplay"
