#!/usr/bin/env node
/**
 * `android-dex` CLI — scriptable control plane for the bridge.
 *
 *   android-dex connect --transport wifi
 *   android-dex launch com.spotify.music
 *   android-dex sms send --to +4915123456789 --text "On my way"
 *   android-dex clip set "https://example.com"
 *   android-dex profiles export gp_delta --out delta.json
 *
 * Commands talk to a running bridge over HTTP (DEX_URL / DEX_TOKEN); `serve`
 * starts one, and `doctor` inspects the host without any network access.
 */
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createBridge, REPO_ROOT } from './index.js';
import { VERSION, humanBytes } from './util.js';

const args = process.argv.slice(2);
let baseUrl = process.env.DEX_URL || 'http://127.0.0.1:8787';
let token = process.env.DEX_TOKEN || '';
let jsonOutput = false;
const positionals = [];
const flags = {};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--json') jsonOutput = true;
  else if (arg === '--url') baseUrl = args[++i];
  else if (arg === '--token') token = args[++i];
  else if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { flags[key] = next; i += 1; } else flags[key] = true;
  } else positionals.push(arg);
}

const command = positionals.shift();

const color = (code, value) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${value}\x1b[0m` : value);
const bold = (value) => color('1', value);
const dim = (value) => color('2', value);
const green = (value) => color('32', value);
const red = (value) => color('31', value);
const yellow = (value) => color('33', value);

async function api(pathname, { method = 'GET', body, raw = false } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ? `${payload.error.message}${payload.error.code ? ` (${payload.error.code})` : ''}` : `HTTP ${response.status}`);
  }
  return payload;
}

const print = (value) => {
  if (jsonOutput) { console.log(JSON.stringify(value, null, 2)); return; }
  if (typeof value === 'string') { console.log(value); return; }
  console.log(JSON.stringify(value, null, 2));
};

function run(cmd, argv = []) {
  return new Promise((resolve) => {
    execFile(cmd, argv, { timeout: 5000 }, (error, stdout) => resolve({ ok: !error, output: (stdout || '').trim() }));
  });
}

async function doctor() {
  const checks = [];
  const add = async (name, fn, hint) => {
    let ok = false; let detail = '';
    try { const result = await fn(); ok = result === true || result?.ok; detail = result?.detail || ''; } catch (error) { detail = error.message; }
    checks.push({ name, ok, detail, hint });
  };
  await add('Node.js ≥ 20', () => ({ ok: Number(process.versions.node.split('.')[0]) >= 20, detail: process.version }));
  await add('ADB available', async () => {
    const result = await run(process.env.ADB || 'adb', ['version']);
    return { ok: result.ok, detail: result.ok ? result.output.split('\n')[0] : 'not on PATH — bundled adb will be used by the desktop app' };
  }, 'Install platform-tools or let the desktop client use its bundled ADB.');
  await add('OpenSSL', async () => {
    const result = await run('openssl', ['version']);
    return { ok: result.ok, detail: result.ok ? result.output : 'optional — only needed for TLS pairing certificates' };
  });
  await add('Port 8787 free or in use by us', async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json()).catch(() => null);
    if (health) return { ok: true, detail: `bridge ${health.version} already running` };
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve({ ok: false, detail: 'port is occupied by another process' }));
      server.listen(8787, '127.0.0.1', () => server.close(() => resolve({ ok: true, detail: 'free' })));
    });
  });
  await add('Data directory writable', async () => {
    const dir = process.env.DEX_DATA_DIR || path.join(os.homedir(), '.android-dex');
    await mkdir(dir, { recursive: true });
    await access(dir);
    return { ok: true, detail: dir };
  });
  await add('Web console assets', async () => ({ ok: await access(path.join(REPO_ROOT, 'app', 'index.html')).then(() => true).catch(() => false), detail: path.join(REPO_ROOT, 'app') }));
  await add('SBOM present', () => access(path.join(REPO_ROOT, 'sbom', `android-dex-${VERSION}.spdx.json`)).then(() => ({ ok: true, detail: 'signed release SBOM' })).catch(() => ({ ok: false, detail: 'run npm run sbom' })));

  if (jsonOutput) return print({ bridge: baseUrl, version: VERSION, checks });
  console.log(`\n${bold('Android DEX doctor')} ${dim(`v${VERSION} · ${os.platform()} ${os.arch()}`)}\n`);
  for (const check of checks) {
    console.log(`${check.ok ? green('✔') : yellow('!')} ${check.name.padEnd(34)} ${dim(check.detail || '')}`);
    if (!check.ok && check.hint) console.log(`  ${dim('→ ' + check.hint)}`);
  }
  console.log('');
}

async function serve() {
  const bridge = await createBridge({
    port: Number(flags.port) || undefined,
    host: flags.host || '0.0.0.0',
    token: typeof flags.token === 'string' ? flags.token : undefined,
    dataDir: flags['data-dir'],
    shareDir: flags['share-dir'],
  });
  await bridge.start();
  console.log(`Android DEX Bridge ${VERSION} listening on ${bridge.url}`);
  console.log(`Console: ${bridge.url}/  ·  token ${bridge.config.token || '(none)'}`);
  console.log('Press Ctrl+C to stop.');
  const shutdown = async () => { await bridge.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function listDevices() {
  const data = await api('/api/devices');
  if (jsonOutput) return print(data);
  console.log(bold('\nDevices\n'));
  for (const device of data.devices) {
    const active = device.id === data.activeDeviceId ? green('● active') : dim('○');
    console.log(`${active} ${device.name.padEnd(20)} ${device.status.padEnd(13)} ${device.transport.padEnd(5)} ${device.battery.level.toFixed(0)}%  ${dim(device.id)}`);
  }
  console.log(dim(`\nReconnect: ${data.reconnect.state} · attempt ${data.reconnect.attempt} · health ${data.reconnect.healthScore}\n`));
}

async function clipboard() {
  const sub = positionals.shift();
  if (!sub || sub === 'list') {
    const data = await api('/api/clipboard');
    if (jsonOutput) return print(data);
    console.log(bold('\nClipboard\n'));
    data.items.forEach((item, index) => {
      const pinned = item.pinned ? yellow('★') : ' ';
      console.log(`${pinned} ${String(index + 1).padStart(2)} ${item.kind.padEnd(6)} ${dim(item.source.padEnd(8))} ${item.text.replace(/\s+/g, ' ').slice(0, 90)}`);
    });
    console.log('');
    return;
  }
  if (sub === 'set' || sub === 'push') {
    const text = positionals.join(' ') || flags.text;
    if (!text) throw new Error('usage: android-dex clip set "text"');
    return print(await api('/api/clipboard', { method: 'POST', body: { kind: 'text', text, source: 'desktop' } }));
  }
  if (sub === 'copy') {
    return print(await api(`/api/clipboard/${positionals[0]}/copy`, { method: 'POST', body: { target: flags.target || 'host' } }));
  }
  if (sub === 'clear') return print(await api('/api/clipboard/clear', { method: 'POST', body: { keepPinned: flags.all ? false : true } }));
  throw new Error(`unknown clipboard command "${sub}"`);
}

async function sms() {
  const sub = positionals.shift() || 'list';
  if (sub === 'list') {
    const data = await api('/api/telephony/conversations');
    if (jsonOutput) return print(data);
    console.log(bold('\nConversations\n'));
    data.conversations.forEach((conversation) => {
      const last = conversation.messages.at(-1);
      console.log(`${conversation.unread ? yellow('●') : ' '} ${conversation.name.padEnd(18)} ${dim((last?.text || '').slice(0, 70))}`);
    });
    console.log('');
    return;
  }
  if (sub === 'send') {
    if (!flags.to) throw new Error('usage: android-dex sms send --to <number> --text "message"');
    return print(await api('/api/telephony/messages', { method: 'POST', body: { number: flags.to, text: flags.text } }));
  }
  if (sub === 'read') {
    const data = await api(`/api/telephony/conversations/${positionals[0]}`);
    if (jsonOutput) return print(data);
    console.log(bold(`\n${data.name} ${dim(data.number)}\n`));
    data.messages.forEach((message) => console.log(`${message.from === 'me' ? green('you') : data.name}: ${message.text} ${dim(message.ts.slice(11, 16))}`));
    console.log('');
    return;
  }
  throw new Error(`unknown sms command "${sub}"`);
}

async function launch() {
  const target = positionals[0];
  if (!target) throw new Error('usage: android-dex launch <appId|package>');
  const { apps } = await api('/api/apps');
  const app = apps.find((item) => item.id === target || item.package === target || item.name.toLowerCase() === target.toLowerCase());
  if (!app) throw new Error(`app "${target}" not found (try: android-dex apps)`);
  print(await api('/api/windows', { method: 'POST', body: { appId: app.id } }));
}

async function apps() {
  const data = await api('/api/apps');
  if (jsonOutput) return print(data);
  const groups = new Map();
  for (const app of data.apps) {
    if (!groups.has(app.category)) groups.set(app.category, []);
    groups.get(app.category).push(app);
  }
  console.log('');
  for (const [category, list] of groups) {
    console.log(bold(category));
    for (const app of list) console.log(`  ${app.name.padEnd(18)} ${dim(app.package)}`);
  }
  console.log('');
}

async function windows() {
  const data = await api('/api/windows');
  if (flags.layout) {
    return print(await api('/api/windows/layout', { method: 'POST', body: { preset: flags.layout, monitorId: flags.monitor } }));
  }
  if (jsonOutput) return print(data);
  console.log(bold('\nWindows\n'));
  for (const win of data.windows) {
    const flagsText = [win.alwaysOnTop && 'pinned', win.pip && 'PiP', win.orientation, `${win.dpi}dpi`, win.monitorId].filter(Boolean).join(' · ');
    console.log(`  ${win.title.padEnd(16)} ${String(win.w).padStart(5)}×${String(win.h).padEnd(5)} ${dim(flagsText)}`);
  }
  console.log(dim(`\nMonitors: ${data.monitors.map((monitor) => `${monitor.name} ${monitor.width}×${monitor.height}`).join(' | ')}\n`));
}

async function profiles() {
  const sub = positionals.shift() || 'list';
  if (sub === 'list') {
    const data = await api('/api/gaming/profiles');
    if (jsonOutput) return print(data);
    console.log(bold('\nGame profiles\n'));
    data.profiles.forEach((profile) => console.log(`  ${profile.name.padEnd(30)} ${profile.game.padEnd(22)} ${String(profile.controls.length).padStart(2)} controls  ${dim(profile.sharing)}`));
    console.log(dim(`\nAim-assist disclosure: ${data.fairPlay.acknowledged ? green('accepted') : yellow('not accepted')} (doc/FAIR_PLAY.md)\n`));
    return;
  }
  if (sub === 'export') {
    const data = await api(`/api/gaming/profiles/${positionals[0]}/export`);
    if (flags.out) {
      await writeFile(flags.out, JSON.stringify(data.json, null, 2));
      console.log(`Saved ${flags.out}\nShare code:\n${data.shareCode}`);
    } else print(data.shareCode);
    return;
  }
  if (sub === 'import') {
    const source = positionals[0];
    if (!source) throw new Error('usage: android-dex profiles import <file|dexgame:code>');
    const code = source.startsWith('dexgame:') ? source : await (await import('node:fs/promises')).readFile(source, 'utf8');
    return print(await api('/api/gaming/import', { method: 'POST', body: { code } }));
  }
  if (sub === 'publish') return print(await api(`/api/gaming/profiles/${positionals[0]}/publish`, { method: 'POST', body: {} }));
  if (sub === 'marketplace') return print(await api('/api/gaming/marketplace'));
  throw new Error(`unknown profiles command "${sub}"`);
}

async function settings() {
  if (!positionals.length) return print(await api('/api/settings'));
  const patch = {};
  for (const assignment of positionals) {
    const [key, raw] = assignment.split('=');
    if (!key || raw === undefined) throw new Error('usage: android-dex settings theme=light uiScale=110');
    patch[key] = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
  }
  return print(await api('/api/settings', { method: 'PATCH', body: patch }));
}

async function screenshot() {
  const shot = await api('/api/capture/screenshot', { method: 'POST', body: { label: flags.label } });
  const response = await api(shot.url, { raw: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  const out = flags.out || path.join(process.cwd(), shot.name);
  await writeFile(out, buffer);
  console.log(`Screenshot saved: ${out} (${humanBytes(buffer.length)})`);
}

async function record() {
  const sub = positionals.shift() || 'start';
  if (sub === 'start') return print(await api('/api/capture/record/start', { method: 'POST', body: {} }));
  if (sub === 'stop') return print(await api('/api/capture/record/stop', { method: 'POST', body: {} }));
  throw new Error('usage: android-dex record start|stop');
}

async function mount() {
  const data = await api('/api/mount');
  if (jsonOutput) return print(data);
  console.log(bold('\nMount the phone share\n'));
  console.log(`WebDAV URL: ${data.webdav.url}`);
  console.log(`Share dir:  ${data.shareDir}`);
  console.log(dim(`Auth: ${data.webdav.auth}\n`));
  console.log('Windows:');
  data.instructions.windows.forEach((line) => console.log(`  ${line}`));
  console.log('\nmacOS:');
  data.instructions.macos.forEach((line) => console.log(`  ${line}`));
  console.log('\nLinux:');
  data.instructions.linux.forEach((line) => console.log(`  ${line}`));
  console.log('');
}

function openUrl(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, argv, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* headless host: URL is printed anyway */ });
    child.unref();
  } catch { /* headless host */ }
}

async function openConsole() {
  const port = Number(flags.port) || Number(new URL(baseUrl).port) || 8787;
  let health = await fetch(`${baseUrl}/api/health`).then((response) => response.json()).catch(() => null);
  if (!health) {
    console.log(dim(`Bridge not reachable at ${baseUrl}; starting it on port ${port}…`));
    const cli = new URL(import.meta.url).pathname;
    const child = spawn(process.execPath, [cli, 'serve', '--host', '127.0.0.1', '--port', String(port)], {
      detached: true, stdio: 'ignore', env: process.env,
    });
    child.unref();
    for (let i = 0; i < 20 && !health; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json()).catch(() => null);
    }
  }
  const view = typeof flags.view === 'string' ? `#/${flags.view}` : '';
  const url = `http://127.0.0.1:${port}/${token ? `?token=${encodeURIComponent(token)}` : ''}${view}`;
  if (!jsonOutput) console.log(`Opening ${url}`);
  openUrl(url);
  if (jsonOutput) print({ url, running: Boolean(health), version: health?.version || null });
}

