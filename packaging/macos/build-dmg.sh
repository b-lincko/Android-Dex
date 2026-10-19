#!/usr/bin/env bash
# Build "Android DEX.app" and a compressed DMG. Run on macOS.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(node -p "require('${ROOT}/server/package.json').version")"
DIST="${ROOT}/dist/macos"
APP="${DIST}/Android DEX.app"
IDENTITY="${CODESIGN_IDENTITY:-}"

rm -rf "${DIST}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp -r "${ROOT}/server" "${ROOT}/app" "${ROOT}/sdk" "${ROOT}/scripts" "${ROOT}/bench" "${ROOT}/doc" "${APP}/Contents/Resources/"
rm -rf "${APP}/Contents/Resources/server/test"

cat > "${APP}/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../Resources" && pwd)"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  osascript -e 'display alert "Android DEX needs Node.js" message "Install Node 20+ from nodejs.org or Homebrew, then reopen Android DEX."'
  exit 1
fi
PORT="${DEX_PORT:-8787}"
if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  DEX_DATA_DIR="${DEX_DATA_DIR:-$HOME/Library/Application Support/Android DEX/data}" \
  DEX_SHARE_DIR="${DEX_SHARE_DIR:-$HOME/Android-DEX-share}" \
  "$NODE" "$HERE/server/src/cli.js" serve --host 127.0.0.1 --port "$PORT" >"$HOME/Library/Logs/android-dex.log" 2>&1 &
  sleep 0.8
fi
open "http://127.0.0.1:${PORT}/"
LAUNCH
chmod +x "${APP}/Contents/MacOS/launch"

cat > "${APP}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Android DEX</string>
  <key>CFBundleDisplayName</key><string>Android DEX</string>
  <key>CFBundleIdentifier</key><string>org.androiddex.console</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string><string>x86_64</string></array>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
</dict>
</plist>
PLIST

# Icon: build an .icns when the macOS toolchain is available.
if command -v sips >/dev/null && command -v iconutil >/dev/null; then
  ICONSET="${DIST}/AppIcon.iconset"
  mkdir -p "${ICONSET}"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "${ROOT}/packaging/icon.png" --out "${ICONSET}/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z $double $double "${ROOT}/packaging/icon.png" --out "${ICONSET}/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "${ICONSET}" -o "${APP}/Contents/Resources/AppIcon.icns"
  rm -rf "${ICONSET}"
fi

if [ -n "${IDENTITY}" ]; then
  codesign --force --deep --options runtime --timestamp \
    --entitlements "${ROOT}/packaging/macos/entitlements.plist" \
    --sign "${IDENTITY}" "${APP}"
  codesign --verify --deep --strict --verbose=2 "${APP}"
fi

hdiutil create -volname "Android DEX ${VERSION}" -srcfolder "${APP}" -ov -format UDZO "${DIST}/Android-DEX-${VERSION}.dmg"
echo "Built ${DIST}/Android-DEX-${VERSION}.dmg"
