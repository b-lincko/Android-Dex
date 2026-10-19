#!/usr/bin/env bash
# Verify a downloaded release: checksum, optional GPG signature, archive sanity.
set -euo pipefail
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: verify-release.sh android-dex-2.0.0.tar.gz" >&2; exit 1; }
DIR="$(cd "$(dirname "$TARGET")" && pwd)"
BASE="$(basename "$TARGET")"
cd "$DIR"
[ -f SHA256SUMS ] || { echo "SHA256SUMS missing next to $BASE" >&2; exit 1; }
grep -F "  ${BASE}" SHA256SUMS | sha256sum -c -
if [ -f SHA256SUMS.asc ]; then
  gpg --verify SHA256SUMS.asc SHA256SUMS
else
  echo "! SHA256SUMS.asc not present — checksum verified, signature skipped"
fi
tar -tzf "$BASE" | grep -q 'app/index.html'
tar -tzf "$BASE" | grep -q 'server/src/index.js'
echo "✓ $BASE verified"
