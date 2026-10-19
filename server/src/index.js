/**
 * Android DEX Bridge — entry point.
 *
 *   node src/index.js serve [--port 8787] [--host 0.0.0.0] [--token ...]
 *
 * Runs headless on any OS (including a Raspberry Pi) and serves the web console
 * plus REST/WebSocket/WebDAV endpoints. No runtime dependencies.
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http.js';
import { createSupervisor } from './supervisor.js';
import { createWebdav } from './webdav.js';
import { WebSocketHub } from './ws.js';
import { createRuntime } from './state.js';
import { initClipboard } from './features/clipboard.js';
import { initDiagnostics } from './features/diagnostics.js';
import { initFiles } from './features/files.js';
import { initGaming } from './features/gaming.js';
import { initMedia } from './features/media.js';
import { initNotifications } from './features/notifications.js';
import { initPlugins } from './features/plugins.js';
import { initSearch } from './features/search.js';
import { initSystem } from './features/system.js';
import { initTelephony } from './features/telephony.js';
import { initUpdates } from './features/updates.js';
import { initWindows } from './features/windows.js';
import { initPairing } from './pairing.js';
import { Logger, VERSION, nowIso } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

const envFlag = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value === 'true';
};

export async function createBridge(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const logger = new Logger({ level: options.logLevel || process.env.DEX_LOG_LEVEL || 'info' });
  const dataDir = options.dataDir || process.env.DEX_DATA_DIR || path.join(os.homedir(), '.android-dex');
  const shareDir = options.shareDir || process.env.DEX_SHARE_DIR || path.join(dataDir, 'share');
  const port = Number(options.port ?? process.env.DEX_PORT ?? 8787);
  const host = options.host || process.env.DEX_HOST || '127.0.0.1';
  const token = options.token ?? process.env.DEX_TOKEN ?? null;
  const appDir = options.appDir === undefined ? path.join(repoRoot, 'app') : options.appDir;
  const pluginsDir = options.pluginsDir || process.env.DEX_PLUGINS_DIR || path.join(repoRoot, 'server', 'plugins');

  const runtime = createRuntime({ dataDir, logger, logFile: path.join(dataDir, 'logs', 'bridge.log') });
  await runtime.hydrate();

  const files = await initFiles(runtime, { shareDir });
  const media = await initMedia(runtime, { shareDir });
  await media.init();
  const modules = {
    files,
    media,
    clipboard: initClipboard(runtime),
    telephony: initTelephony(runtime),
    windows: initWindows(runtime),
    system: initSystem(runtime),
    gaming: initGaming(runtime, { dataDir, shareDir }),
    notifications: initNotifications(runtime),
    updates: initUpdates(runtime, { dataDir }),
    plugins: await initPlugins(runtime, { pluginsDir }),
    diagnostics: initDiagnostics(runtime, { dataDir, rootDir: repoRoot }),
  };
  modules.search = initSearch(runtime, { files });
  modules.pairing = await initPairing(runtime, { dataDir, host: host === '0.0.0.0' ? os.hostname() : host, port });
  modules.supervisor = createSupervisor(runtime);
  modules.webdav = createWebdav({ files, runtime, token });

  const config = {
    host, port, token, dataDir, shareDir, appDir, repoRoot, pluginsDir,
    allowedOrigins: (process.env.DEX_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  };
  modules.config = config;

  const ws = new WebSocketHub({ runtime, token });
  modules.ws = ws;
  ws.attach();

  const command = async (action, payload) => {
    switch (action) {
      case 'launch': return modules.windows.launch(payload.appId || payload.package?.split('.').pop(), payload);
      case 'window.snap': return modules.windows.snap(payload.windowId, payload.zone);
      case 'window.patch': return modules.windows.patch(payload.windowId, payload.patch || payload);
      case 'media.control': return modules.media.control(payload);
      case 'clipboard.add': return modules.clipboard.add(payload);
      case 'sms.send': return modules.telephony.send(payload);
      case 'call.start': return modules.telephony.call(payload);
      case 'call.hangup': return modules.telephony.hangup(payload.callId);
      case 'settings.patch': return runtime.patchSettings(payload);
      case 'search': return modules.search.query(payload.q, payload);
      case 'screenshot': return modules.media.screenshot(payload);
      case 'ping': return { pong: true, ts: nowIso() };
      default: {
        const error = new Error(`unknown command "${action}"`);
        error.code = 'unknown_command';
        throw error;
      }
    }
  };
  ws.onCommand(command);

  const server = createHttpServer({ runtime, modules, config });

  const bridge = {
    runtime, modules, server, ws, config, logger,
    command,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    async start({ telemetry = true } = {}) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          if (address && typeof address === 'object') {
            config.port = address.port;
            bridge.config.port = address.port;
            bridge.url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`;
          }
          resolve();
        });
      });
      if (telemetry) runtime.startTelemetry(2500);
      modules.supervisor.start();
      logger.info('bridge', `listening on ${bridge.url} (token ${token ? 'required' : 'not set'})`);
      return bridge;
    },
    async stop() {
      runtime.stopTelemetry();
      modules.supervisor.stop();
      ws.close();
      await runtime.store.flush();
      await new Promise((resolve) => server.close(resolve));
    },
    async fetch(pathname, init = {}) {
      const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${bridge.url}${pathname}`, { ...init, headers });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      return payload;
    },
    /** Used by the test harness and `--self-check`. */
    async selfCheck() {
      const checks = [];
      const add = (name, fn) => { try { checks.push({ name, ok: Boolean(fn()) }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } };
      add('state hydrated', () => runtime.state.devices.length > 0);
      add('share directory writable', () => files.shareDir.length > 0);
      add('pairing identity', () => modules.pairing.fingerprint.startsWith('SHA256:'));
      add('websocket hub', () => typeof ws.handleUpgrade === 'function');
      add('openapi route', () => server.routes.some((item) => item.pattern === '/api/openapi.json'));
      return { ok: checks.every((check) => check.ok), version: VERSION, checks };
    },
  };

  return bridge;
}

function parseServeArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++i]);
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--token') options.token = argv[++i];
    else if (arg === '--data-dir') options.dataDir = argv[++i];
    else if (arg === '--share-dir') options.shareDir = argv[++i];
    else if (arg === '--no-app') options.appDir = null;
    else if (arg === '--log-level') options.logLevel = argv[++i];
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'serve') argv.shift();
  const bridge = await createBridge(parseServeArgs(argv));
  await bridge.start();
  const check = await bridge.selfCheck();
  const showApp = bridge.config.appDir ? `Console:    ${bridge.url}/` : null;
  console.log(`\n  Android DEX Bridge ${VERSION}\n  ${'-'.repeat(46)}`);
  console.log(`  API:        ${bridge.url}/api`);
  console.log(`  WebSocket:  ${bridge.url.replace('http', 'ws')}/ws`);
  console.log(`  WebDAV:     ${bridge.url}/dav/`);
  if (showApp) console.log(`  ${showApp}`);
  if (bridge.config.token) console.log(`  Token:      ${bridge.config.token}`);
  console.log(`  Data:       ${bridge.config.dataDir}`);
  console.log(`  Self-check: ${check.ok ? 'ok' : 'FAILED'}`);
  console.log('');
  const shutdown = async (signal) => {
    console.log(`\n  ${signal} received — flushing state and shutting down.`);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