async function pair() {
  const data = await api('/api/pair/start', { method: 'POST', body: { deviceName: flags['device-name'] || 'Android device', transport: flags.transport || 'wifi' } });
  if (flags.open) openUrl(`${baseUrl}/?pair=${encodeURIComponent(data.pairingId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
  if (jsonOutput) return print(data);
  console.log(bold('\nPair a new device\n'));
  console.log(`1. Open the console: ${baseUrl}/?pair=${data.pairingId}`);
  console.log(`2. Or scan this payload in the companion app:\n\n${data.qrPayload}\n`);
  console.log(`Pairing code: ${bold(data.code)}   (expires in 2 minutes)`);
  console.log(`Bridge fingerprint: ${data.fingerprint}`);
  console.log(dim('\nSteps:\n  ' + data.adbSteps.join('\n  ')));
  console.log('');
}

async function main() {
  switch (command) {
    case 'serve': return serve();
    case 'open': return openConsole();
    case 'doctor': return doctor();
    case 'devices': return listDevices();
    case 'apps': return apps();
    case 'launch': return launch();
    case 'windows': return windows();
    case 'connect':
      return print(await api('/api/devices/connect', { method: 'POST', body: { transport: flags.transport || 'usb', deviceId: flags.device } }));
    case 'disconnect': return print(await api('/api/devices/disconnect', { method: 'POST', body: {} }));
    case 'reconnect': return print(await api('/api/devices/reconnect', { method: 'POST', body: {} }));
    case 'clip':
    case 'clipboard': return clipboard();
    case 'sms': return sms();
    case 'call': {
      if (!positionals[0]) throw new Error('usage: android-dex call <number|contact>');
      return print(await api('/api/telephony/calls', { method: 'POST', body: { number: positionals[0] } }));
    }
    case 'hangup': {
      const { calls } = await api('/api/telephony/calls');
      const active = positionals[0] ? calls.find((call) => call.id === positionals[0]) : calls.find((call) => ['ringing', 'active', 'dialing'].includes(call.status));
      if (!active) throw new Error('no active call');
      return print(await api(`/api/telephony/calls/${active.id}/hangup`, { method: 'POST', body: {} }));
    }
    case 'search': return print(await api(`/api/search?q=${encodeURIComponent(positionals.join(' '))}`));
    case 'screenshot': return screenshot();
    case 'record': return record();
    case 'profiles': return profiles();
    case 'settings': return settings();
    case 'mount': return mount();
    case 'pair': return pair();
    case 'plugins': {
      if ((positionals[0] || 'list') === 'list') return print(await api('/api/plugins'));
      if (positionals[0] === 'enable') return print(await api(`/api/plugins/${positionals[1]}`, { method: 'PATCH', body: { enabled: true } }));
      if (positionals[0] === 'disable') return print(await api(`/api/plugins/${positionals[1]}`, { method: 'PATCH', body: { enabled: false } }));
      throw new Error('usage: android-dex plugins list|enable|disable <id>');
    }
    case 'diagnostics': return print(await api('/api/diagnostics'));
    case 'bench': return print(await api('/api/diagnostics/benchmark', { method: 'POST', body: {} }));
    case 'api': {
      const method = (positionals.shift() || 'GET').toUpperCase();
      const pathname = positionals.shift();
      if (!pathname) throw new Error('usage: android-dex api GET /api/health [json-body]');
      const body = positionals.length ? JSON.parse(positionals.join(' ')) : undefined;
      return print(await api(pathname, { method, body }));
    }
    case 'version': console.log(`android-dex ${VERSION}`); return;
    case 'help':
    case undefined:
      console.log(`
${bold('Android DEX CLI')} ${dim('v' + VERSION)}

Usage: android-dex <command> [options]

  serve                 Start the headless bridge (default: 0.0.0.0:8787)
  open [--view name]    Start the bridge if needed and open the console
  doctor                Check Node, ADB, OpenSSL, port and data directory
  devices               List devices and reconnect health
  connect               Connect a device  [--transport usb|wifi] [--device id]
  disconnect            Drop the active connection
  reconnect             Force an immediate reconnect
  apps                  List installed apps
  launch <app>          Launch an app window
  windows [--layout]    List windows / apply a tiling preset
  clip list|set|copy    Clipboard history and write-through
  sms list|send|read    Conversations, send SMS/MMS
  call <number>         Place a call
  hangup [callId]       End the active call
  screenshot            Capture (saved to ./ and the share)
  record start|stop     Screen recording
  profiles ...          list|export|import|publish|marketplace
  search <query>        Universal search
  settings [k=v ...]    Read or patch settings
  mount                 WebDAV mount instructions
  pair                  Start QR/token pairing
  plugins ...           list|enable|disable
  diagnostics           Bridge diagnostics
  bench                 Micro-benchmark
  api <method> <path>   Raw API call
  version | help

Global: --json --url <url> --token <token>
Env:    DEX_URL, DEX_TOKEN, DEX_DATA_DIR, DEX_SHARE_DIR
`);
      return;
    default:
      throw new Error(`unknown command "${command}" (try: android-dex help)`);
  }
}

main().catch((error) => {
  console.error(`${red('error')} ${error.message}`);
  if (error.cause) console.error(dim(String(error.cause)));
  process.exitCode = 1;
});
