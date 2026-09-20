#!/bin/bash
# Runs `tauri dev` with the only two things that must differ from the production
# config: the dev server URL and the CSP entries that allow talking to it.
# Everything else (including script-src) stays identical to tauri.conf.json so
# that a working dev build implies a working bundle.
set -euo pipefail

PORT="${PORT:-3000}"

DEV_CONFIG=$(
  cat << JSON
{
  "build": {
    "devUrl": "http://localhost:${PORT}"
  },
  "app": {
    "security": {
      "csp": {
        "connect-src": "'self' ipc: asset: http://asset.localhost http://ipc.localhost http://localhost:${PORT} ws://localhost:${PORT} http://localhost:11434 http://127.0.0.1:11434 https://huggingface.co https://*.huggingface.co https://openrouter.ai https://api.openai.com",
        "script-src": "'self' 'wasm-unsafe-eval' http://localhost:${PORT}"
      }
    }
  }
}
JSON
)

exec pnpm exec tauri dev --config "$DEV_CONFIG" "$@"
