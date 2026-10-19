/**
 * HTTP control plane + static app host.
 *
 * Routes are declared once with metadata; the same table powers request
 * routing and the generated OpenAPI document at /api/openapi.json.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {
  HttpError, badRequest, json, notFound, nowIso, readBody, safeEqual, safeJoin, text, validate,
} from './util.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm', '.map': 'application/json',
};

function compile(pattern) {
  const keys = [];
  const regex = new RegExp('^' + pattern
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\?\//g, '/')
    .replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; }) + '$');
  return { regex, keys };
}

export function createHttpServer({ runtime, modules, config }) {
  const routes = [];
  const authToken = config.token || null;
  const appDir = config.appDir;
  const allowedOrigins = config.allowedOrigins || [];
  const webdav = modules.webdav;

  const route = (method, pattern, handler, meta = {}) => {
    const { regex, keys } = compile(pattern);
    routes.push({ method, pattern, regex, keys, handler, meta });
  };

  const publicRoutes = new Set(['GET /api/health', 'POST /api/pair/confirm', 'GET /api/openapi.json']);

  const isAuthorized = (req, url) => {
    if (!authToken) return true;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ') && safeEqual(header.slice(7), authToken)) return true;
    if (url.searchParams.get('token') && safeEqual(url.searchParams.get('token'), authToken)) return true;
    return false;
  };

  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (!origin) return;
    const preview = /^https:\/\/[a-z0-9-]+\.(e2b\.app|arena\.ai)$/i.test(origin);
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(origin);
    if (!authToken || preview || local || allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization,content-type,x-dex-token');
    res.setHeader('access-control-expose-headers', 'content-length,content-range');
    res.setHeader('access-control-max-age', '600');
  };

  const serveStatic = async (req, res, urlPath) => {
    if (!appDir) { text(res, 404, 'app directory not configured'); return; }
    let relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    let absolute;
    try { absolute = safeJoin(appDir, relative); } catch { text(res, 400, 'invalid path'); return; }
    try {
      const info = await stat(absolute);
      if (info.isDirectory()) absolute = path.join(absolute, 'index.html');
      const final = await stat(absolute);
      const type = MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type, 'content-length': final.size,
        'cache-control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors *",
      });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(absolute).pipe(res);
    } catch {
      // SPA fallback
      try {
        const index = path.join(appDir, 'index.html');
        const info = await stat(index);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': info.size, 'cache-control': 'no-store' });
        createReadStream(index).pipe(res);
      } catch {
        text(res, 404, 'not found');
      }
    }
  };

  // ── Meta ────────────────────────────────────────────────────────────────
  route('GET', '/api/health', () => ({
    ok: true, service: 'android-dex-bridge', version: '2.0.0', uptimeSec: Math.round((Date.now() - runtime.startedAt) / 1000),
    authRequired: Boolean(authToken), mode: authToken ? 'token' : 'trusted-local', timestamp: nowIso(),
    features: ['clipboard', 'files', 'webdav', 'telephony', 'notifications', 'windows', 'widgets', 'gaming', 'plugins', 'updates', 'search', 'virtual-camera', 'capture'],
  }), { summary: 'Liveness and capability discovery', tags: ['meta'], public: true });

  route('GET', '/api/state', () => runtime.snapshot(), { summary: 'Full state snapshot', tags: ['meta'] });

  // ── Settings ────────────────────────────────────────────────────────────
  route('GET', '/api/settings', () => runtime.state.settings, { summary: 'Read settings', tags: ['settings'] });

  route('PATCH', '/api/settings', ({ body }) => {
    const settings = runtime.state.settings;
    const enums = {
      theme: ['dark', 'light', 'system'], density: ['compact', 'comfortable', 'spacious'],
      bandwidth: ['low', 'medium', 'high'], audioOutput: ['desktop', 'headphones', 'android', 'hdmi'],
      updateChannel: ['stable', 'beta', 'nightly'],
    };
    for (const [key, allowed] of Object.entries(enums)) {
      if (body[key] !== undefined && !allowed.includes(body[key])) throw badRequest(`${key} must be one of ${allowed.join(', ')}`);
    }
    if (body.uiScale !== undefined && (body.uiScale < 80 || body.uiScale > 150)) throw badRequest('uiScale must be between 80 and 150');
    if (body.clipboardRetentionMinutes !== undefined && (body.clipboardRetentionMinutes < 5 || body.clipboardRetentionMinutes > 10080)) {
      throw badRequest('clipboardRetentionMinutes must be between 5 and 10080');
    }
    if (body.chargeLimit !== undefined && (body.chargeLimit < 40 || body.chargeLimit > 100)) throw badRequest('chargeLimit must be between 40 and 100');
    const known = new Set([...Object.keys(settings), 'hotkeys']);
    const unknown = Object.keys(body).filter((key) => !known.has(key));
    if (unknown.length) throw badRequest(`unknown settings: ${unknown.join(', ')}`);
    const next = runtime.patchSettings(body);
    if (body.dnd !== undefined) modules.system.toggleTile('dnd', body.dnd);
    return next;
  }, { summary: 'Patch settings (validated, broadcast over WebSocket)', tags: ['settings'], body: true });

  // ── Devices ─────────────────────────────────────────────────────────────
  route('GET', '/api/devices', () => ({ devices: runtime.state.devices, activeDeviceId: runtime.state.activeDeviceId, reconnect: runtime.state.reconnect }), { summary: 'List devices', tags: ['devices'] });

  route('POST', '/api/devices/connect', ({ body }) => {
    const transport = body.transport === 'wifi' ? 'wifi' : 'usb';
    const device = body.deviceId
      ? runtime.state.devices.find((item) => item.id === body.deviceId)
      : runtime.activeDevice();
    if (!device) throw notFound('device not found');
    device.status = 'connected';
    device.transport = transport;
    device.lastSeen = nowIso();
    runtime.state.reconnect.state = 'connected';
    runtime.state.reconnect.attempt = 0;
    runtime.emit('device.connected', { deviceId: device.id, transport });
    runtime.audit('device.connected', `${device.name} via ${transport}`, 'connection');
    return device;
  }, { summary: 'Connect a device (USB or Wi-Fi)', tags: ['devices'], body: true });

  route('POST', '/api/devices/disconnect', () => modules.supervisor.drop('user disconnected'), { summary: 'Disconnect the active device', tags: ['devices'] });
  route('POST', '/api/devices/reconnect', () => modules.supervisor.reconnectNow(), { summary: 'Force an immediate reconnect', tags: ['devices'] });
  route('POST', '/api/devices/drop', ({ body }) => modules.supervisor.drop(body.reason || 'simulated drop'), { summary: 'Simulate a transport drop (testing)', tags: ['devices'], body: true });
  route('GET', '/api/devices/reconnect/preview', () => ({ schedule: modules.supervisor.preview(10), config: runtime.state.settings.reconnectBackoff }), { summary: 'Exponential backoff preview', tags: ['devices'] });

  route('POST', '/api/devices/select', ({ body }) => {
    const device = runtime.state.devices.find((item) => item.id === body.deviceId);
    if (!device) throw notFound('device not found');
    runtime.state.activeDeviceId = device.id;
    runtime.emit('device.selected', { deviceId: device.id });
    runtime.persist();
    return device;
  }, { summary: 'Select the active device', tags: ['devices'], body: true });

  route('PATCH', '/api/devices/:id', ({ params, body }) => {
    const device = runtime.state.devices.find((item) => item.id === params.id);
    if (!device) throw notFound('device not found');
    if (body.name !== undefined) device.name = String(body.name).slice(0, 60);
    if (body.quality?.preset) {
      if (!['low', 'medium', 'high'].includes(body.quality.preset)) throw badRequest('quality preset must be low, medium or high');
      device.quality.preset = body.quality.preset;
      device.quality.bitrateMbps = { low: 3, medium: 8, high: 16 }[body.quality.preset];
      device.quality.fps = { low: 30, medium: 45, high: 60 }[body.quality.preset];
      runtime.emit('device.quality', device.quality);
    }
    runtime.persist();
    return device;
  }, { summary: 'Rename a device or change stream quality', tags: ['devices'], body: true });

  route('POST', '/api/devices/:id/wake', ({ params }) => modules.system.wake({ deviceId: params.id }), { summary: 'Wake-on-connect', tags: ['devices'] });
  route('POST', '/api/devices/:id/keepawake', ({ body }) => modules.system.keepAwake(body.enabled !== false), { summary: 'Prevent phone sleep', tags: ['devices'], body: true });
  route('POST', '/api/devices/:id/charge', ({ body }) => modules.system.chargeThrottle(body), { summary: 'Charge limit / throttling', tags: ['devices'], body: true });

  // ── Pairing ─────────────────────────────────────────────────────────────
  route('POST', '/api/pair/start', ({ body }) => modules.pairing.start(body), { summary: 'Start QR/token pairing', tags: ['security'], body: true });
  route('GET', '/api/pair/status', () => modules.pairing.status(), { summary: 'Pairing status', tags: ['security'] });
  route('POST', '/api/pair/confirm', ({ body }) => modules.pairing.confirm(body), { summary: 'Complete pairing (token + 6-digit code)', tags: ['security'], body: true, public: true });
  route('POST', '/api/pair/cancel', () => modules.pairing.cancel(), { summary: 'Cancel pairing', tags: ['security'] });
  route('DELETE', '/api/pair/:deviceId', ({ params }) => modules.pairing.revoke(params.deviceId), { summary: 'Revoke a paired fingerprint', tags: ['security'] });
  route('GET', '/api/pair/identity', () => modules.pairing.identity(), { summary: 'Bridge identity public key + fingerprint', tags: ['security'] });

  // ── Clipboard ───────────────────────────────────────────────────────────
  route('GET', '/api/clipboard', () => ({ items: modules.clipboard.list(), sync: runtime.state.settings.clipboardSync, retentionMinutes: runtime.state.settings.clipboardRetentionMinutes }), { summary: 'Clipboard history', tags: ['clipboard'] });
  route('POST', '/api/clipboard', ({ body }) => modules.clipboard.add(body), { summary: 'Push text or an image into the shared clipboard', tags: ['clipboard'], body: true });
  route('POST', '/api/clipboard/:id/copy', ({ params, body }) => modules.clipboard.copy(params.id, body.target || 'device'), { summary: 'Copy an item to host or device', tags: ['clipboard'], body: true });
  route('PATCH', '/api/clipboard/:id', ({ params }) => modules.clipboard.pin(params.id), { summary: 'Toggle pin on a clipboard item', tags: ['clipboard'] });
  route('DELETE', '/api/clipboard/:id', ({ params }) => modules.clipboard.remove(params.id), { summary: 'Delete a clipboard item', tags: ['clipboard'] });
  route('POST', '/api/clipboard/clear', ({ body }) => modules.clipboard.clear({ keepPinned: body.keepPinned !== false }), { summary: 'Clear clipboard history', tags: ['clipboard'], body: true });

  // ── Files / mount ───────────────────────────────────────────────────────
  route('GET', '/api/files', ({ query }) => modules.files.list(query.dir || ''), { summary: 'List the shared folder', tags: ['files'] });
  route('POST', '/api/files/upload', async ({ req, query }) => {
    const name = String(query.name || query.path || '').trim();
    if (!name) throw badRequest('name query parameter is required');
    const dir = String(query.dir || '').replace(/^\/+|\/+$/g, '');
    const relative = dir ? `${dir}/${name}` : name;
    const buffer = await readBody(req, { limit: 512 * 1024 * 1024, binary: true });
    return modules.files.write(relative, buffer);
  }, { summary: 'Upload a file (raw body)', tags: ['files'], raw: true });
  route('POST', '/api/files/mkdir', ({ body }) => modules.files.mkdir(body.path), { summary: 'Create a folder', tags: ['files'], body: true });
  route('GET', '/api/files/download', async ({ res, query }) => {
    const file = await modules.files.read(String(query.path || ''));
    res.writeHead(200, {
      'content-type': file.mime, 'content-length': file.size,
      'content-disposition': `attachment; filename="${file.name.replace(/"/g, '')}"`,
    });
    file.stream().pipe(res);
    return null; // response already written
  }, { summary: 'Download a file', tags: ['files'], raw: true });
  route('DELETE', '/api/files', ({ query }) => modules.files.remove(String(query.path || '')), { summary: 'Delete a file or folder', tags: ['files'] });
  route('POST', '/api/files/push', ({ body }) => modules.files.pushToDevice(body.path, body), { summary: 'Push a file to the device', tags: ['files'], body: true });
  route('POST', '/api/files/pull', ({ body }) => modules.files.pullFromDevice(body.name || `android-${Date.now()}.bin`, body.bytes), { summary: 'Pull a file from the device (companion)', tags: ['files'], body: true });
  route('GET', '/api/mount', () => ({
    webdav: { path: '/dav/', url: `http://${config.host}:${config.port}/dav/`, auth: authToken ? 'any username + bridge token' : 'none' },
    shareDir: modules.files.shareDir,
    instructions: {
      windows: [`net use Z: http://${config.host}:${config.port}/dav ${authToken ? '/USER:dex ' + authToken : ''}`.trim()],
      macos: ['Finder → Go → Connect to Server', `http://${config.host}:${config.port}/dav`],
      linux: [`sudo mount -t davfs http://${config.host}:${config.port}/dav /mnt/dex`],
    },
    cli: 'android-dex mount --print',
  }), { summary: 'WebDAV mount details', tags: ['files'] });

  // ── Telephony ───────────────────────────────────────────────────────────
  route('GET', '/api/telephony/conversations', () => ({ conversations: modules.telephony.conversations() }), { summary: 'List SMS/MMS/RCS conversations', tags: ['telephony'] });
  route('GET', '/api/telephony/conversations/:id', ({ params }) => modules.telephony.conversation(params.id), { summary: 'Read a conversation and clear unread', tags: ['telephony'] });
  route('POST', '/api/telephony/messages', ({ body }) => {
    validate(body.text, { type: 'string', max: 2000, required: false }, 'text');
    return modules.telephony.send(body);
  }, { summary: 'Send an SMS/MMS', tags: ['telephony'], body: true });
  route('POST', '/api/telephony/typing', ({ body }) => modules.telephony.setTyping(body.conversationId, body.typing), { summary: 'Relay typing indicator', tags: ['telephony'], body: true });
  route('GET', '/api/telephony/contacts', () => ({ contacts: modules.telephony.contacts() }), { summary: 'Contact list', tags: ['telephony'] });
  route('GET', '/api/telephony/calls', () => ({ calls: modules.telephony.calls() }), { summary: 'Call log', tags: ['telephony'] });
  route('POST', '/api/telephony/calls', ({ body }) => modules.telephony.call(body), { summary: 'Place a call / click-to-call', tags: ['telephony'], body: true });
  route('POST', '/api/telephony/calls/:id/answer', ({ params }) => modules.telephony.answer(params.id), { summary: 'Answer an incoming call', tags: ['telephony'] });
  route('POST', '/api/telephony/calls/:id/hangup', ({ params }) => modules.telephony.hangup(params.id), { summary: 'Hang up / decline', tags: ['telephony'] });
  route('POST', '/api/telephony/calls/:id/dtmf', ({ params, body }) => modules.telephony.dtmf(params.id, body.digits || ''), { summary: 'Send DTMF digits', tags: ['telephony'], body: true });
  route('POST', '/api/telephony/calls/:id/mute', ({ params, body }) => modules.telephony.toggleMute(params.id, body.muted !== false), { summary: 'Mute/unmute a call', tags: ['telephony'], body: true });

  // ── Notifications ───────────────────────────────────────────────────────
  route('GET', '/api/notifications', ({ query }) => ({ notifications: modules.notifications.list({ unreadOnly: query.unread === 'true' }), mirror: modules.notifications.mirrorStatus(), dnd: runtime.state.settings.dnd }), { summary: 'Notification list + OS mirror status', tags: ['notifications'] });
  route('POST', '/api/notifications/:id/action', ({ params, body }) => modules.notifications.action(params.id, body.actionId, body.payload || {}, modules.telephony), { summary: 'Inline reply or quick action', tags: ['notifications'], body: true });
  route('POST', '/api/notifications/:id/read', ({ params }) => modules.notifications.markRead(params.id), { summary: 'Mark one notification read', tags: ['notifications'] });
  route('POST', '/api/notifications/read-all', () => modules.notifications.markAllRead(), { summary: 'Mark all read', tags: ['notifications'] });
  route('DELETE', '/api/notifications/:id', ({ params }) => modules.notifications.dismiss(params.id), { summary: 'Dismiss a notification', tags: ['notifications'] });
  route('DELETE', '/api/notifications', () => modules.notifications.clear(), { summary: 'Clear notifications', tags: ['notifications'] });
  route('POST', '/api/notifications/dnd', ({ body }) => modules.notifications.setDnd(body.enabled), { summary: 'Toggle DND (synced both ways)', tags: ['notifications'], body: true });
  route('POST', '/api/notifications/test', ({ body }) => modules.notifications.pushFromAndroid(body), { summary: 'Inject a test notification', tags: ['notifications'], body: true });

  // ── System ──────────────────────────────────────────────────────────────
  route('GET', '/api/system', () => modules.system.state(), { summary: 'Lock/battery/keep-awake state', tags: ['system'] });
  route('GET', '/api/system/tiles', () => ({ tiles: modules.system.tiles() }), { summary: 'Quick settings tiles', tags: ['system'] });
  route('POST', '/api/system/tiles/:id/toggle', ({ params, body }) => modules.system.toggleTile(params.id, body.enabled), { summary: 'Toggle a quick setting', tags: ['system'], body: true });
  route('POST', '/api/system/hotspot', ({ body }) => modules.system.setHotspot(body), { summary: 'Configure hotspot', tags: ['system'], body: true });
  route('POST', '/api/system/cellular', ({ body }) => modules.system.setCellular(body), { summary: 'Cellular data controls', tags: ['system'], body: true });
  route('POST', '/api/system/lock', ({ body }) => modules.system.lock(body), { summary: 'Lock the phone, create biometric challenge', tags: ['system'], body: true });
  route('POST', '/api/system/biometric', ({ body }) => modules.system.biometric(body.challengeId, body), { summary: 'Complete forwarded biometric prompt', tags: ['system'], body: true });
  route('POST', '/api/system/keepawake', ({ body }) => modules.system.keepAwake(body.enabled !== false), { summary: 'Prevent phone sleep', tags: ['system'], body: true });

  // ── Windows, apps, monitors, widgets ────────────────────────────────────
  route('GET', '/api/windows', () => ({ windows: modules.windows.list(), monitors: modules.windows.monitors(), layouts: modules.windows.LAYOUTS, snapZones: modules.windows.SNAP_ZONES }), { summary: 'Windows and monitor topology', tags: ['windows'] });
  route('GET', '/api/apps', () => ({ apps: modules.windows.apps() }), { summary: 'Installed apps', tags: ['windows'] });
  route('POST', '/api/windows', ({ body }) => modules.windows.launch(body.appId, body), { summary: 'Launch an app window', tags: ['windows'], body: true });
  route('PATCH', '/api/windows/:id', ({ params, body }) => modules.windows.patch(params.id, body), { summary: 'Move/resize/pin/PiP/orientation/DPI/monitor', tags: ['windows'], body: true });
  route('DELETE', '/api/windows/:id', ({ params }) => modules.windows.close(params.id), { summary: 'Close a window', tags: ['windows'] });
  route('POST', '/api/windows/:id/focus', ({ params }) => modules.windows.focus(params.id), { summary: 'Focus/raise a window', tags: ['windows'] });
  route('POST', '/api/windows/:id/snap', ({ params, body }) => modules.windows.snap(params.id, body.zone), { summary: 'Snap a window to a zone', tags: ['windows'], body: true });
  route('POST', '/api/windows/layout', ({ body }) => modules.windows.applyLayout(body.preset, body.monitorId), { summary: 'Apply a tiling preset', tags: ['windows'], body: true });
  route('GET', '/api/monitors', () => ({ monitors: modules.windows.monitors() }), { summary: 'Monitor list', tags: ['windows'] });
  route('PATCH', '/api/monitors/:id', ({ params, body }) => modules.windows.updateMonitor(params.id, body), { summary: 'Monitor topology/scale/primary', tags: ['windows'], body: true });
  route('GET', '/api/hotkeys', () => ({ hotkeys: modules.windows.hotkeys() }), { summary: 'Global hotkey bindings', tags: ['windows'] });
  route('PATCH', '/api/hotkeys', ({ body }) => modules.windows.setHotkey(body.action, body.accelerator), { summary: 'Rebind a global hotkey', tags: ['windows'], body: true });
  route('POST', '/api/hotkeys/trigger', ({ body }) => modules.windows.triggerHotkey(body.action), { summary: 'Trigger a hotkey action', tags: ['windows'], body: true });
  const launcherEntry = ({ params, query }) => modules.windows.launcherEntry(params.id, query.platform || 'linux');
  route('GET', '/api/apps/:id/launcher', launcherEntry, { summary: 'Generate a host launcher entry', tags: ['windows'] });
  route('POST', '/api/apps/:id/launcher', launcherEntry, { summary: 'Generate a host launcher entry (POST)', tags: ['windows'] });
  route('GET', '/api/widgets', () => ({ widgets: modules.windows.widgets() }), { summary: 'Desktop widgets', tags: ['windows'] });
  route('POST', '/api/widgets', ({ body }) => modules.windows.addWidget(body), { summary: 'Add an Android widget', tags: ['windows'], body: true });
  route('PATCH', '/api/widgets/:id', ({ params, body }) => modules.windows.patchWidget(params.id, body), { summary: 'Move/configure a widget', tags: ['windows'], body: true });
  route('DELETE', '/api/widgets/:id', ({ params }) => modules.windows.removeWidget(params.id), { summary: 'Remove a widget', tags: ['windows'] });

  // ── Media / IO ──────────────────────────────────────────────────────────
  route('GET', '/api/media', () => ({ ...modules.media.sessions(), mic: { enabled: !runtime.state.media.micMuted, gain: runtime.state.media.micGain, device: runtime.state.settings.hostMicDevice }, webcam: { enabled: runtime.state.media.virtualCamera, streamUrl: '/api/media/webcam/stream', fps: runtime.state.media.webcamFps }, recording: runtime.state.media.recording }), { summary: 'Media sessions, mic and camera state', tags: ['media'] });
  route('POST', '/api/media/control', ({ body }) => modules.media.control(body), { summary: 'Play/pause/seek/volume', tags: ['media'], body: true });
  route('POST', '/api/media/route', ({ body }) => modules.media.route(body), { summary: 'Audio output routing', tags: ['media'], body: true });
  route('POST', '/api/media/mic', ({ body }) => modules.media.mic(body), { summary: 'Mic passthrough', tags: ['media'], body: true });
  route('POST', '/api/media/webcam', ({ body }) => modules.media.webcam(body), { summary: 'Enable virtual camera', tags: ['media'], body: true });
  route('GET', '/api/media/webcam/latest', async ({ res }) => {
    const frame = modules.media.latestFrame();
    if (frame.buffer) {
      res.writeHead(200, { 'content-type': frame.mime, 'content-length': frame.buffer.length, 'cache-control': 'no-store' });
      res.end(frame.buffer);
    } else {
      const { renderVirtualDesktop } = await import('./png.js');
      const png = renderVirtualDesktop({ width: 640, height: 360 });
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' });
      res.end(png);
    }
    return null;
  }, { summary: 'Latest virtual camera still', tags: ['media'], raw: true });
  route('GET', '/api/media/webcam/stream', ({ res }) => { modules.media.addStreamClient(res); return null; }, { summary: 'MJPEG virtual camera stream', tags: ['media'], raw: true });
  route('POST', '/api/media/webcam/frame', async ({ req }) => {
    const type = String(req.headers['content-type'] || 'image/jpeg').split(';')[0];
    const buffer = await readBody(req, { limit: 8 * 1024 * 1024, binary: true });
    return modules.media.acceptFrame(buffer, { mime: type });
  }, { summary: 'Ingest a camera frame (companion)', tags: ['media'], raw: true });
  route('POST', '/api/input/gamepad', ({ body }) => modules.media.gamepad(body), { summary: 'Gamepad state passthrough', tags: ['input'], body: true });
  route('POST', '/api/input/stylus', ({ body }) => { runtime.state.settings.stylusPressure = true; return modules.media.stylus(body); }, { summary: 'Stylus pressure/tilt passthrough', tags: ['input'], body: true });

  // ── Capture ─────────────────────────────────────────────────────────────
  route('POST', '/api/capture/screenshot', ({ body }) => modules.media.screenshot(body), { summary: 'Take a screenshot (saved to the share)', tags: ['capture'], body: true });
  route('GET', '/api/capture/shots', () => ({ screenshots: modules.media.screenshots() }), { summary: 'Screenshot gallery', tags: ['capture'] });
  route('POST', '/api/capture/record/start', ({ body }) => modules.media.startRecording(body), { summary: 'Start screen recording', tags: ['capture'], body: true });
  route('POST', '/api/capture/record/stop', async ({ req }) => {
    const type = String(req.headers['content-type'] || '');
    if (type.startsWith('video/') || type === 'application/octet-stream') {
      const buffer = await readBody(req, { limit: 512 * 1024 * 1024, binary: true });
      return modules.media.stopRecording({ mime: type.split(';')[0], buffer });
    }
    if (type.includes('application/json')) {
      const parsed = await readBody(req, { limit: 1024 * 1024 });
      return modules.media.stopRecording(parsed || {});
    }
    return modules.media.stopRecording({});
  }, { summary: 'Stop recording (optionally upload WebM body)', tags: ['capture'], raw: true });
  route('GET', '/api/capture/records', () => ({ recordings: modules.media.recordings() }), { summary: 'Recording gallery', tags: ['capture'] });

  // ── Gaming ──────────────────────────────────────────────────────────────
  route('GET', '/api/gaming/profiles', () => ({ profiles: modules.gaming.profiles(), fairPlay: modules.gaming.fairPlay() }), { summary: 'Game profiles', tags: ['gaming'] });
  route('POST', '/api/gaming/profiles', ({ body }) => modules.gaming.create(body), { summary: 'Create a profile', tags: ['gaming'], body: true });
  route('PATCH', '/api/gaming/profiles/:id', ({ params, body }) => modules.gaming.update(params.id, body), { summary: 'Update a profile', tags: ['gaming'], body: true });
  route('DELETE', '/api/gaming/profiles/:id', ({ params }) => modules.gaming.remove(params.id), { summary: 'Delete a profile', tags: ['gaming'] });
  route('POST', '/api/gaming/profiles/:id/bind', ({ params, body }) => modules.gaming.bind(params.id, body.controlId, body.key), { summary: 'Rebind a control key', tags: ['gaming'], body: true });
  route('POST', '/api/gaming/profiles/:id/sensitivity', ({ params, body }) => modules.gaming.setSensitivity(params.id, body), { summary: 'Sensitivity curves + deadzone', tags: ['gaming'], body: true });
  route('POST', '/api/gaming/profiles/:id/macros', ({ params, body }) => modules.gaming.addMacro(params.id, body), { summary: 'Add a macro', tags: ['gaming'], body: true });
  route('PATCH', '/api/gaming/profiles/:id/macros/:macroId', ({ params, body }) => modules.gaming.updateMacro(params.id, params.macroId, body), { summary: 'Edit a macro timeline', tags: ['gaming'], body: true });
  route('DELETE', '/api/gaming/profiles/:id/macros/:macroId', ({ params }) => modules.gaming.removeMacro(params.id, params.macroId), { summary: 'Delete a macro', tags: ['gaming'] });
  route('POST', '/api/gaming/profiles/:id/macros/record', ({ params, body }) => modules.gaming.recordMacro(params.id, body), { summary: 'Convert captured events into a macro', tags: ['gaming'], body: true });
  route('POST', '/api/gaming/profiles/:id/controller', ({ params, body }) => modules.gaming.mapController(params.id, body), { summary: 'Controller-to-touch mapping', tags: ['gaming'], body: true });
  route('GET', '/api/gaming/profiles/:id/export', ({ params }) => modules.gaming.exportProfile(params.id), { summary: 'Export profile + share code', tags: ['gaming'] });
  route('POST', '/api/gaming/import', ({ body }) => modules.gaming.importProfile(body.code || body.profile || body), { summary: 'Import profile or share code', tags: ['gaming'], body: true });
  route('POST', '/api/gaming/profiles/:id/publish', ({ params }) => modules.gaming.publish(params.id), { summary: 'Publish to the local catalog', tags: ['gaming'] });
  route('GET', '/api/gaming/marketplace', () => modules.gaming.marketplace(), { summary: 'Community catalog (self-hosted)', tags: ['gaming'] });
  route('POST', '/api/gaming/marketplace/:id/install', ({ params }) => modules.gaming.installFromMarketplace(params.id), { summary: 'Install a catalog profile', tags: ['gaming'] });
  route('POST', '/api/gaming/profiles/:id/sync', ({ params }) => modules.gaming.sync(params.id), { summary: 'Opt-in profile sync', tags: ['gaming'] });
  route('GET', '/api/gaming/sync', () => modules.gaming.syncStatus(), { summary: 'Profile sync status', tags: ['gaming'] });
  route('GET', '/api/gaming/fairplay', () => modules.gaming.fairPlay(), { summary: 'Fair-play disclosure state', tags: ['gaming'] });
  route('POST', '/api/gaming/fairplay/ack', () => modules.gaming.acknowledgeFairPlay(), { summary: 'Accept fair-play disclosure', tags: ['gaming'] });

  // ── Universal search ────────────────────────────────────────────────────
  route('GET', '/api/search', async ({ query }) => {
    const q = String(query.q || '').slice(0, 120);
    return modules.search.query(q, { limit: Math.min(Number(query.limit) || 8, 20) });
  }, { summary: 'Universal search', tags: ['search'] });

  // ── Updates ─────────────────────────────────────────────────────────────
  route('GET', '/api/updates', () => modules.updates.state(), { summary: 'Update state', tags: ['updates'] });
  route('GET', '/api/updates/channels', async () => ({ channels: await modules.updates.channels() }), { summary: 'Release channels', tags: ['updates'] });
  route('POST', '/api/updates/check', () => modules.updates.check(), { summary: 'Check for updates', tags: ['updates'] });
  route('POST', '/api/updates/apply', () => modules.updates.apply(), { summary: 'Verify and stage an update', tags: ['updates'] });
  route('PATCH', '/api/updates/channel', ({ body }) => modules.updates.channel(body.channel), { summary: 'Switch update channel', tags: ['updates'], body: true });

  // ── Plugins ─────────────────────────────────────────────────────────────
  route('GET', '/api/plugins', () => ({ plugins: modules.plugins.list(), permissions: modules.plugins.permissions, hooks: modules.plugins.hooks }), { summary: 'List plugins and permission model', tags: ['plugins'] });
  route('POST', '/api/plugins/scan', () => modules.plugins.scan(), { summary: 'Rescan the plugins directory', tags: ['plugins'] });
  route('PATCH', '/api/plugins/:id', ({ params, body }) => modules.plugins.enable(params.id, body.enabled !== false), { summary: 'Enable/disable a plugin', tags: ['plugins'], body: true });
  route('POST', '/api/plugins/:id/hooks/:event', ({ params, body }) => modules.plugins.invoke(params.id, params.event, body), { summary: 'Invoke a plugin hook', tags: ['plugins'], body: true });

  // ── Diagnostics ─────────────────────────────────────────────────────────
  route('GET', '/api/diagnostics', () => modules.diagnostics.summary(), { summary: 'Diagnostics summary', tags: ['diagnostics'] });
  route('GET', '/api/diagnostics/logs', ({ query }) => ({ entries: modules.diagnostics.logs(query.count, query.level) }), { summary: 'Ring-buffer logs', tags: ['diagnostics'] });
  route('GET', '/api/diagnostics/sbom', () => modules.diagnostics.sbom(), { summary: 'SBOM for bundled binaries', tags: ['diagnostics'] });
  route('GET', '/api/diagnostics/compatibility', () => modules.diagnostics.compatibility(), { summary: 'Supported devices matrix', tags: ['diagnostics'] });
  route('POST', '/api/diagnostics/crash-reports', ({ body }) => modules.diagnostics.setCrashReporting(body.enabled), { summary: 'Opt in/out of local crash bundles', tags: ['diagnostics'], body: true });
  route('POST', '/api/diagnostics/crashes', ({ body }) => modules.diagnostics.reportCrash(body), { summary: 'Store a local crash bundle (opt-in)', tags: ['diagnostics'], body: true });
  route('GET', '/api/diagnostics/crashes', () => modules.diagnostics.crashes(), { summary: 'List local crash bundles', tags: ['diagnostics'] });
  route('DELETE', '/api/diagnostics/crashes', () => modules.diagnostics.purgeCrashes(), { summary: 'Purge crash bundles', tags: ['diagnostics'] });
  route('POST', '/api/diagnostics/benchmark', () => modules.diagnostics.benchmark(), { summary: 'Run the micro-benchmark', tags: ['diagnostics'] });

  // ── OpenAPI ─────────────────────────────────────────────────────────────
  route('GET', '/api/openapi.json', () => ({
    openapi: '3.1.0',
    info: {
      title: 'Android DEX Bridge API', version: '2.0.0',
      description: 'Local-only REST + WebSocket control plane. Auth: Authorization: Bearer <token> or ?token=.',
      license: { name: 'Proprietary — see LICENSE' },
    },
    servers: [{ url: `http://${config.host}:${config.port}` }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } },
    },
    security: authToken ? [{ bearerAuth: [] }] : [],
    paths: Object.fromEntries(routes.filter((item) => item.meta.summary).map((item) => {
      const pathKey = item.pattern.replace(/:(\w+)/g, '{$1}');
      return [pathKey, { [item.method.toLowerCase()]: {
        summary: item.meta.summary, tags: item.meta.tags || [], operationId: `${item.method.toLowerCase()}_${pathKey.replace(/[^\w]+/g, '_')}`,
        ...(item.meta.public ? { security: [] } : {}),
        ...(item.meta.body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
        responses: { 200: { description: 'Success' }, 400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        parameters: compile(item.pattern).keys.map((key) => ({ name: key, in: 'path', required: true, schema: { type: 'string' } })),
      } }];
    })),
    'x-websocket': { url: '/ws', protocol: 'Events: type + payload + ts. Commands: {type:"command",id,action,payload}.' },
  }), { summary: 'This document', tags: ['meta'], public: true });

  const findRoute = (method, pathname) => {
    for (const item of routes) {
      if (item.method !== method) continue;
      const match = item.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      item.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); });
      return { item, params };
    }
    return null;
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    runtime.state.diagnostics.metrics.httpRequests += 1;
    cors(req, res);
    res.setHeader('x-dex-version', '2.0.0');
    res.setHeader('x-frame-options', 'SAMEORIGIN');

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) { res.writeHead(204); res.end(); return; }

    try {
      if (pathname === '/healthz') { json(res, 200, { ok: true }); return; }
      if (pathname.startsWith('/dav')) { await webdav(req, res, pathname); return; }

      if (pathname.startsWith('/api/')) {
        const match = findRoute(req.method.toUpperCase(), pathname);
        if (!match) {
          if (!routes.some((item) => item.regex.test(pathname))) throw notFound(`no route for ${req.method} ${pathname}`);
          throw new HttpError(405, `${req.method} not allowed on ${pathname}`, 'method_not_allowed');
        }
        const { item, params } = match;
        const publicKey = `${item.method} ${item.pattern}`;
        if (!item.meta.public && !publicRoutes.has(publicKey) && !isAuthorized(req, url)) {
          res.setHeader('www-authenticate', 'Bearer realm="android-dex"');
          throw new HttpError(401, 'missing or invalid bridge token', 'unauthorized');
        }
        const query = Object.fromEntries(url.searchParams.entries());
        let body = {};
        if (['POST', 'PATCH', 'PUT'].includes(req.method) && !item.meta.raw) {
          body = await readBody(req, { limit: 10 * 1024 * 1024 });
        }
        const result = await item.handler({ req, res, params, query, body, url });
        if (result !== null && !res.writableEnded) json(res, req.method === 'POST' ? 200 : 200, result);
        runtime.logger.debug('http', `${item.method} ${pathname} ${Date.now() - started}ms`);
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') { await serveStatic(req, res, pathname); return; }
      text(res, 404, 'not found');
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        runtime.logger.error('http', `${req.method} ${pathname}: ${error.stack || error.message}`);
        if (runtime.state.diagnostics.crashReports) {
          modules.diagnostics.reportCrash({ message: error.message, stack: error.stack, context: { route: pathname } }).catch(() => {});
        }
      }
      if (!res.headersSent) {
        json(res, status, { error: { code: error.code || 'internal_error', message: status === 500 ? 'internal server error' : error.message, ...(error.details ? { details: error.details } : {}) }, ts: nowIso() });
      } else {
        res.end();
      }
    }
  });

  server.on('upgrade', (req, socket, head) => {
    modules.ws.handleUpgrade(req, socket, head);
  });

  server.routes = routes;
  return server;
}
