#!/usr/bin/env bash
# GPG-sign the SHA256SUMS for a release. Requires a secret key.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${1:-${ROOT}/dist}"
cd "$DIST"
[ -f SHA256SUMS ] || { echo "SHA256SUMS not found in $DIST" >&2; exit 1; }
KEY="${RELEASE_GPG_KEY:?Set RELEASE_GPG_KEY to the signing key id (e.g. 0xDEADBEEF)}"
gpg --batch --yes --armor --detach-sign --local-user "$KEY" SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
echo "✓ Signed SHA256SUMS → SHA256SUMS.asc"
