#!/usr/bin/env bash
# Install (or remove) the bridge as a systemd --user service from this worktree.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DATA_DIR="${DEX_DATA_DIR:-$HOME/.local/share/android-dex}"
SHARE_DIR="${DEX_SHARE_DIR:-$HOME/Android-DEX-share}"
PORT="${DEX_PORT:-8787}"
UNIT="$UNIT_DIR/android-dex.service"

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now android-dex.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "✓ removed android-dex.service"
  exit 0
fi

command -v systemctl >/dev/null || { echo "systemd is required for this helper" >&2; exit 1; }
mkdir -p "$UNIT_DIR" "$DATA_DIR" "$SHARE_DIR"

TOKEN_FILE="$DATA_DIR/token"
if [ ! -f "$TOKEN_FILE" ]; then
  umask 077
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
  echo "Generated bridge token: $(cat "$TOKEN_FILE")"
  echo "Store it now; it is also printed by 'android-dex doctor'."
fi
TOKEN="$(cat "$TOKEN_FILE")"

cat > "$UNIT" <<UNITEOF
[Unit]
Description=Android DEX bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(command -v node) ${ROOT}/server/src/cli.js serve --host 0.0.0.0 --port ${PORT}
Environment=DEX_TOKEN=${TOKEN}
Environment=DEX_DATA_DIR=${DATA_DIR}
Environment=DEX_SHARE_DIR=${SHARE_DIR}
Environment=DEX_LOG_LEVEL=info
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNITEOF

systemctl --user daemon-reload
systemctl --user enable --now android-dex.service
echo "✓ android-dex.service running on http://127.0.0.1:${PORT}/"
echo "  console : http://127.0.0.1:${PORT}/?token=${TOKEN}"
echo "  data    : ${DATA_DIR}"
echo "  share   : ${SHARE_DIR}"
echo "  logs    : journalctl --user -u android-dex -f"
