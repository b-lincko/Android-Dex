#!/usr/bin/env bash
# Notarise and staple the DMG. Requires:
#   xcrun notarytool store-credentials "$NOTARY_PROFILE" --apple-id ... --team-id ... --password ...
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(node -p "require('${ROOT}/server/package.json').version")"
DMG="${1:-${ROOT}/dist/macos/Android-DEX-${VERSION}.dmg}"
PROFILE="${NOTARY_PROFILE:-android-dex-notary}"
[ -f "$DMG" ] || { echo "DMG not found: $DMG" >&2; exit 1; }
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"
echo "Notarised and stapled $DMG"
