#!/usr/bin/env node
/**
 * Generate an SPDX 2.3 JSON SBOM for the release, including optional external
 * tools (scrcpy/adb/ffmpeg) that the bridge can drive but does not bundle.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(path.join(root, 'server/package.json'), 'utf8'));
const version = pkg.version;
const now = new Date().toISOString();
const namespace = `https://android-dex.dev/spdx/${version}/${createHash('sha256').update(`${version}:${now}`).digest('hex').slice(0, 16)}`;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'test', '.git', 'dist', 'sbom'].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(path.join(root, 'app'))
  .concat(walk(path.join(root, 'server/src')))
  .concat(walk(path.join(root, 'sdk')))
  .sort();
const fileHashes = files.map((file) => createHash('sha256').update(readFileSync(file)).digest('hex')).sort();
const verificationCode = createHash('sha256').update(fileHashes.join('')).digest('hex');

const packages = [
  {
    SPDXID: 'SPDXRef-Package-AndroidDEX',
    name: 'android-dex',
    versionInfo: version,
    downloadLocation: 'https://github.com/Shrey113/Android-Dex',
    filesAnalyzed: false,
    licenseConcluded: 'LicenseRef-Proprietary',
    licenseDeclared: 'LicenseRef-Proprietary',
    copyrightText: 'Copyright (c) 2026 Shrey Patel. All rights reserved.',
    checksums: [{ algorithm: 'SHA256', checksumValue: verificationCode }],
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:github/Shrey113/Android-Dex@v${version}` }],
    comment: `${files.length} first-party files hashed for the package verification code.`,
  },
  {
    SPDXID: 'SPDXRef-Package-Node',
    name: 'node',
    versionInfo: process.version.replace(/^v/, ''),
    downloadLocation: 'https://nodejs.org/',
    filesAnalyzed: false,
    licenseConcluded: 'MIT',
    licenseDeclared: 'MIT',
    copyrightText: 'Copyright Node.js contributors',
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:generic/node@${process.version.replace(/^v/, '')}` }],
    comment: 'Runtime requirement (>=20.11); bundled by the Flatpak and Snap builds.',
  },
  {
    SPDXID: 'SPDXRef-Package-qrcode-generator',
    name: 'qrcode-generator',
    versionInfo: '1.4.4',
    downloadLocation: 'https://github.com/kazuhikoarase/qrcode-generator',
    filesAnalyzed: false,
    licenseConcluded: 'MIT',
    licenseDeclared: 'MIT',
    copyrightText: 'Copyright (c) Kazuhiko Arase',
    comment: 'Vendored at app/vendor/qrcode.js for offline QR pairing.',
  },
  {
    SPDXID: 'SPDXRef-Package-Lucide',
    name: 'lucide-static',
    versionInfo: '0.454.0',
    downloadLocation: 'https://github.com/lucide-icons/lucide',
    filesAnalyzed: false,
    licenseConcluded: 'ISC',
    licenseDeclared: 'ISC',
    copyrightText: 'Copyright (c) Lucide contributors',
    comment: 'Icon paths inlined into app/assets/icons.svg; licence in app/vendor/lucide.LICENSE.',
  },
  {
    SPDXID: 'SPDXRef-Package-scrcpy',
    name: 'scrcpy',
    versionInfo: '3.x (external)',
    downloadLocation: 'https://github.com/Genymobile/scrcpy',
    filesAnalyzed: false,
    licenseConcluded: 'Apache-2.0',
    licenseDeclared: 'Apache-2.0',
    copyrightText: 'Copyright (c) Genymobile',
    comment: 'Optional external dependency, not bundled. Used for the mirroring transport when installed.',
  },
  {
    SPDXID: 'SPDXRef-Package-adb',
    name: 'android-platform-tools (adb)',
    versionInfo: 'external',
    downloadLocation: 'https://developer.android.com/tools/releases/platform-tools',
    filesAnalyzed: false,
    licenseConcluded: 'Apache-2.0',
    licenseDeclared: 'Apache-2.0',
    copyrightText: 'Copyright The Android Open Source Project',
    comment: 'Optional external dependency, not bundled. Provides device transport and USB debugging.',
  },
  {
    SPDXID: 'SPDXRef-Package-ffmpeg',
    name: 'ffmpeg',
    versionInfo: 'external',
    downloadLocation: 'https://ffmpeg.org/',
    filesAnalyzed: false,
    licenseConcluded: 'LGPL-2.1-or-later',
    licenseDeclared: 'LGPL-2.1-or-later',
    copyrightText: 'Copyright FFmpeg contributors',
    comment: 'Optional external dependency for recording/transcoding, not bundled.',
  },
];

const relationships = packages.slice(1).map((component) => ({
  spdxElementId: 'SPDXRef-Package-AndroidDEX',
  relationshipType: ['scrcpy', 'adb', 'ffmpeg'].some((name) => component.name.includes(name)) ? 'OPTIONAL_DEPENDENCY_OF' : 'DEPENDS_ON',
  relatedSpdxElement: component.SPDXID,
}));

const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `android-dex-${version}`,
  documentNamespace: namespace,
  creationInfo: {
    created: now,
    creators: ['Tool: android-dex-generate-sbom-1.0', 'Organization: Android DEX contributors'],
    comment: 'Generated from the release worktree. Optional external tools are declared but not distributed.',
  },
  packages,
  relationships,
  hasExtractedLicensingInfos: [{
    licenseId: 'LicenseRef-Proprietary',
    extractedText: 'Android DEX is proprietary software. See the LICENSE file in the distribution for permitted use. Third-party components remain under their own licences.',
    name: 'Android DEX Proprietary License',
    seeAlsos: ['https://github.com/Shrey113/Android-Dex/blob/main/LICENSE'],
  }],
};

const outDir = path.join(root, 'sbom');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `android-dex-${version}.spdx.json`);
writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
writeFileSync(path.join(outDir, 'latest.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`✓ SBOM written to ${path.relative(root, out)} (${packages.length} packages, ${files.length} files hashed)`);
