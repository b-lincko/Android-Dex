#!/usr/bin/env bash
# Build a .deb from the current worktree. No npm install required (zero deps).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(node -p "require('${ROOT}/server/package.json').version")"
ARCH="${ARCH:-amd64}"
OUT="${OUT:-${ROOT}/dist}"
PKG="android-dex_${VERSION}_${ARCH}"
STAGE="${OUT}/${PKG}"

rm -rf "${STAGE}"
install -d "${STAGE}/DEBIAN" "${STAGE}/opt/android-dex" "${STAGE}/usr/bin" \
  "${STAGE}/usr/share/applications" "${STAGE}/usr/share/icons/hicolor/1024x1024/apps" \
  "${STAGE}/usr/lib/systemd/user" "${STAGE}/usr/share/doc/android-dex"

cp -r "${ROOT}/server" "${ROOT}/app" "${ROOT}/sdk" "${ROOT}/scripts" "${ROOT}/bench" "${STAGE}/opt/android-dex/"
rm -rf "${STAGE}/opt/android-dex/server/node_modules" "${STAGE}/opt/android-dex/server/test"
cp "${ROOT}/README.md" "${ROOT}/LICENSE" "${ROOT}/NOTICE" "${ROOT}/CHANGELOG.md" "${STAGE}/opt/android-dex/" 2>/dev/null || true
cp -r "${ROOT}/doc" "${STAGE}/opt/android-dex/doc" 2>/dev/null || true

ln -s /opt/android-dex/server/src/cli.js "${STAGE}/usr/bin/android-dex"
sed "s|Exec=android-dex|Exec=/usr/bin/android-dex|g" "${ROOT}/packaging/linux/android-dex.desktop" > "${STAGE}/usr/share/applications/android-dex.desktop"
cp "${ROOT}/packaging/icon.png" "${STAGE}/usr/share/icons/hicolor/1024x1024/apps/android-dex.png"
cp "${ROOT}/packaging/linux/android-dex.service" "${STAGE}/usr/lib/systemd/user/android-dex.service"

cat > "${STAGE}/DEBIAN/control" <<CONTROL
Package: android-dex
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Android DEX contributors <maintainers@android-dex.dev>
Homepage: https://github.com/Shrey113/Android-Dex
Depends: nodejs (>= 20.11), adb | android-tools-adb
Recommends: ffmpeg
Provides: android-dex-bridge
Description: Android DEX bridge and desktop console
 Mirror Android apps into floating desktop windows, sync clipboard text and
 images, transfer files over WebDAV, answer calls and SMS/RCS messages, mirror
 notifications and manage game profiles. The bridge is a zero-dependency Node
 service; the console is served locally and works offline.
CONTROL

cat > "${STAGE}/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
# The service runs as the logged-in user; enable it per user with:
#   systemctl --user enable --now android-dex
exit 0
POSTINST
chmod 755 "${STAGE}/DEBIAN/postinst"

cat > "${STAGE}/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop android-dex.service >/dev/null 2>&1 || true
  systemctl --user disable android-dex.service >/dev/null 2>&1 || true
fi
exit 0
PRERM
chmod 755 "${STAGE}/DEBIAN/prerm"

dpkg-deb --build --root-owner-group "${STAGE}" "${OUT}/${PKG}.deb"
rm -rf "${STAGE}"
echo "Built ${OUT}/${PKG}.deb"
