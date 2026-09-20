#!/bin/bash
set -euo pipefail

PORT="${PORT:-3000}"

DEV_CONFIG=$(cat << JSON
{
  "build": {
    "devUrl": "http://localhost:${PORT}"
  },
  "app": {
    "security": {
      "csp": "default-src 'self' asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost http://localhost:${PORT} ws://localhost:${PORT} http://localhost:11434 http://127.0.0.1:11434 https://huggingface.co https://*.huggingface.co https://openrouter.ai https://api.openai.com; img-src 'self' asset: http://asset.localhost blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' asset: http://asset.localhost data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    }
  }
}
JSON
)

exec pnpm exec tauri dev --config "$DEV_CONFIG" "$@"
