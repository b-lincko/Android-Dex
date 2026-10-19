#!/usr/bin/env bash
# Build the release twice with a pinned epoch and compare hashes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EPOCH="${SOURCE_DATE_EPOCH:-1700000000}"
TMP1="$(mktemp -d)"; TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP1" "$TMP2"' EXIT
SOURCE_DATE_EPOCH="$EPOCH" node "$ROOT/scripts/build-release.mjs" --out "$TMP1" >/dev/null
SOURCE_DATE_EPOCH="$EPOCH" node "$ROOT/scripts/build-release.mjs" --out "$TMP2" >/dev/null
A="$(sha256sum "$TMP1"/*.tar.gz | cut -d' ' -f1)"
B="$(sha256sum "$TMP2"/*.tar.gz | cut -d' ' -f1)"
if [ "$A" = "$B" ]; then
  echo "✓ reproducible: $A"
else
  echo "✗ build differs:" >&2
  echo "  build 1: $A" >&2
  echo "  build 2: $B" >&2
  exit 1
fi
