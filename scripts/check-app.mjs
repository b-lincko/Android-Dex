#!/usr/bin/env node
/**
 * Static verification for the console. Catches the failure modes that only show
 * up in a browser: missing exports, broken relative imports, syntax errors and
 * icon names that are not in the offline sprite.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const appDir = path.join(root, 'app');
const failures = [];
const notes = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const jsFiles = walk(path.join(appDir, 'js')).filter((file) => file.endsWith('.js'));
const required = [
  'app/index.html',
  'app/css/app.css',
  'app/manifest.webmanifest',
  'app/sw.js',
  'app/vendor/qrcode.js',
  'app/data/demo-state.json',
  'app/js/app.js',
  'app/js/boot.js',
  'app/js/api.js',
  'app/js/shell.js',
  'app/js/panels.js',
  'app/js/views/shared.js',
  'app/assets/icons.svg',
  'app/assets/stream-preview.svg',
];
for (const file of required) {
  try { readFileSync(path.join(root, file)); } catch { failures.push(`missing required file: ${file}`); }
}

function exportsOf(file) {
  const source = readFileSync(file, 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  if (syntax.status !== 0) failures.push(`syntax error in ${path.relative(root, file)}: ${syntax.stderr.split('\n')[0]}`);

  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), match[2]);
    if (!target.endsWith('.js')) continue;
    let targetSource;
    try { targetSource = readFileSync(target, 'utf8'); } catch { failures.push(`${path.relative(root, file)} imports missing file ${match[2]}`); continue; }
    const exported = exportsOf(target);
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !exported.has(name)) failures.push(`${path.relative(root, file)} imports missing export "${name}" from ${match[2]}`);
    }
  }
}

// Icon coverage: every icon the UI asks for must exist in the sprite.
const sprite = readFileSync(path.join(appDir, 'assets/icons.svg'), 'utf8');
const symbols = new Set([...sprite.matchAll(/id="i-([^"]+)"/g)].map((match) => match[1]));
const used = new Map();
for (const file of [...jsFiles, path.join(appDir, 'index.html')]) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of [/icon\(\s*'([a-z0-9-]+)'/g, /data-icon="([a-z0-9-]+)"/g, /iconName:\s*'([a-z0-9-]+)'/g]) {
    for (const match of source.matchAll(pattern)) used.set(match[1], path.relative(root, file));
  }
}
for (const [name, file] of used) {
  if (!symbols.has(name)) failures.push(`icon "${name}" is used in ${file} but missing from assets/icons.svg`);
}
notes.push(`${used.size} icon names referenced, ${symbols.size} symbols in sprite`);

// CSS coverage: static class names used by the shell and views must have a rule,
// otherwise the element renders unstyled and nobody notices until a screenshot.
const css = readFileSync(path.join(appDir, 'css/app.css'), 'utf8');
const styled = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1]));
const cssUsed = new Map();
for (const file of [...jsFiles, path.join(appDir, 'index.html')]) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of [/class:\s*'([a-z][a-z0-9 -]*)'/g, /class="([a-z][a-z0-9 -]*)"/g]) {
    for (const match of source.matchAll(pattern)) {
      for (const name of match[1].trim().split(/\s+/)) if (name) cssUsed.set(name, path.relative(root, file));
    }
  }
}
for (const [name, file] of cssUsed) {
  if (!styled.has(name)) failures.push(`class "${name}" is used in ${file} but has no rule in app/css/app.css`);
}
notes.push(`${cssUsed.size} class names styled`);

// The service worker must not cache API traffic.
const sw = readFileSync(path.join(appDir, 'sw.js'), 'utf8');
if (!/startsWith\('\/api\/'\)/.test(sw)) failures.push('sw.js does not exclude /api/ from caching');
notes.push(`${jsFiles.length} console modules checked`);

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`✓ console checks passed — ${notes.join('; ')}`);
