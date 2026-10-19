# Trust: reproducible builds, SBOM, signatures and crash reports

You should be able to answer three questions without trusting a download page:

1. **Is this the code that was reviewed?** → reproducible build.
2. **What is inside it?** → SBOM + hashed file inventory.
3. **Did it come from the project?** → SHA256SUMS + GPG signature (or Sigstore).

Android DEX ships the tooling for all three in `scripts/`.

## 1. Reproducible build

```bash
npm run reproducible
# ✓ reproducible: <sha256>
```

`scripts/check-reproducible.sh` builds the release **twice** from the same
worktree with `SOURCE_DATE_EPOCH=1700000000` and compares the tarball hashes.
`scripts/build-release.mjs` pins:

- file order (`tar --sort=name`),
- ownership (`--owner=0 --group=0 --numeric-owner`),
- mtimes (`--mtime=@$SOURCE_DATE_EPOCH`, then `utimesSync` on every file),
- gzip timestamp (`gzip -9n`),
- PAX headers (`--pax-option=delete=atime,delete=ctime`).

The last item matters: GNU tar’s POSIX format records **atime/ctime in
nanoseconds**, which made two builds differ even when every extracted file was
identical. Deleting those records is the fix; without it, “reproducible” is a
lie. The check is part of CI.

Verification:

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) npm run build
sha256sum -c dist/SHA256SUMS --ignore-missing
```

## 2. SBOM

```bash
npm run sbom
# ✓ SBOM written to sbom/android-dex-<version>.spdx.json (7 packages, N files hashed)
```

The SPDX 2.3 document lists:

- **android-dex** (proprietary, `LicenseRef-Proprietary`) with a package
  verification code computed from all first-party source hashes,
- **node** (MIT runtime requirement; bundled by Flatpak/Snap),
- **qrcode-generator** (MIT, vendored),
- **lucide-static** (ISC, vendored icons),
- **scrcpy**, **adb**, **ffmpeg** as *optional* dependencies (Apache-2.0 /
  LGPL-2.1-or-later) that are **not distributed** with the bridge.

The console surfaces the SBOM under **Developer → SBOM**, and
`GET /api/diagnostics/sbom` returns it. Regenerate it whenever dependencies or
vendored assets change; CI does this before packaging.

## 3. Checksums and signatures

```bash
node scripts/build-release.mjs
RELEASE_GPG_KEY=0x… scripts/sign-release.sh   # creates SHA256SUMS.asc
scripts/verify-release.sh dist/android-dex-2.0.0.tar.gz
```

- `SHA256SUMS` is always produced.
- The release workflow imports `GPG_PRIVATE_KEY` and signs `SHA256SUMS` when
  configured; otherwise it uses Sigstore (`gh-action-sigstore-python`) and
  uploads the `.sigstore` bundle.
- `verify-release.sh` checks the checksum, verifies the signature when present,
  and asserts the archive contains the console and bridge entry points.
- **Never disable signature verification** to make an update pass. A failed
  check is a supply-chain signal, not an inconvenience.

## 4. Crash reports and diagnostics

- Crash bundles are **opt-in** (`Settings → Privacy`, or
  `POST /api/diagnostics/crash-reports`), written under `<dataDir>/crashes`, and
  never uploaded by the bridge.
- `GET /api/diagnostics` returns version, platform, uptime, memory, reconnect
  health and counters. `GET /api/diagnostics/logs` returns a ring buffer.
- Purge at any time: `DELETE /api/diagnostics/crashes`.
- The console shows a “local only” note next to the toggle; there is no hidden
  telemetry endpoint to opt out of.

## 5. Runtime security model

| Control | Implementation |
| :--- | :--- |
| API auth | Bearer token (`DEX_TOKEN`, 24 random bytes when generated) or `?token=`; `/api/health` and pairing confirm are public |
| Pairing | one-time 6-digit code + token + fingerprint; codes expire in 2 minutes; attempts rate-limited |
| Device trust | fingerprints pinned in `security.pairedFingerprints`; changed fingerprint is rejected until revoked |
| Audit | local `security.audit` ring with severity; shown in Settings → Privacy |
| WebDAV | Basic auth (`dex` / token); no anonymous mounts |
| Plugins | permission-scoped API, no network, no process spawn, disabled by default |
| CORS | same-origin by default; explicit allowlist via `DEX_ALLOWED_ORIGINS` |
| Bind | `0.0.0.0` by default for LAN, but token required; use `--host 127.0.0.1` for single-machine use |

## 6. What is *not* claimed

- The companion APK in `companion/` is a protocol reference, not a signed Play
  release.
- The bridge does not provide TLS itself; put it behind a reverse proxy and use
  `wss://` if you need transport encryption. Pin the proxy certificate.
- Reproducibility covers the source tarball, not third-party compilers or the
  vendor-provided Node binaries in the Flatpak/Snap builds (their hashes are
  checked at build time by the packaging scripts).

## 7. Reporting a supply-chain issue

Use the process in [SECURITY.md](../SECURITY.md). Include the tarball hash, the
verification output and whether `npm run reproducible` matches on your machine.
Do not open a public issue for an unpatched bypass.
