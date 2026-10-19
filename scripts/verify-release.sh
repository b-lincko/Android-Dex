#!/usr/bin/env bash
# Verify a downloaded release: checksum, optional GPG signature, archive sanity.
set -euo pipefail
TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: verify-release.sh android-dex-2.0.0.tar.gz" >&2; exit 1; }
DIR="$(cd "$(dirname "$TARGET")" && pwd)"
BASE="$(basename "$TARGET")"
cd "$DIR"
[ -f SHA256SUMS ] || { echo "SHA256SUMS missing next to $BASE" >&2; exit 1; }

# Fail loudly when the archive has no checksum entry at all.
if ! grep -qF "  ${BASE}" SHA256SUMS; then
  echo "no checksum entry for ${BASE} in SHA256SUMS" >&2
  exit 1
fi
grep -F "  ${BASE}" SHA256SUMS | sha256sum -c -

if [ -f SHA256SUMS.asc ]; then
  gpg --verify SHA256SUMS.asc SHA256SUMS
else
  echo "! SHA256SUMS.asc not present — checksum verified, signature skipped"
fi

# List once into a file: piping tar into `grep -q` closes the pipe early and,
# under `pipefail`, makes a *successful* archive look like a failed check (141).
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
tar -tzf "$BASE" > "$LIST"
for expected in app/index.html server/src/index.js; do
  if ! grep -qF "/$expected" "$LIST" && ! grep -qxF "$expected" "$LIST"; then
    echo "archive is missing ${expected}" >&2
    exit 1
  fi
done
echo "✓ $BASE verified"
