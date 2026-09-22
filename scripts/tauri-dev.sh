#!/bin/bash
# Runs `tauri dev` with the only two things that must differ from the production
# config: the dev server URL and the CSP entries that allow talking to it.
# Everything else (including script-src) stays identical to tauri.conf.json so
# that a working dev build implies a working bundle.
set -euo pipefail

PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

case "$(uname -s)" in
  Linux*) DEV_OS="linux" ;;
  Darwin*) DEV_OS="macos" ;;
  CYGWIN*|MINGW*|MSYS*) DEV_OS="windows" ;;
  *)
    echo "Unsupported development platform: $(uname -s)" >&2
    exit 1
    ;;
esac

export TYCO_DEV_HOME="${REPOSITORY_ROOT}/dev_files/${DEV_OS}"

DEV_CONFIG=$(
  cat << JSON
{
  "build": {
    "devUrl": "http://localhost:${PORT}"
  },
  "app": {
    "security": {
      "csp": {
        "connect-src": "'self' ipc: asset: http://asset.localhost http://ipc.localhost http://localhost:${PORT} ws://localhost:${PORT}",
        "script-src": "'self' 'wasm-unsafe-eval' http://localhost:${PORT}"
      }
    }
  }
}
JSON
)

exec pnpm exec tauri dev --config "$DEV_CONFIG" "$@"
