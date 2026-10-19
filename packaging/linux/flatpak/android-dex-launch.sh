#!/bin/sh
# Start the bridge if it is not already running, then open the console.
set -e
PORT="${DEX_PORT:-8787}"
if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  android-dex serve --host 127.0.0.1 --port "${PORT}" >/tmp/android-dex.log 2>&1 &
  sleep 0.8
fi
TOKEN="${DEX_TOKEN:-}"
URL="http://127.0.0.1:${PORT}/${TOKEN:+?token=$TOKEN}"
exec xdg-open "$URL"
