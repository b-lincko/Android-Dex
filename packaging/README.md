# Packaging & distribution

Android DEX ships as **the bridge + the static console**. There is no Electron
runtime: the bridge serves the console on `http://<host>:8787/` and every
packaging target below wraps those two things plus a service definition.

| Target | Folder | Produces | Needs Node at runtime |
| :--- | :--- | :--- | :--- |
| Debian/Ubuntu | `linux/` | `.deb` (system service + desktop entry) | yes — `nodejs >= 20.11` |
| Fedora/RHEL/openSUSE | `linux/rpm/` | `.rpm` | yes |
| Flatpak | `linux/flatpak/` | Flatpak bundle (bundles Node 20 SDK) | no |
| Snap | `linux/snap/` | Classic-confined snap (bundles Node 20) | no |
| macOS | `macos/` | `.app` + `.dmg`, Developer ID signed and notarised | yes (bundled if built with node) |
| Windows | `windows/` | Inno Setup installer + optional service | yes |

```bash
# Debian-family
sudo packaging/linux/build-deb.sh          # -> dist/android-dex_2.0.0_amd64.deb

# Fedora-family
rpmbuild -ba packaging/linux/rpm/android-dex.spec

# Flatpak
flatpak-builder --force-clean --install-deps-from=flathub build packaging/linux/flatpak/org.androiddex.Console.yml

# Snap
snapcraft --destructive-mode packaging/linux/snap/snapcraft.yaml

# macOS (run on macOS, with a Developer ID certificate in the keychain)
packaging/macos/build-dmg.sh
packaging/macos/notarize.sh
```

## Auto-update

The bridge exposes `GET /api/updates`, `POST /api/updates/check` and
`POST /api/updates/apply`. Resolution order for the release manifest:

1. `DEX_UPDATE_MANIFEST` (URL or file path),
2. `<dataDir>/releases.json`,
3. `server/releases.json` bundled with the app.

`apply` downloads the artifact, checks the SHA256 in the manifest **and** the
GPG signature when `DEX_REQUIRE_SIGNATURE=1` (default for stable), stages it via
`DEX_STAGED_ARTIFACT`, and never executes it. Package managers remain the
preferred update path; the in-app updater is for portable builds.

## Signing & reproducibility

```bash
node scripts/build-release.mjs          # deterministic tar.gz + SHA256SUMS
scripts/sign-release.sh                 # GPG-sign SHA256SUMS (needs RELEASE_GPG_KEY)
scripts/verify-release.sh dist/*.tar.gz # verify checksums + signature
scripts/check-reproducible.sh           # build twice, diff hashes
node scripts/generate-sbom.mjs          # sbom/android-dex-2.0.0.spdx.json
```

Windows installers are Authenticode-signed in CI when `WINDOWS_CERT_PFX` and
`WINDOWS_CERT_PASSWORD` are present; macOS uses `codesign --deep --options
runtime` with `macos/entitlements.plist` and `xcrun notarytool`.
