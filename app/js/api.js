/**
 * API transport.
 *
 * LiveClient  — talks to the bridge over REST + WebSocket.
 * DemoClient  — an in-browser reimplementation used on static hosting.
 *
 * Both expose the same surface so views never branch on the mode (except for
 * explicit “start the bridge” hints).
 */
import { Bus, debounce, storage } from './core.js';
import { DemoBackend } from './demo.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BaseClient {
  constructor() {
    this.events = new Bus();
    this.state = null;
    this.metrics = { latencyMs: null, fps: 60, bitrateMbps: 16, drops: 0 };
    this.ready = false;
  }
  on(type, handler) { return this.events.on(type, handler); }
  off(type, handler) { this.events.off(type, handler); }
  emit(type, payload) { this.events.emit(type, payload); }
  get settings() { return this.state?.settings || {}; }
  get device() {
    if (!this.state) return null;
    return this.state.devices.find((item) => item.id === this.state.activeDeviceId) || this.state.devices[0] || null;
  }
  async refresh() { return this.state; }
  async reset() { return false; }
}

export class LiveClient extends BaseClient {
  constructor(baseUrl, token) {
    super();
    this.mode = 'live';
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token || '';
    this.socket = null;
    this.socketState = 'closed';
    this.reconnectAttempt = 0;
    this.closed = false;
    this.appliedToken = false;
  }

  headers(json = false) {
    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (json) headers['content-type'] = 'application/json';
    return headers;
  }

  async request(pathname, { method = 'GET', body, query } = {}) {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const started = performance.now();
    const response = await fetch(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.metrics.latencyMs = Math.round(performance.now() - started);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      if (response.status === 401) this.needsAuth = true;
      const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.details = payload?.error?.details;
      throw error;
    }
    return payload;
  }

  async start() {
    this.state = await this.request('/api/state');
    this.applySettingsTheme();
    this.ready = true;
    this.emit('ready', { mode: 'live', state: this.state });
    this.connectSocket();
    setInterval(() => this.ping(), 15000);
    return this;
  }

  applySettingsTheme() {
    if (this.state?.settings) this.emit('settings.changed', this.state.settings);
  }

  async ping() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this._pingSentAt = performance.now();
      this.socket.send(JSON.stringify({ type: 'ping' }));
    }
  }

  connectSocket() {
    if (this.closed) return;
    const protocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const url = `${protocol}://${new URL(this.baseUrl).host}/ws${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
    this.socketState = 'connecting';
    this.emit('socket.state', { state: 'connecting' });
    let socket;
    try { socket = new WebSocket(url); } catch (error) { this.scheduleReconnect(); return; }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.socketState = 'open';
      this.reconnectAttempt = 0;
      this.emit('socket.state', { state: 'open' });
    });
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'hello') {
        if (message.payload?.state) {
          this.state = message.payload.state;
          this.emit('state', this.state);
        }
        return;
      }
      if (message.type === 'pong') {
        if (this._pingSentAt) {
          this.metrics.latencyMs = Math.round(performance.now() - this._pingSentAt);
          this._pingSentAt = null;
          this.emit('metrics', this.metrics);
        }
        return;
      }
      if (message.type === 'telemetry') {
        const device = this.device;
        if (device && message.payload?.battery) Object.assign(device, { battery: message.payload.battery, signal: message.payload.signal });
        if (message.payload?.quality) this.metrics.fps = message.payload.quality.fps;
        if (message.payload?.reconnect && this.state) this.state.reconnect = message.payload.reconnect;
        this.emit('telemetry', message.payload);
        this.emit('metrics', this.metrics);
        return;
      }
      this.events.emit(message.type, message.payload);
      this.events.emit('event', message);
      this.scheduleRefresh(message.type);
    });
    socket.addEventListener('close', () => {
      this.socketState = 'closed';
      this.emit('socket.state', { state: 'closed' });
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.socketState = 'error';
      this.emit('socket.state', { state: 'error' });
    });
  }

  scheduleRefresh = debounce(async () => {
    try {
      const state = await this.request('/api/state');
      this.state = state;
      this.emit('state', state);
    } catch { /* keep previous state */ }
  }, 260);

  scheduleReconnect() {
    if (this.closed) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30000, 600 * 1.8 ** (this.reconnectAttempt - 1));
    this.emit('socket.retry', { attempt: this.reconnectAttempt, delayMs: Math.round(delay) });
    setTimeout(() => this.connectSocket(), delay);
  }

  command(action, payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
    this.socket.send(JSON.stringify({ type: 'command', action, payload }));
  }

  async uploadFile(file, dir = '') {
    const url = new URL(`${this.baseUrl}/api/files/upload`);
    url.searchParams.set('name', file.name);
    if (dir) url.searchParams.set('dir', dir);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(false), 'content-type': file.type || 'application/octet-stream' },
      body: file,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || 'Upload failed');
    return payload;
  }

  downloadUrl(path) {
    const url = new URL(`${this.baseUrl}/api/files/download`);
    url.searchParams.set('path', path);
    if (this.token) url.searchParams.set('token', this.token);
    return url.toString();
  }

  mediaLatestUrl() {
    return `${this.baseUrl}/api/media/webcam/latest${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}&t=${Date.now()}`.replace('?&', '?');
  }

  streamUrl() {
    return `${this.baseUrl}/api/media/webcam/stream${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
  }

  stop() {
    this.closed = true;
    this.socket?.close();
  }
}

