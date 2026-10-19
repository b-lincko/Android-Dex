/**
 * Demo backend.
 *
 * On GitHub Pages (or file://) there is no bridge to talk to. This module
 * mirrors the bridge contract in the browser using a snapshot of the real API
 * plus a small amount of local logic, so every screen is interactive. Actions
 * that require hardware say so explicitly instead of pretending to work.
 */
import { fmtBytes, makeSvgPlaceholder, storage, uid } from './core.js';

const STORAGE_KEY = 'demo.state.v2';
const FILES_KEY = 'demo.files.v2';
const CATALOG_KEY = 'demo.catalog.v2';

const nowIso = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

const DEMO_FILES = [
  { path: 'Read Me.md', kind: 'file', mime: 'text/markdown', content: '# Android DEX share\n\nDrop files here, mount the WebDAV endpoint, or push files to the phone.\n' },
  { path: 'Documents/Q4-OKR.md', kind: 'file', mime: 'text/markdown', content: '# Q4 OKRs\n\n1. p95 latency < 40 ms\n2. Clipboard + file sync on all platforms\n3. Reproducible, signed releases\n' },
  { path: 'Documents/phone-shortcuts.txt', kind: 'file', mime: 'text/plain', content: 'Ctrl+K  universal search\nCtrl+Shift+V  clipboard history\nCtrl+Alt+P  screenshot\nCtrl+Alt+R  recording\nCtrl+Shift+L  lock phone\n' },
  { path: 'Notes/meeting-2026-10-14.md', kind: 'file', mime: 'text/markdown', content: '# Design review\n\n- Snap layouts need keyboard equivalents\n- PiP keeps media audio\n- Per-app DPI presets\n' },
  { path: 'Screenshots/', kind: 'folder' },
  { path: 'Screenshots/aurora.svg', kind: 'file', mime: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2027"/><stop offset=".5" stop-color="#203a43"/><stop offset="1" stop-color="#2c5364"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="470" cy="110" r="64" fill="none" stroke="#5eead4" stroke-width="2" opacity=".7"/><text x="32" y="320" fill="#e2e8f0" font-family="sans-serif" font-size="18">Android DEX · shared screenshot</text></svg>' },
  { path: 'Recordings/', kind: 'folder' },
  { path: 'Inbox/', kind: 'folder' },
];

function seedFiles() {
  return DEMO_FILES.map((file) => ({
    ...file,
    size: file.kind === 'folder' ? 0 : new Blob([file.content]).size,
    modified: nowIso(),
    dataUrl: file.kind === 'folder' ? undefined : `data:${file.mime};charset=utf-8,${encodeURIComponent(file.content)}`,
  }));
}

const CURATED = [
  { id: 'cat_cod', name: 'Season 4 — 4-finger claw', game: 'Call of Duty: Mobile', author: 'nova', rating: 4.8, downloads: 12840, controls: 9 },
  { id: 'cat_pubg', name: 'Gyro + claw hybrid', game: 'PUBG Mobile', author: 'kai', rating: 4.6, downloads: 8210, controls: 11 },
  { id: 'cat_minecraft', name: 'Builder desktop preset', game: 'Minecraft', author: 'pixelpanda', rating: 4.9, downloads: 5321, controls: 8 },
  { id: 'cat_genshin', name: 'Comfort controller mapping', game: 'Genshin Impact', author: 'lijo', rating: 4.4, downloads: 3002, controls: 6 },
];

const CHANNELS = {
  stable: [{ version: '2.0.0', notes: 'Initial 2.0 release.', sha256: '9f2c0a1d…', releasedAt: '2026-10-19' }],
  beta: [{ version: '2.1.0-beta.1', notes: 'Experimental: WebRTC camera, plugin sandbox.', sha256: 'deadbeef…', releasedAt: '2026-10-18' }],
  nightly: [],
};

const hash = (text) => {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) % 65536;
  return value.toString(16).padStart(4, '0');
};

const b64 = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text) => decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/'))));

export class DemoBackend {
  constructor(snapshot) {
    this.handlers = new Map();
    this.saved = storage.get(STORAGE_KEY, null);
    this.state = this.saved?.state || clone(snapshot);
    this.files = this.saved?.files || seedFiles();
    this.catalog = storage.get(CATALOG_KEY, []);
    this.logs = [
      { ts: nowIso(), level: 'info', scope: 'demo', message: 'Demo backend ready — no socket, no device.' },
      { ts: nowIso(), level: 'info', scope: 'ui', message: 'Booted from static snapshot.' },
    ];
    this.recordingTimer = null;
  }

  persist() {
    try {
      storage.set(STORAGE_KEY, { state: this.state, files: this.files });
      storage.set(CATALOG_KEY, this.catalog);
    } catch { /* quota */ }
  }

  reset() {
    storage.remove(STORAGE_KEY);
    storage.remove(CATALOG_KEY);
    localStorage.removeItem('dex.demo.files.v2');
    location.reload();
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    for (const handler of this.handlers.get(type) || []) {
      try { handler(payload); } catch (error) { console.error(error); }
    }
    for (const handler of this.handlers.get('*') || []) {
      try { handler({ type, payload }); } catch (error) { console.error(error); }
    }
  }

  touch(event = 'state.changed', payload = {}) {
    this.persist();
    this.emit(event, payload);
    this.emit('refresh', { event, payload });
  }

  device() {
    return this.state.devices.find((item) => item.id === this.state.activeDeviceId) || this.state.devices[0];
  }

  conversation(id) {
    return this.state.conversations.find((item) => item.id === id);
  }

  findControl(profileId, controlId) {
    const profile = this.state.gameProfiles.find((item) => item.id === profileId);
    return { profile, control: profile?.controls.find((item) => item.id === controlId) };
  }

