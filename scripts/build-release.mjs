#!/usr/bin/env node
/**
 * Build a deterministic source release tarball.
 *
 * Reproducibility rules:
 *  - files are sorted before packing
 *  - every mtime is pinned to SOURCE_DATE_EPOCH (default: last commit time)
 *  - tar owners are 0:0 and gzip is invoked with -n (no timestamp)
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, utimesSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const version = JSON.parse(readFileSync(path.join(root, 'server/package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const outDir = path.resolve(outArg === -1 ? path.join(root, 'dist') : args[outArg + 1]);
const name = `android-dex-${version}`;
const stage = path.join(outDir, name);

function gitEpoch() {
  const result = spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? Number(result.stdout.trim()) : Math.floor(Date.now() / 1000);
}
const epoch = Number(process.env.SOURCE_DATE_EPOCH || gitEpoch());

console.log(`Building ${name} (SOURCE_DATE_EPOCH=${epoch})`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const include = ['app', 'server', 'sdk', 'scripts', 'bench', 'doc', 'packaging', 'sbom'];
for (const dir of include) {
  cpSync(path.join(root, dir), path.join(stage, dir), {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|\.git|test)$/.test(source),
  });
}
for (const file of ['README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'package.json']) {
  try { cpSync(path.join(root, file), path.join(stage, file)); } catch { /* optional at first build */ }
}
// Packaging scripts must remain executable inside the archive.
for (const script of ['packaging/linux/build-deb.sh', 'packaging/macos/build-dmg.sh', 'packaging/macos/notarize.sh', 'scripts/sign-release.sh', 'scripts/verify-release.sh', 'scripts/install-service.sh']) {
  try { cpSync(path.join(root, script), path.join(stage, script), { preserveTimestamps: false }); } catch { /* ignore */ }
}

function stamp(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) stamp(full);
    else if (info.isFile()) utimesSync(full, epoch, epoch);
  }
}
stamp(stage);

const tarball = path.join(outDir, `${name}.tar.gz`);
rmSync(tarball, { force: true });
const tar = spawnSync('bash', ['-c', `tar --sort=name --mtime=@${epoch} --owner=0 --group=0 --numeric-owner --format=posix --pax-option=delete=atime,delete=ctime -cf - '${name}' | gzip -9n > '${tarball}'`], { cwd: outDir, encoding: 'utf8' });
if (tar.status !== 0) { console.error(tar.stderr); process.exit(1); }

const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
const sums = `${digest}  ${path.basename(tarball)}\n`;
writeFileSync(path.join(outDir, 'SHA256SUMS'), sums);
console.log(`✓ ${path.relative(root, tarball)}`);
console.log(`  sha256 ${digest}`);
console.log(`  ${(statSync(tarball).size / 1024 / 1024).toFixed(2)} MB`);