const MINIMAL_STATE = {
  version: 2, settings: { theme: 'dark', locale: 'en', uiScale: 100, hotkeys: {} },
  devices: [], activeDeviceId: null, apps: [], windows: [], monitors: [{ id: 'mon_main', name: 'Display', width: 1920, height: 1080, primary: true, x: 0, y: 0 }],
  widgets: [], clipboard: [], conversations: [], contacts: [], notifications: [], calls: [], gameProfiles: [],
  quickTiles: [], plugins: [], notes: [],
  media: { sessions: [], activeSessionId: null, volume: 50, muted: false, micMuted: true, micGain: 50, virtualCamera: false, webcamFps: 30, screenshots: [], recordings: [], recording: { active: false } },
  input: { gamepad: { connected: false, axes: [], buttons: 0 }, stylus: { pressure: 0 } },
  updates: { installed: '2.0.0', latest: '2.0.0', available: false, channel: 'stable' },
  reconnect: { state: 'offline', attempt: 0, healthScore: 100 },
  security: { pairedFingerprints: [], audit: [] },
  diagnostics: { crashReports: false, metrics: { httpRequests: 0, wsClients: 0 }, bootCount: 1 },
};

export class DemoClient extends BaseClient {
  constructor(snapshot) {
    super();
    this.mode = 'demo';
    this.baseUrl = location.origin;
    this.backend = new DemoBackend(snapshot || MINIMAL_STATE);
    this.socketState = 'demo';
    this.needsAuth = false;
  }

  async start() {
    this.state = this.backend.state;
    this.ready = true;
    this.backend.on('refresh', ({ event, payload }) => {
      this.state = this.backend.state;
      this.emit('event', { type: event, payload });
      this.emit('state', this.state);
    });
    this.emit('ready', { mode: 'demo', state: this.state });
    return this;
  }

  async request(pathname, options = {}) {
    const started = performance.now();
    const result = await this.backend.request(pathname, options);
    this.metrics.latencyMs = Number((performance.now() - started).toFixed(2));
    this.state = this.backend.state;
    return result;
  }

  async refresh() {
    this.state = this.backend.state;
    return this.state;
  }

  async uploadFile(file, dir = '') {
    const result = await this.backend.uploadFile(file, dir);
    this.state = this.backend.state;
    return result;
  }

  downloadUrl(path) { return this.backend.downloadUrl(path); }

  mediaLatestUrl() { return 'assets/stream-preview.svg'; }

  streamUrl() { return 'assets/stream-preview.svg'; }

  reset() { this.backend.reset(); }

  async resetDemo() {
    return this.backend.reset();
  }
}

async function probe(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${base}/api/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.service === 'android-dex-bridge' ? payload : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function createApi() {
  const params = new URLSearchParams(location.search);
  const forceDemo = params.get('demo') === '1' || storage.get('forceDemo', false);
  const storedBase = storage.get('api.base', '');
  const storedToken = storage.get('api.token', '');
  const token = params.get('token') || storedToken || '';
  const candidates = [];
  if (!forceDemo) {
    if (params.get('api')) candidates.push(params.get('api').replace(/\/$/, ''));
    if (location.protocol.startsWith('http')) candidates.push(location.origin);
    if (storedBase && !candidates.includes(storedBase)) candidates.push(storedBase.replace(/\/$/, ''));
  }

  for (const base of candidates) {
    // Same-origin probes are cheap and never leave the LAN.
    const health = await probe(base);
    if (health) {
      if (params.get('token')) storage.set('api.token', params.get('token'));
      if (params.get('api')) storage.set('api.base', base);
      const client = new LiveClient(base, token);
      try {
        await client.start();
        return client;
      } catch (error) {
        if (error.status === 401) {
          client.needsAuth = true;
          client.ready = false;
          client.emit('auth.required', { base });
          return client;
        }
        console.warn('bridge probe succeeded but start failed', error);
      }
    }
  }

  let snapshot = MINIMAL_STATE;
  try {
    const response = await fetch('data/demo-state.json', { cache: 'no-store' });
    if (response.ok) snapshot = await response.json();
  } catch { /* offline: minimal state */ }
  const demo = new DemoClient(snapshot);
  await demo.start();
  return demo;
}

export { MINIMAL_STATE };