  filesIn(dir = '') {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
    const direct = new Map();
    for (const file of this.files) {
      if (!file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        direct.set(rest, {
          id: 'f_' + b64(file.path).slice(0, 14), name: rest, path: file.path,
          dir: dir || '', kind: file.kind, size: file.size, sizeLabel: fmtBytes(file.size),
          mime: file.mime, modified: file.modified,
        });
      } else {
        const folder = rest.slice(0, slash);
        if (!direct.has(folder)) {
          direct.set(folder, {
            id: 'f_' + b64(prefix + folder).slice(0, 14), name: folder, path: prefix + folder,
            dir: dir || '', kind: 'folder', size: 0, sizeLabel: '—', mime: 'inode/directory', modified: nowIso(),
          });
        }
      }
    }
    return [...direct.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
  }

  downloadUrl(path) {
    const file = this.files.find((item) => item.path === path);
    return file?.dataUrl || '';
  }

  uploadFile(file, dir = '') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => {
        const path = dir ? `${dir}/${file.name}` : file.name;
        const existing = this.files.findIndex((item) => item.path === path);
        const entry = {
          path, kind: 'file', size: file.size, modified: nowIso(),
          mime: file.type || 'application/octet-stream', dataUrl: reader.result,
          content: file.type.startsWith('text/') ? String(reader.result).split(',').slice(1).join(',') : undefined,
        };
        if (existing >= 0) this.files[existing] = entry; else this.files.push(entry);
        this.touch('files.changed', { action: 'write', path });
        resolve({ name: file.name, path, size: file.size, sizeLabel: fmtBytes(file.size) });
      };
      reader.readAsDataURL(file);
    });
  }

  removeFile(path) {
    this.files = this.files.filter((item) => item.path !== path && !item.path.startsWith(`${path}/`));
    this.touch('files.changed', { action: 'delete', path });
    return { ok: true, path };
  }

  mkdir(path) {
    const clean = path.replace(/\/+$/, '');
    if (!this.files.some((item) => item.path === clean + '/')) {
      this.files.push({ path: clean + '/', kind: 'folder', size: 0, modified: nowIso() });
    }
    this.touch('files.changed', { action: 'mkdir', path: clean });
    return { name: clean.split('/').pop(), path: clean, kind: 'folder' };
  }

  screenshot(label) {
    const width = 1280;
    const height = 800;
    const label2 = label ? String(label).slice(0, 24) : 'Android DEX';
    const pngSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#080b10"/><stop offset=".6" stop-color="#0f1b22"/><stop offset="1" stop-color="#191428"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="40" y="60" width="360" height="600" rx="14" fill="#11151b" stroke="#2b3a46"/>
      <rect x="430" y="60" width="520" height="400" rx="14" fill="#11151b" stroke="#2b3a46"/>
      <rect x="40" y="700" width="${width - 80}" height="56" rx="14" fill="rgba(10,14,20,.8)" stroke="#2b3a46"/>
      <text x="70" y="113" fill="#5eead4" font-family="Inter,sans-serif" font-size="16">MESSAGES</text>
      <text x="460" y="113" fill="#1db954" font-family="Inter,sans-serif" font-size="16">SPOTIFY</text>
      <text x="70" y="740" fill="#8aa0b4" font-family="Inter,sans-serif" font-size="14">${label2} · ${new Date().toLocaleString()}</text>
    </svg>`;
    const name = `${label ? String(label).replace(/[^\w-]+/g, '_') + '_' : ''}${nowIso().replace(/[:.]/g, '-')}.png`;
    const shot = {
      id: uid('shot'), name, path: `Screenshots/${name}`, size: pngSvg.length, ts: nowIso(),
      width, height, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pngSvg)}`,
    };
    this.state.media.screenshots.unshift(shot);
    this.files.push({ path: `Screenshots/${name}`, kind: 'file', size: shot.size, mime: 'image/svg+xml', modified: nowIso(), dataUrl: shot.url });
    this.touch('capture.screenshot', shot);
    return shot;
  }

  startCall({ number, contactId, video = false }) {
    const contact = contactId ? this.state.contacts.find((item) => item.id === contactId) : null;
    if (!contact && !number) throw new Error('A number or contact is required');
    const active = this.state.calls.find((call) => ['dialing', 'ringing', 'active'].includes(call.status));
    if (active) throw new Error('A call is already in progress');
    const call = {
      id: uid('call'), number: contact?.number || number, name: contact?.name || number,
      direction: 'outgoing', status: 'dialing', video, startedAt: nowIso(),
    };
    this.state.calls.unshift(call);
    this.touch('calls.outgoing', call);
    setTimeout(() => {
      if (call.status === 'dialing') {
        call.status = 'active';
        call.answeredAt = nowIso();
        this.touch('calls.active', call);
      }
    }, 1500);
    return call;
  }

  sendSms({ conversationId, number, text, media }) {
    if (!text && !media) throw new Error('Text or media is required');
    let conversation = conversationId ? this.conversation(conversationId) : null;
    if (!conversation) {
      const contact = this.state.contacts.find((item) => item.number.replace(/\D/g, '') === String(number || '').replace(/\D/g, ''));
      conversation = this.state.conversations.find((item) => item.number.replace(/\D/g, '') === String(number || '').replace(/\D/g, ''));
      if (!conversation) {
        conversation = {
          id: uid('conv'), name: contact?.name || number, number, avatarColor: contact?.avatarColor || '#6b7280',
          company: '', unread: 0, rcs: false, pinned: false, muted: false, messages: [],
        };
        this.state.conversations.unshift(conversation);
      }
    }
    const message = {
      id: uid('m'), from: 'me', kind: media ? 'mms' : 'sms', text: text || 'Photo',
      media, ts: nowIso(), status: 'sending',
    };
    conversation.messages.push(message);
    conversation.unread = 0;
    this.touch('telephony.message', { conversationId: conversation.id, message });
    setTimeout(() => {
      message.status = 'delivered';
      this.touch('telephony.status', { conversationId: conversation.id, messageId: message.id, status: 'delivered' });
    }, 700);
    return { conversationId: conversation.id, message };
  }

  notifyReply(notification, text) {
    if (!text?.trim()) throw new Error('Reply text is required');
    const result = this.sendSms({
      conversationId: notification.conversationId,
      number: notification.number,
      text,
    });
    notification.read = true;
    notification.repliedAt = nowIso();
    notification.repliedText = text;
    this.touch('notification.replied', { notification, ...result });
    return result;
  }

  subscribe(event, payload) {
    this.emit(event, payload);
    this.emit('refresh', { event, payload });
  }

  // ── Route dispatch ────────────────────────────────────────────────
  async request(pathname, { method = 'GET', body = {}, query } = {}) {
    const url = new URL(pathname, 'http://demo.local');
    const path = url.pathname;
    const params = Object.fromEntries(url.searchParams.entries());
    const q = { ...params, ...(query || {}) };
    const route = `${method.toUpperCase()} ${path}`;
    const state = this.state;
    const device = this.device();

    if (route === 'GET /api/state') return clone(state);
    if (route === 'GET /api/settings') return clone(state.settings);
    if (route === 'PATCH /api/settings') {
      state.settings = { ...state.settings, ...body };
      if (body.dnd !== undefined) {
        const dnd = state.quickTiles.find((tile) => tile.id === 'dnd');
        if (dnd) { dnd.enabled = Boolean(body.dnd); dnd.detail = body.dnd ? 'On' : 'Off'; }
      }
      this.subscribe('settings.changed', body);
      if (body.theme) this.emit('theme.changed', body);
      return clone(state.settings);
    }

    if (route === 'GET /api/devices') return { devices: state.devices, activeDeviceId: state.activeDeviceId, reconnect: state.reconnect };
    if (route === 'POST /api/devices/connect') {
      if (device) { device.status = 'connected'; device.transport = body.transport || 'usb'; device.lastSeen = nowIso(); }
      state.reconnect.state = 'connected';
      this.subscribe('device.connected', { deviceId: device?.id });
      return clone(device);
    }
    if (route === 'POST /api/devices/disconnect' || route === 'POST /api/devices/drop') {
      state.reconnect.state = 'reconnecting';
      state.reconnect.attempt = 1;
      state.reconnect.lastDropAt = nowIso();
      if (device) device.status = 'reconnecting';
      this.subscribe('reconnect.dropped', { reason: body.reason || 'user disconnected' });
      setTimeout(() => {
        state.reconnect.state = 'connected';
        state.reconnect.attempt = 0;
        if (device) device.status = 'connected';
        this.touch('reconnect.restored', { restored: state.windows.length });
      }, 1800);
      return clone(state.reconnect);
    }
    if (route === 'POST /api/devices/reconnect') {
      state.reconnect.state = 'connected';
      state.reconnect.attempt = 0;
      if (device) device.status = 'connected';
      this.subscribe('reconnect.manual', {});
      return clone(state.reconnect);
    }
    if (route === 'GET /api/devices/reconnect/preview') {
      let delay = 500;
      const schedule = Array.from({ length: 10 }, (_, index) => {
        const entry = { attempt: index + 1, delayMs: Math.round(delay), jitteredUpToMs: Math.round(delay * 1.2) };
        delay = Math.min(30000, delay * 1.8);
        return entry;
      });
      return { schedule, config: state.settings.reconnectBackoff };
    }
    if (route === 'POST /api/devices/select') {
      state.activeDeviceId = body.deviceId;
      this.touch('device.selected', { deviceId: body.deviceId });
      return clone(this.device());
    }
    if (route === 'PATCH /api/devices/:id') {
      if (body.name && device) device.name = body.name;
      if (body.quality?.preset && device) {
        device.quality.preset = body.quality.preset;
        device.quality.fps = { low: 30, medium: 45, high: 60 }[body.quality.preset];
        device.quality.bitrateMbps = { low: 3, medium: 8, high: 16 }[body.quality.preset];
      }
      this.touch('device.quality', device?.quality);
      return clone(device);
    }
    if (route === 'POST /api/devices/:id/wake') {
      if (device) device.status = 'connected';
      this.subscribe('device.wake', { deviceId: device?.id });
      return { device };
    }
    if (route === 'POST /api/devices/:id/keepawake' || route === 'POST /api/system/keepawake') {
      state.settings.idlePrevention = body.enabled !== false;
      this.touch('system.keep-awake', { enabled: state.settings.idlePrevention });
      return { idlePrevention: state.settings.idlePrevention };
    }
    if (route === 'POST /api/devices/:id/charge') {
      state.settings.chargeThrottle = body.enabled !== false;
      state.settings.chargeLimit = Math.max(40, Math.min(100, Number(body.limit) || 80));
      if (device) device.battery.charging = state.settings.chargeThrottle && device.battery.level < state.settings.chargeLimit;
      this.touch('system.charge-throttle', { enabled: state.settings.chargeThrottle, limit: state.settings.chargeLimit });
      return { enabled: state.settings.chargeThrottle, limit: state.settings.chargeLimit, battery: device?.battery };
    }

    if (route === 'POST /api/pair/start') {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const token = uid('tok');
      const qrPayload = `dex://pair?host=${encodeURIComponent(location.host)}&token=${token}&code=${code}&fp=SHA256:DEMO&v=2`;
      this.pairing = { id: uid('pair'), code, token, qrPayload, expiresAt: new Date(Date.now() + 120000).toISOString() };
      this.touch('pairing.started', this.pairing);
      return {
        ...this.pairing, fingerprint: 'SHA256:7F:4C:19:AA:02:9D:31:8E:55:C1:7A:0D:22:BB:46:E0',
        adbSteps: ['Settings → Developer options → Wireless debugging', 'Pair device with pairing code', 'Enter the code shown here'],
      };
    }
    if (route === 'GET /api/pair/status') {
      return { active: Boolean(this.pairing), ...(this.pairing || {}), paired: state.security.pairedFingerprints, fingerprint: 'SHA256:DEMO' };
    }
    if (route === 'POST /api/pair/confirm') {
      if (!this.pairing || (body.code && body.code !== this.pairing.code)) throw new Error('Pairing code is incorrect');
      this.pairing = null;
      this.pairing = null;
      state.security.pairedFingerprints.push({ deviceId: 'demo_paired', fingerprint: 'SHA256:DEMO:DEVICE', addedAt: nowIso() });
      this.touch('pairing.completed', { deviceId: 'demo_paired' });
      return { paired: true, device: device, fingerprint: 'SHA256:DEMO:DEVICE', bridgeFingerprint: 'SHA256:DEMO' };
    }
    if (route === 'POST /api/pair/cancel') { this.pairing = null; return { active: false }; }
    if (route === 'GET /api/pair/identity') return { fingerprint: 'SHA256:7F:4C:19:AA:02:9D:31', publicKeyPem: '-----BEGIN PUBLIC KEY-----\n(demo)\n-----END PUBLIC KEY-----' };
    if (route === 'DELETE /api/pair/:deviceId') {
      state.security.pairedFingerprints = state.security.pairedFingerprints.filter((item) => item.deviceId !== route.split('/')[3]);
      return { revoked: true };
    }

    // Clipboard
    if (route === 'GET /api/clipboard') return { items: state.clipboard, sync: state.settings.clipboardSync, retentionMinutes: state.settings.clipboardRetentionMinutes };
    if (route === 'POST /api/clipboard') {
      if (!body.text?.trim() && !body.dataUrl) throw new Error('Text or an image is required');
      const item = {
        id: uid('clip'), kind: body.kind === 'image' ? 'image' : 'text', text: body.text || 'Image',
        dataUrl: body.dataUrl, source: body.source || 'desktop', ts: nowIso(), pinned: false, deviceId: state.activeDeviceId,
      };
      state.clipboard.unshift(item);
      this.touch('clipboard.changed', item);
      return item;
    }
    if (route.match(/^POST \/api\/clipboard\/[^/]+\/copy$/)) {
      const id = path.split('/')[3];
      const item = state.clipboard.find((entry) => entry.id === id);
      if (!item) throw new Error('Clipboard item not found');
      item.lastCopiedAt = nowIso();
      this.touch('clipboard.copied', { id, target: body.target || 'device' });
      return { ok: true, id, target: body.target || 'device' };
    }
    if (route.match(/^PATCH \/api\/clipboard\/[^/]+$/)) {
      const item = state.clipboard.find((entry) => entry.id === path.split('/').at(-1));
      if (!item) throw new Error('Clipboard item not found');
      item.pinned = !item.pinned;
      this.touch('clipboard.updated', item);
      return item;
    }
    if (route.match(/^DELETE \/api\/clipboard\/[^/]+$/)) {
      const id = path.split('/').at(-1);
      state.clipboard = state.clipboard.filter((item) => item.id !== id);
      this.touch('clipboard.removed', { id });
      return { ok: true, id };
    }
    if (route === 'POST /api/clipboard/clear') {
      state.clipboard = body.keepPinned !== false ? state.clipboard.filter((item) => item.pinned) : [];
      this.touch('clipboard.cleared', {});
      return { ok: true };
    }

    // Files
    if (route === 'GET /api/files') {
      const dir = q.dir || '';
      const crumbs = [];
      let acc = '';
      for (const part of dir.split('/').filter(Boolean)) { acc = acc ? `${acc}/${part}` : part; crumbs.push({ name: part, path: acc }); }
      const total = this.files.reduce((sum, file) => sum + (file.size || 0), 0);
      return { dir, crumbs, items: this.filesIn(dir), share: { path: '/share', webdav: '/dav/', totalLabel: fmtBytes(total) } };
    }
    if (route === 'POST /api/files/mkdir') return this.mkdir(body.path);
    if (route.match(/^DELETE \/api\/files$/)) return this.removeFile(q.path);
    if (route === 'POST /api/files/push') {
      const file = this.files.find((item) => item.path === body.path);
      if (!file) throw new Error('File not found');
      const transfer = { id: uid('xfer'), name: file.path.split('/').pop(), bytes: file.size, targetDir: '/sdcard/Download', status: 'queued' };
      this.emit('transfer.queued', transfer);
      setTimeout(() => { transfer.status = 'complete'; this.emit('transfer.complete', transfer); }, 500);
      return transfer;
    }
    if (route === 'GET /api/mount') {
      return {
        webdav: { path: '/dav/', url: `${location.origin}/dav/`, auth: 'demo' },
        shareDir: '/share (demo)',
        instructions: {
          windows: ['net use Z: http://bridge-host:8787/dav'],
          macos: ['Finder → Go → Connect to Server → http://bridge-host:8787/dav'],
          linux: ['sudo mount -t davfs http://bridge-host:8787/dav /mnt/dex'],
        },
      };
    }

    // Telephony
    if (route === 'GET /api/telephony/conversations') return { conversations: [...state.conversations].sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : (b.messages.at(-1)?.ts || '').localeCompare(a.messages.at(-1)?.ts || ''))) };
    if (route.match(/^GET \/api\/telephony\/conversations\/[^/]+$/)) {
      const conversation = this.conversation(path.split('/').at(-1));
      if (!conversation) throw new Error('Conversation not found');
      conversation.unread = 0;
      this.touch('telephony.read', { conversationId: conversation.id });
      return clone(conversation);
    }
    if (route === 'POST /api/telephony/messages') return this.sendSms(body);
    if (route === 'POST /api/telephony/typing') { this.emit('telephony.typing', body); return { ok: true }; }
    if (route === 'GET /api/telephony/contacts') return { contacts: state.contacts };
    if (route === 'GET /api/telephony/calls') return { calls: state.calls };
    if (route === 'POST /api/telephony/calls') {
      if (body.contactId || body.number) return this.startCall(body);
      throw new Error('A number or contact is required');
    }
    if (route.match(/^POST \/api\/telephony\/calls\/[^/]+\/answer$/)) {
      const call = state.calls.find((item) => item.id === path.split('/')[4]);
      if (!call) throw new Error('Call not found');
      call.status = 'active'; call.answeredAt = nowIso();
      this.touch('calls.active', call);
      return call;
    }
    if (route.match(/^POST \/api\/telephony\/calls\/[^/]+\/hangup$/)) {
      const call = state.calls.find((item) => item.id === path.split('/')[4]);
      if (!call) throw new Error('Call not found');
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = nowIso();
      call.duration = call.answeredAt ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000) : 0;
      this.touch('calls.ended', call);
      return call;
    }
    if (route.match(/^POST \/api\/telephony\/calls\/[^/]+\/dtmf$/)) {
      const call = state.calls.find((item) => item.id === path.split('/')[4]);
      if (call) call.dtmf = (call.dtmf || '') + (body.digits || '');
      return { ok: true, dtmf: call?.dtmf || '' };
    }
    if (route.match(/^POST \/api\/telephony\/calls\/[^/]+\/mute$/)) {
      const call = state.calls.find((item) => item.id === path.split('/')[4]);
      if (call) call.muted = body.muted !== false;
      return call;
    }

    // Notifications
    if (route === 'GET /api/notifications') {
      return { notifications: state.notifications, dnd: state.settings.dnd, mirror: { enabled: state.settings.mirrorToOsNotificationCenter, backend: 'demo', available: false } };
    }
    if (route.match(/^POST \/api\/notifications\/[^/]+\/action$/)) {
      const id = path.split('/')[3];
      const notification = state.notifications.find((item) => item.id === id);
      if (!notification) throw new Error('Notification not found');
      const actionId = body.actionId;
      if (actionId === 'reply') {
        const result = this.notifyReply(notification, body.payload?.text || '');
        return { ok: true, ...result };
      }
      if (actionId === 'answer') {
        const call = state.calls.find((item) => item.id === notification.callId);
        if (call) { call.status = 'active'; call.answeredAt = nowIso(); this.touch('calls.active', call); }
        return call;
      }
      if (actionId === 'decline') {
        const call = state.calls.find((item) => item.id === notification.callId);
        if (call) { call.status = 'declined'; this.touch('calls.ended', call); }
        return call;
      }
      notification.read = true;
      this.touch('notification.updated', notification);
      return { ok: true, action: actionId };
    }
    if (route.match(/^POST \/api\/notifications\/[^/]+\/read$/)) {
      const notification = state.notifications.find((item) => item.id === path.split('/')[3]);
      if (notification) notification.read = true;
      this.touch('notification.updated', notification);
      return notification;
    }
    if (route === 'POST /api/notifications/read-all') {
      state.notifications.forEach((item) => { item.read = true; });
      this.touch('notifications.read-all', {});
      return { ok: true };
    }
    if (route.match(/^DELETE \/api\/notifications\/[^/]+$/)) {
      const id = path.split('/').at(-1);
      state.notifications = state.notifications.filter((item) => item.id !== id);
      this.touch('notification.dismissed', { id });
      return { ok: true };
    }
    if (route === 'DELETE /api/notifications') { state.notifications = []; this.touch('notifications.cleared', {}); return { ok: true }; }
    if (route === 'POST /api/notifications/dnd') {
      state.settings.dnd = Boolean(body.enabled);
      const tile = state.quickTiles.find((item) => item.id === 'dnd');
      if (tile) { tile.enabled = state.settings.dnd; tile.detail = state.settings.dnd ? 'On' : 'Off'; }
      this.touch('dnd.changed', { enabled: state.settings.dnd });
      return { dnd: state.settings.dnd };
    }
    if (route === 'POST /api/notifications/test') {
      const notification = {
        id: uid('note'), app: body.app || 'Messages', icon: 'bell', color: '#8ab4f8',
        title: body.title || 'Test notification', body: body.body || 'Sent from the demo console.',
        ts: nowIso(), read: false, actions: [{ id: 'reply', label: 'Reply', reply: true }], conversationId: state.conversations[1]?.id,
      };
      state.notifications.unshift(notification);
      this.touch('notification.received', notification);
      return notification;
    }

    // System
    if (route === 'GET /api/system/tiles') return { tiles: state.quickTiles };
    if (route.match(/^POST \/api\/system\/tiles\/[^/]+\/toggle$/)) {
      const id = path.split('/')[5];
      const tile = state.quickTiles.find((item) => item.id === id);
      if (!tile) throw new Error('Unknown quick setting');
      tile.enabled = body.enabled === undefined ? !tile.enabled : Boolean(body.enabled);
      if (id === 'dnd') { state.settings.dnd = tile.enabled; }
      if (id === 'airplane' && tile.enabled) {
        ['wifi', 'bluetooth', 'hotspot', 'cellular'].forEach((key) => {
          const other = state.quickTiles.find((item) => item.id === key);
          if (other) { other.enabled = false; other.detail = 'Off (airplane)'; }
        });
      }
      tile.detail = id === 'wifi' ? (tile.enabled ? 'HomeNet-5G' : 'Off')
        : id === 'bluetooth' ? (tile.enabled ? 'Buds Pro' : 'Off')
          : id === 'hotspot' ? (tile.enabled ? '2 devices' : 'Off')
            : id === 'cellular' ? (tile.enabled ? '5G · 12 GB left' : 'Off')
              : id === 'rotation' ? (tile.enabled ? 'On' : 'Locked') : (tile.enabled ? 'On' : 'Off');
      this.touch('system.tile', tile);
      return tile;
    }
    if (route === 'POST /api/system/hotspot') {
      const tile = state.quickTiles.find((item) => item.id === 'hotspot');
      tile.enabled = Boolean(body.enabled);
      tile.detail = body.enabled ? `${body.ssid || 'AndroidDEX'} · ${body.band || '5GHz'}` : 'Off';
      this.touch('system.tile', tile);
      return tile;
    }
    if (route === 'POST /api/system/cellular') {
      const tile = state.quickTiles.find((item) => item.id === 'cellular');
      tile.enabled = Boolean(body.dataEnabled);
      tile.detail = body.dataEnabled ? '5G · 12 GB left' : 'Off';
      this.touch('system.tile', tile);
      return tile;
    }
    if (route === 'GET /api/system') {
      return {
        locked: Boolean(device?.locked), battery: device?.battery, charging: Boolean(device?.battery?.charging),
        idlePrevention: state.settings.idlePrevention, chargeLimit: state.settings.chargeLimit,
        chargeThrottle: state.settings.chargeThrottle, biometric: this.biometricChallenge || null,
      };
    }
    if (route === 'POST /api/system/lock') {
      if (device) device.locked = true;
      this.biometricChallenge = { id: uid('bio'), prompt: 'Confirm it is you to unlock the phone', forwarded: true, expiresAt: new Date(Date.now() + 120000).toISOString() };
      this.subscribe('system.locked', { challenge: this.biometricChallenge });
      return { locked: true, challenge: this.biometricChallenge };
    }
    if (route === 'POST /api/system/biometric') {
      if (this.biometricChallenge && body.challengeId && body.challengeId !== this.biometricChallenge.id) throw new Error('Biometric challenge expired');
      if (body.success === false) { this.emit('system.biometric-failed', {}); return { unlocked: false }; }
      if (device) device.locked = false;
      this.biometricChallenge = null;
      this.subscribe('system.unlocked', {});
      return { unlocked: true };
    }
    if (route === 'POST /api/system/keepawake') {
      state.settings.idlePrevention = body.enabled !== false;
      this.touch('system.keep-awake', { enabled: state.settings.idlePrevention });
      return { idlePrevention: state.settings.idlePrevention };
    }

    // Windows / apps / widgets
    if (route === 'GET /api/windows') return { windows: state.windows, monitors: state.monitors, layouts: ['2-columns', '3-columns', '2x2', 'main-side', 'focus'], snapZones: ['left-half', 'right-half', 'top-half', 'bottom-half', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] };
    if (route === 'GET /api/apps') return { apps: state.apps };
    if (route === 'POST /api/windows') {
      const app = state.apps.find((item) => item.id === body.appId);
      if (!app) throw new Error('App not found');
      const existing = state.windows.find((item) => item.appId === app.id);
      if (existing) { existing.minimized = false; this.touch('windows.focused', existing); return existing; }
      const monitor = state.monitors.find((item) => item.primary);
      const offset = state.windows.length * 26;
      const win = {
        id: uid('win'), appId: app.id, title: app.name, package: app.package, icon: app.icon, color: app.color,
        monitorId: monitor.id, x: monitor.x + 80 + offset, y: monitor.y + 60 + offset, w: 480, h: 820,
        z: Math.max(0, ...state.windows.map((item) => item.z)) + 1, minimized: false, maximized: false,
        alwaysOnTop: false, pip: false, orientation: app.category === 'Games' ? 'landscape' : 'portrait',
        dpi: 320, scale: 100, snapped: null, audio: true, state: 'running',
      };
      state.windows.push(win);
      this.touch('windows.launched', win);
      return win;
    }
    if (route.match(/^PATCH \/api\/windows\/[^/]+$/)) {
      const win = state.windows.find((item) => item.id === path.split('/').at(-1));
      if (!win) throw new Error('Window not found');
      Object.assign(win, body);
      if (body.pip) { win.alwaysOnTop = true; win.w = Math.max(300, Math.round(win.w * 0.6)); win.h = Math.max(170, Math.round(win.h * 0.6)); win.snapped = 'bottom-right'; }
      this.touch('windows.changed', { window: win });
      return win;
    }
    if (route.match(/^DELETE \/api\/windows\/[^/]+$/)) {
      const id = path.split('/').at(-1);
      state.windows = state.windows.filter((item) => item.id !== id);
      this.touch('windows.closed', { id });
      return { ok: true, id };
    }
    if (route.match(/^POST \/api\/windows\/[^/]+\/focus$/)) {
      const win = state.windows.find((item) => item.id === path.split('/')[4]);
      if (!win) throw new Error('Window not found');
      win.z = Math.max(...state.windows.map((item) => item.z)) + 1;
      win.minimized = false;
      this.touch('windows.focused', win);
      return win;
    }
    if (route.match(/^POST \/api\/windows\/[^/]+\/snap$/)) {
      const win = state.windows.find((item) => item.id === path.split('/')[4]);
      if (!win) throw new Error('Window not found');
      const monitor = state.monitors.find((item) => item.id === win.monitorId) || state.monitors[0];
      const area = { x: monitor.x, y: monitor.y, w: monitor.width, h: monitor.height - 72 };
      const halfW = Math.round(area.w / 2);
      const halfH = Math.round(area.h / 2);
      const zones = {
        'left-half': { x: area.x, y: area.y, w: halfW, h: area.h },
        'right-half': { x: area.x + halfW, y: area.y, w: area.w - halfW, h: area.h },
        'top-half': { x: area.x, y: area.y, w: area.w, h: halfH },
        'bottom-half': { x: area.x, y: area.y + halfH, w: area.w, h: area.h - halfH },
        'top-left': { x: area.x, y: area.y, w: halfW, h: halfH },
        'top-right': { x: area.x + halfW, y: area.y, w: area.w - halfW, h: halfH },
        'bottom-left': { x: area.x, y: area.y + halfH, w: halfW, h: area.h - halfH },
        'bottom-right': { x: area.x + halfW, y: area.y + halfH, w: area.w - halfW, h: area.h - halfH },
      };
      Object.assign(win, zones[body.zone] || {}, { snapped: body.zone, maximized: false, pip: false });
      this.touch('windows.snapped', { window: win, zone: body.zone });
      return win;
    }
    if (route === 'POST /api/windows/layout') {
      const monitor = state.monitors.find((item) => item.id === (body.monitorId || state.monitors.find((m) => m.primary).id));
      const list = state.windows.filter((item) => item.monitorId === monitor.id && !item.minimized);
      const area = { x: monitor.x, y: monitor.y, w: monitor.width, h: monitor.height - 72 };
      list.forEach((win, index) => {
        if (body.preset === '2-columns') Object.assign(win, { x: area.x + (index % 2) * Math.round(area.w / 2), y: area.y, w: Math.round(area.w / 2), h: area.h });
        else if (body.preset === '3-columns') Object.assign(win, { x: area.x + (index % 3) * Math.round(area.w / 3), y: area.y, w: Math.round(area.w / 3), h: area.h });
        else if (body.preset === '2x2') Object.assign(win, { x: area.x + (index % 2) * Math.round(area.w / 2), y: area.y + Math.floor(index / 2) * Math.round(area.h / 2), w: Math.round(area.w / 2), h: Math.round(area.h / 2) });
        else if (body.preset === 'main-side') Object.assign(win, index === 0 ? { x: area.x, y: area.y, w: Math.round(area.w * 0.62), h: area.h } : { x: area.x + Math.round(area.w * 0.62), y: area.y + (index % 2) * Math.round(area.h / 2), w: area.w - Math.round(area.w * 0.62), h: Math.round(area.h / 2) });
        else Object.assign(win, index === 0 ? { x: area.x + 30, y: area.y + 24, w: area.w - 60, h: area.h - 48 } : { x: area.x + 80 + index * 26, y: area.y + 80 + index * 26, w: 420, h: 300 });
        win.snapped = null;
      });
      this.touch('windows.layout', { preset: body.preset });
      return { preset: body.preset, windows: list };
    }
    if (route === 'GET /api/monitors') return { monitors: state.monitors };
    if (route.match(/^PATCH \/api\/monitors\/[^/]+$/)) {
      const monitor = state.monitors.find((item) => item.id === path.split('/').at(-1));
      if (!monitor) throw new Error('Monitor not found');
      Object.assign(monitor, body);
      if (body.primary) state.monitors.forEach((item) => { item.primary = item.id === monitor.id; });
      this.touch('monitors.changed', monitor);
      return monitor;
    }
    if (route === 'GET /api/hotkeys') return { hotkeys: state.settings.hotkeys };
    if (route === 'PATCH /api/hotkeys') {
      state.settings.hotkeys = { ...state.settings.hotkeys, [body.action]: body.accelerator };
      this.touch('hotkeys.changed', state.settings.hotkeys);
      return state.settings.hotkeys;
    }
    if (route === 'POST /api/hotkeys/trigger') { this.emit('hotkey.pressed', body); return { ok: true }; }
    if (route.match(/^GET \/api\/apps\/[^/]+\/launcher$/) || route.match(/^POST \/api\/apps\/[^/]+\/launcher$/)) {
      const appId = path.split('/')[3];
      const app = state.apps.find((item) => item.id === appId);
      if (!app) throw new Error('App not found');
      const platform = q.platform || 'linux';
      const command = `android-dex launch ${app.package}`;
      const content = platform === 'windows'
        ? `# Start-menu shortcut\n$ws = New-Object -ComObject WScript.Shell\n$s = $ws.CreateShortcut("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Android DEX\\${app.name}.lnk")\n$s.TargetPath = "${command}"\n$s.Save()\n`
        : platform === 'macos'
          ? `#!/bin/sh\n${command}\n`
          : `[Desktop Entry]\nType=Application\nName=${app.name}\nComment=Android DEX · ${app.package}\nExec=${command}\nIcon=android-dex\nCategories=Utility;\nTerminal=false\n`;
      return { app: app.name, platform, filename: `android-dex-${app.id}.desktop`, content, command };
    }
    if (route === 'GET /api/widgets') return { widgets: state.widgets };
    if (route === 'POST /api/widgets') {
      const widget = { id: uid('w'), type: body.type || 'clock', monitorId: state.monitors[0].id, x: body.x || 40, y: body.y || 120, w: body.w || 230, h: body.h || 150, config: {}, z: 2 };
      state.widgets.push(widget);
      this.touch('widgets.changed', { action: 'add', widget });
      return widget;
    }
    if (route.match(/^PATCH \/api\/widgets\/[^/]+$/)) {
      const widget = state.widgets.find((item) => item.id === path.split('/').at(-1));
      if (!widget) throw new Error('Widget not found');
      Object.assign(widget, body, body.config ? { config: { ...widget.config, ...body.config } } : {});
      this.touch('widgets.changed', { action: 'update', widget });
      return widget;
    }
    if (route.match(/^DELETE \/api\/widgets\/[^/]+$/)) {
      const id = path.split('/').at(-1);
      state.widgets = state.widgets.filter((item) => item.id !== id);
      this.touch('widgets.changed', { action: 'remove', id });
      return { ok: true };
    }

    // Media
    if (route === 'GET /api/media') {
      return { ...state.media, mic: { enabled: !state.media.micMuted, gain: state.media.micGain }, webcam: { enabled: state.media.virtualCamera, fps: state.media.webcamFps } };
    }
    if (route === 'POST /api/media/control') {
      const session = state.media.sessions.find((item) => item.id === (body.sessionId || state.media.activeSessionId)) || state.media.sessions[0];
      if (body.action === 'play') { state.media.sessions.forEach((item) => { item.playing = false; }); session.playing = true; state.media.activeSessionId = session.id; }
      else if (body.action === 'pause') session.playing = false;
      else if (body.action === 'toggle') session.playing = !session.playing;
      else if (body.action === 'next' || body.action === 'previous') {
        const index = state.media.sessions.indexOf(session);
        const next = state.media.sessions[(index + (body.action === 'next' ? 1 : -1) + state.media.sessions.length) % state.media.sessions.length];
        state.media.sessions.forEach((item) => { item.playing = false; });
        next.playing = true; state.media.activeSessionId = next.id;
      } else if (body.action === 'seek') session.position = Math.max(0, Math.min(session.duration, Number(body.value) || 0));
      else if (body.action === 'volume') { state.media.volume = Number(body.value) || 0; state.media.muted = false; }
      else if (body.action === 'mute') state.media.muted = !state.media.muted;
      this.touch('media.changed', { action: body.action, session });
      return { session, volume: state.media.volume, muted: state.media.muted };
    }
    if (route === 'POST /api/media/route') {
      Object.assign(state.media, { output: body.output ?? state.media.output, volume: body.volume ?? state.media.volume, muted: body.muted ?? state.media.muted });
      state.settings.audioOutput = state.media.output;
      this.touch('media.routed', { output: state.media.output });
      return { output: state.media.output, volume: state.media.volume, muted: state.media.muted };
    }
    if (route === 'POST /api/media/mic') {
      if (body.enabled !== undefined) state.media.micMuted = !body.enabled;
      if (body.muted !== undefined) state.media.micMuted = Boolean(body.muted);
      if (body.gain !== undefined) state.media.micGain = Math.max(0, Math.min(100, Number(body.gain)));
      state.settings.micPassthrough = !state.media.micMuted;
      this.touch('media.mic', { enabled: !state.media.micMuted, gain: state.media.micGain });
      return { enabled: !state.media.micMuted, gain: state.media.micGain };
    }
    if (route === 'POST /api/media/webcam') {
      if (body.enabled !== undefined) state.media.virtualCamera = Boolean(body.enabled);
      if (body.fps !== undefined) state.media.webcamFps = Number(body.fps);
      state.settings.virtualCamera = state.media.virtualCamera;
      const info = { enabled: state.media.virtualCamera, fps: state.media.webcamFps, frames: state.media.webcamFrames, streamUrl: '/api/media/webcam/stream', usage: { obs: 'Start the bridge to expose the MJPEG stream.', zoom: 'Install v4l2loopback and set DEX_V4L2_DEVICE.' } };
      this.touch('media.webcam', info);
      return info;
    }
    if (route === 'POST /api/media/webcam/frame') { state.media.webcamFrames += 1; return { bytes: 0, frames: state.media.webcamFrames }; }
    if (route === 'GET /api/media/webcam/latest') return { demo: true };
    if (route === 'POST /api/input/gamepad') {
      state.input.gamepad = { ...state.input.gamepad, ...body, connected: true, lastAt: nowIso() };
      this.emit('input.gamepad', state.input.gamepad);
      return state.input.gamepad;
    }
    if (route === 'POST /api/input/stylus') {
      state.input.stylus = { ...state.input.stylus, ...body, strokes: (state.input.stylus?.strokes || 0) + (body.active ? 0 : 1), lastAt: nowIso() };
      this.emit('input.stylus', state.input.stylus);
      return state.input.stylus;
    }

    // Capture
    if (route === 'POST /api/capture/screenshot') return this.screenshot(body.label);
    if (route === 'GET /api/capture/shots') return { screenshots: state.media.screenshots };
    if (route === 'POST /api/capture/record/start') {
      state.media.recording = { id: uid('rec'), active: true, startedAt: nowIso(), frames: 0, fps: body.fps || 30, mode: body.mode || 'screen' };
      this.touch('capture.recording-started', state.media.recording);
      return state.media.recording;
    }
    if (route === 'POST /api/capture/record/stop') {
      if (!state.media.recording.active) throw new Error('No recording is running');
      const started = state.media.recording.startedAt;
      const recording = {
        id: state.media.recording.id, name: `recording-${started.replace(/[:.]/g, '-')}.webm`,
        path: '', size: 0, ts: nowIso(), durationSec: Math.round((Date.now() - new Date(started).getTime()) / 1000),
        mime: 'video/webm', frames: state.media.recording.frames, url: '',
      };
      state.media.recordings.unshift(recording);
      state.media.recording = { active: false, startedAt: null, frames: 0, target: 'video/webm' };
      this.touch('capture.recording-stopped', recording);
      return recording;
    }
    if (route === 'GET /api/capture/records') return { recordings: state.media.recordings };

    // Gaming
    if (route === 'GET /api/gaming/profiles') return { profiles: state.gameProfiles, fairPlay: this.fairPlay() };
    if (route === 'POST /api/gaming/profiles') {
      if (!body.name?.trim()) throw new Error('Profile name is required');
      const profile = {
        id: uid('gp'), appId: body.appId || 'custom', name: body.name, game: body.game || 'Custom game',
        package: body.package || '', author: body.author || 'you', version: 1, sharing: 'private',
        updatedAt: nowIso(), downloads: 0, rating: 0,
        sensitivity: { xCurve: 0.5, yCurve: 0.5, deadzone: 0.08, gyroSens: 0, aimAssist: false, ...(body.sensitivity || {}) },
        controls: (body.controls || []).map((control) => ({ id: uid('k'), w: 0.07, h: 0.07, settings: {}, ...control })),
        macros: body.macros || [], controllerMap: {},
      };
      state.gameProfiles.push(profile);
      this.touch('gaming.profile-changed', { action: 'create', profile });
      return profile;
    }
    if (route.match(/^PATCH \/api\/gaming\/profiles\/[^/]+$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      if (body.sensitivity?.aimAssist && !this.state.settings.aimAssistDisclosureAck) throw Object.assign(new Error('Aim assist requires accepting the fair-play disclosure.'), { code: 'fairplay_ack_required' });
      Object.assign(profile, body, body.sensitivity ? { sensitivity: { ...profile.sensitivity, ...body.sensitivity } } : {}, { version: profile.version + 1, updatedAt: nowIso() });
      this.touch('gaming.profile-changed', { action: 'update', profile });
      return profile;
    }
    if (route.match(/^DELETE \/api\/gaming\/profiles\/[^/]+$/)) {
      const id = path.split('/')[4];
      state.gameProfiles = state.gameProfiles.filter((item) => item.id !== id);
      this.touch('gaming.profile-changed', { action: 'delete', id });
      return { ok: true };
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/bind$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      const control = profile?.controls.find((item) => item.id === body.controlId);
      if (!control) throw new Error('Control not found');
      if (profile.controls.some((item) => item.id !== control.id && item.key.toLowerCase() === body.key.toLowerCase())) throw new Error(`${body.key} is already bound`);
      control.key = body.key;
      this.touch('gaming.bound', { profileId: profile.id, control });
      return control;
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/sensitivity$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      if (body.aimAssist && !state.settings.aimAssistDisclosureAck) throw Object.assign(new Error('Aim assist requires accepting the fair-play disclosure.'), { code: 'fairplay_ack_required' });
      profile.sensitivity = { ...profile.sensitivity, ...body };
      this.touch('gaming.sensitivity', { profileId: profile.id, sensitivity: profile.sensitivity });
      return profile.sensitivity;
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/macros$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      const macro = { id: uid('macro'), name: body.name || 'New macro', steps: body.steps || [] };
      profile.macros.push(macro);
      this.touch('gaming.macro', { action: 'add', profileId: profile.id, macro });
      return macro;
    }
    if (route.match(/^PATCH \/api\/gaming\/profiles\/[^/]+\/macros\/[^/]+$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      const macro = profile?.macros.find((item) => item.id === path.split('/').at(-1));
      if (!macro) throw new Error('Macro not found');
      Object.assign(macro, body);
      this.touch('gaming.macro', { action: 'update', profileId: profile.id, macro });
      return macro;
    }
    if (route.match(/^DELETE \/api\/gaming\/profiles\/[^/]+\/macros\/[^/]+$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      const id = path.split('/').at(-1);
      if (profile) profile.macros = profile.macros.filter((item) => item.id !== id);
      this.touch('gaming.macro', { action: 'delete', profileId: profile?.id, macroId: id });
      return { ok: true };
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/macros\/record$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      let previous = 0;
      const steps = (body.events || []).map((event) => {
        const delayMs = Math.max(0, (event.t || 0) - previous);
        previous = event.t || previous;
        return { type: event.type || 'tap', x: event.x, y: event.y, x2: event.x2, y2: event.y2, delayMs };
      });
      const macro = { id: uid('macro'), name: body.name || 'Recorded macro', steps, recordedAt: nowIso() };
      profile.macros.push(macro);
      this.touch('gaming.macro', { action: 'recorded', profileId: profile.id, macro });
      return macro;
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/controller$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      profile.controllerMap = { ...profile.controllerMap, ...body };
      this.touch('gaming.controller-map', { profileId: profile.id });
      return profile.controllerMap;
    }
    if (route.match(/^GET \/api\/gaming\/profiles\/[^/]+\/export$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      const json = { schema: 'android-dex/profile@2', exportedAt: nowIso(), profile };
      const raw = JSON.stringify(json);
      return { json, shareCode: `dexgame:${b64(raw)}.${hash(raw)}`, filename: `${profile.name.replace(/[^\w-]+/g, '-').toLowerCase()}.dexprofile.json` };
    }
    if (route === 'POST /api/gaming/import') {
      let data = body;
      if (typeof body === 'string' || body.code) {
        const code = String(body.code || body).trim();
        const raw = code.startsWith('dexgame:') ? code.slice(8) : code;
        const [encoded, checksum] = raw.split('.');
        let jsonText;
        try { jsonText = unb64(encoded); } catch { throw new Error('Share code is not valid'); }
        if (checksum && hash(jsonText) !== checksum) throw new Error('Share code checksum mismatch');
        try { data = JSON.parse(jsonText); } catch { throw new Error('Share code does not contain a profile'); }
      }
      const source = data.profile || data;
      if (!source?.name) throw new Error('Profile payload is invalid');
      const profile = { ...clone(source), id: uid('gp'), name: `${source.name}${state.gameProfiles.some((item) => item.name === source.name) ? ' (imported)' : ''}`, sharing: 'private', version: 1, updatedAt: nowIso(), author: source.author || 'imported' };
      state.gameProfiles.push(profile);
      this.touch('gaming.profile-changed', { action: 'import', profile });
      return profile;
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/publish$/)) {
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      if (!profile) throw new Error('Profile not found');
      profile.sharing = 'community';
      const entry = { id: uid('catalog'), profileId: profile.id, name: profile.name, game: profile.game, author: profile.author, rating: profile.rating || 4.5, downloads: profile.downloads || 0, controls: profile.controls.length, updatedAt: nowIso(), sharing: 'community' };
      this.catalog = [entry, ...this.catalog.filter((item) => item.profileId !== profile.id)];
      this.touch('gaming.published', entry);
      return entry;
    }
    if (route === 'GET /api/gaming/marketplace') return { local: this.catalog, curated: CURATED, publishUrl: '/api/gaming/marketplace', note: 'Demo catalog stored in this browser.' };
    if (route.match(/^POST \/api\/gaming\/marketplace\/[^/]+\/install$/)) {
      const id = path.split('/')[5];
      const entry = this.catalog.find((item) => item.id === id);
      const source = entry ? state.gameProfiles.find((item) => item.id === entry.profileId) : null;
      if (!source) throw new Error('Catalog entry not found');
      const profile = { ...clone(source), id: uid('gp'), name: `${source.name} (catalog)`, downloads: (source.downloads || 0) + 1 };
      state.gameProfiles.push(profile);
      this.touch('gaming.profile-changed', { action: 'import', profile });
      return profile;
    }
    if (route.match(/^POST \/api\/gaming\/profiles\/[^/]+\/sync$/)) {
      if (!state.settings.gameProfileCloudSync) throw new Error('Enable cloud sync in Settings → Gaming first.');
      const profile = state.gameProfiles.find((item) => item.id === path.split('/')[4]);
      profile.lastSyncedAt = nowIso();
      this.touch('gaming.synced', { profileId: profile?.id });
      return { synced: true, profileId: profile?.id, location: 'local sync folder (demo)', syncedAt: profile?.lastSyncedAt };
    }
    if (route === 'GET /api/gaming/sync') return { enabled: state.settings.gameProfileCloudSync, profiles: this.catalog.length, directory: '(demo)' };
    if (route === 'GET /api/gaming/fairplay') return this.fairPlay();
    if (route === 'POST /api/gaming/fairplay/ack') {
      state.settings.aimAssistDisclosureAck = true;
      state.settings.aimAssistAcknowledgedAt = nowIso();
      this.touch('gaming.fairplay-ack', {});
      return this.fairPlay();
    }

    // Search
    if (route === 'GET /api/search') {
      const query = String(q.q || '').toLowerCase();
      const groups = [];
      if (!query) return { query, groups, total: 0 };
      const apps = state.apps.filter((app) => `${app.name} ${app.package}`.toLowerCase().includes(query)).slice(0, 6)
        .map((app) => ({ id: app.id, title: app.name, subtitle: app.package, icon: app.icon, color: app.color, action: { type: 'launch', appId: app.id } }));
      if (apps.length) groups.push({ type: 'apps', label: 'Apps', items: apps });
      const contacts = state.contacts.filter((contact) => `${contact.name} ${contact.number} ${contact.email}`.toLowerCase().includes(query)).slice(0, 6)
        .map((contact) => ({ id: contact.id, title: contact.name, subtitle: contact.number, icon: 'user', color: contact.avatarColor, action: { type: 'call', number: contact.number } }));
      if (contacts.length) groups.push({ type: 'contacts', label: 'Contacts', items: contacts });
      const messages = [];
      for (const conversation of state.conversations) {
        for (const message of conversation.messages) {
          if (message.text?.toLowerCase().includes(query)) messages.push({ id: message.id, title: conversation.name, subtitle: message.text.slice(0, 100), icon: 'message-square', color: conversation.avatarColor, action: { type: 'open-conversation', conversationId: conversation.id } });
        }
      }
      if (messages.length) groups.push({ type: 'messages', label: 'Messages', items: messages.slice(0, 6) });
      const files = this.files.filter((file) => file.path.toLowerCase().includes(query)).slice(0, 6)
        .map((file) => ({ id: file.path, title: file.path.split('/').pop(), subtitle: file.path, icon: 'file', color: '#8ab4f8', action: { type: 'files', path: file.path.split('/').slice(0, -1).join('/') } }));
      if (files.length) groups.push({ type: 'files', label: 'Files', items: files });
      const settings = [
        ['Appearance & theme', 'appearance', 'Theme, contrast, dyslexia font, scale'],
        ['Connection', 'connection', 'Reconnect, wake-on-connect, bandwidth'],
        ['Clipboard', 'sync', 'Clipboard retention and images'],
        ['Audio & camera', 'audio', 'Audio routing, mic, virtual camera'],
        ['Notifications', 'notifications', 'Mirroring, inline replies, DND'],
        ['Keyboard', 'keyboard', 'Global hotkeys'],
        ['Privacy', 'privacy', 'Crash bundles, telemetry (always off)'],
        ['Updates', 'updates', 'Channels and signature verification'],
      ].filter(([title, , desc]) => `${title} ${desc}`.toLowerCase().includes(query))
        .map(([title, section, desc]) => ({ id: section, title, subtitle: desc, icon: 'settings', color: '#8a8f98', action: { type: 'settings', section } }));
      if (settings.length) groups.push({ type: 'settings', label: 'Settings', items: settings });
      const profiles = state.gameProfiles.filter((profile) => `${profile.name} ${profile.game}`.toLowerCase().includes(query)).slice(0, 5)
        .map((profile) => ({ id: profile.id, title: profile.name, subtitle: profile.game, icon: 'gamepad-2', color: '#c084fc', action: { type: 'game-profile', profileId: profile.id } }));
      if (profiles.length) groups.push({ type: 'gaming', label: 'Game profiles', items: profiles });
      return { query: q.q, groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) };
    }

    // Updates
    if (route === 'GET /api/updates') return { ...state.updates, channel: state.settings.updateChannel };
    if (route === 'GET /api/updates/channels') return { channels: Object.entries(CHANNELS).map(([channel, versions]) => ({ channel, versions })) };
    if (route === 'POST /api/updates/check') {
      const channel = state.settings.updateChannel || 'stable';
      const latest = CHANNELS[channel]?.[0];
      state.updates.checkedAt = nowIso();
      state.updates.available = Boolean(latest && latest.version !== state.updates.installed);
      state.updates.latest = latest?.version || state.updates.installed;
      state.updates.notes = state.updates.available ? latest.notes : 'You are on the latest signed release.';
      this.touch('updates.checked', state.updates);
      return { ...state.updates, channel };
    }
    if (route === 'POST /api/updates/apply') {
      if (!state.updates.available) throw new Error('No update is available');
      this.touch('updates.applied', { version: state.updates.latest });
      return { ok: true, version: state.updates.latest, restartRequired: true, verification: { sha256: 'demo', local: false } };
    }
    if (route === 'PATCH /api/updates/channel') {
      state.settings.updateChannel = body.channel;
      return this.request('/api/updates/check', { method: 'POST' });
    }

    // Plugins / diagnostics
    if (route === 'GET /api/plugins') return { plugins: state.plugins, permissions: ['events:read', 'clipboard:read', 'windows:read', 'settings:write', 'notifications:action'], hooks: ['clipboard.changed', 'window.focused', 'notification.received'] };
    if (route === 'POST /api/plugins/scan') return state.plugins;
    if (route.match(/^PATCH \/api\/plugins\/[^/]+$/)) {
      const plugin = state.plugins.find((item) => item.id === path.split('/').at(-1));
      if (plugin) plugin.enabled = body.enabled !== false;
      this.touch('plugins.changed', plugin);
      return plugin;
    }
    if (route === 'GET /api/diagnostics') {
      return {
        version: '2.0.0 (demo)', platform: navigator.platform, arch: 'browser', node: 'n/a',
        uptimeSec: Math.round(performance.now() / 1000), memoryMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : 'unknown',
        device: device?.model || null, reconnect: state.reconnect, metrics: state.diagnostics.metrics,
        logs: this.logs.slice(-20), crashReporting: state.diagnostics.crashReports,
      };
    }
    if (route === 'GET /api/diagnostics/logs') return { entries: this.logs.slice(-100) };
    if (route === 'GET /api/diagnostics/sbom') return { available: false, hint: 'Start the bridge, then run npm run sbom.' };
    if (route === 'GET /api/diagnostics/compatibility') return { devices: [], tiers: [], note: 'Compatibility matrix is served by the bridge.' };
    if (route === 'POST /api/diagnostics/crash-reports') {
      state.diagnostics.crashReports = Boolean(body.enabled);
      this.touch('diagnostics.crash-reports', { enabled: state.diagnostics.crashReports });
      return { crashReporting: state.diagnostics.crashReports, upload: false };
    }
    if (route === 'POST /api/diagnostics/crashes') {
      if (!state.diagnostics.crashReports) return { accepted: false, reason: 'crash reporting is disabled' };
      this.crashBundles = this.crashBundles || [];
      const bundle = { id: uid('crash'), ts: nowIso(), message: body.message || 'demo crash', stack: body.stack || '' };
      this.crashBundles.push(bundle);
      return { accepted: true, storedLocally: true, file: 'localStorage:demo' };
    }
    if (route === 'GET /api/diagnostics/crashes') return { enabled: state.diagnostics.crashReports, entries: this.crashBundles || [] };
    if (route === 'DELETE /api/diagnostics/crashes') { this.crashBundles = []; return { ok: true }; }
    if (route === 'POST /api/diagnostics/benchmark') {
      const start = performance.now();
      for (let i = 0; i < 5000; i += 1) JSON.stringify({ i, x: i, y: i });
      const jsonMs = performance.now() - start;
      return {
        ts: nowIso(),
        environment: { node: 'browser', platform: navigator.platform, cpu: `${navigator.hardwareConcurrency || '?'} cores` },
        results: {
          jsonStringifyPerOpUs: Number(((jsonMs / 5000) * 1000).toFixed(3)),
          pngEncode640x360Ms: null, hmacPerOpUs: null,
          eventBusP50Us: null, eventBusP95Us: null,
        },
        disclaimer: 'Browser-only measurement. Start the bridge for the full benchmark suite.',
      };
    }
    if (route === 'GET /api/health') return { ok: true, service: 'demo' };

    throw Object.assign(new Error(`Demo mode does not implement ${route}. Start the bridge for live control.`), { code: 'demo_unsupported' });
  }

  fairPlay() {
    return {
      acknowledged: Boolean(this.state.settings.aimAssistDisclosureAck),
      policy: '../../doc/FAIR_PLAY.md',
      rules: [
        'Android DEX never bypasses emulator detection, anti-cheat or device integrity checks.',
        'Aim assist and macros are off by default and require this disclosure.',
      ],
    };
  }
}

export { DEMO_FILES };
