/**
 * Android DEX JS SDK — a dependency-free client for the bridge REST + WebSocket API.
 * Works in Node 18+ and modern browsers. No build step.
 *
 *   import { DexClient } from '@android-dex/sdk';
 *   const dex = new DexClient({ url: 'http://127.0.0.1:8787', token: process.env.DEX_TOKEN });
 *   await dex.connect();
 *   dex.on('notification', (n) => console.log(n.title));
 *   await dex.launch('messages');
 */
export class DexError extends Error {
  constructor(message, { status, code, details, path } = {}) {
    super(message);
    this.name = 'DexError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.path = path;
  }
}

const DEFAULT_SOCKET_IMPL = typeof WebSocket !== 'undefined' ? WebSocket : null;

export class DexClient {
  constructor({ url = 'http://127.0.0.1:8787', token = '', fetchImpl, WebSocketImpl, reconnect = true } = {}) {
    this.baseUrl = String(url).replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch?.bind(globalThis);
    if (!this.fetch) throw new DexError('No fetch implementation available; pass fetchImpl.');
    this.WebSocketImpl = WebSocketImpl || DEFAULT_SOCKET_IMPL;
    this.reconnect = reconnect;
    this.state = null;
    this.socket = null;
    this.socketState = 'closed';
    this.handlers = new Map();
    this.attempt = 0;
    this.closedByUser = false;
    this.pingTimer = null;
    this.retryTimer = null;
    this.backoff = { baseMs: 600, factor: 1.8, maxMs: 30000 };
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) { this.handlers.get(event)?.delete(handler); }

  emit(event, payload) {
    for (const handler of this.handlers.get(event) || new Set()) {
      try { handler(payload); } catch (error) { console.error(`dex handler for ${event}`, error); }
    }
    for (const handler of this.handlers.get('*') || new Set()) {
      try { handler({ event, payload }); } catch { /* ignore */ }
    }
  }

  headers(extra = {}) {
    return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  async request(pathname, { method = 'GET', body, query, raw = false, headers = {} } = {}) {
    const url = new URL(`${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const init = { method, headers: this.headers(headers), cache: 'no-store' };
    if (body !== undefined) {
      init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
      if (!init.headers['Content-Type'] && typeof body !== 'string') init.headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetch(url, init);
    if (raw) {
      if (!response.ok) throw await this.#error(response, pathname);
      return response;
    }
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) throw await this.#error(response, pathname, payload);
    return payload;
  }

  async #error(response, pathname, payload) {
    let detail = payload;
    if (detail === undefined) {
      const text = await response.text().catch(() => '');
      detail = text ? safeJson(text) ?? { message: text } : null;
    }
    return new DexError(detail?.error?.message || detail?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: detail?.error?.code || detail?.code,
      details: detail?.error?.details || detail?.details,
      path: pathname,
    });
  }

  async connect() {
    this.closedByUser = false;
    this.state = await this.request('/api/state');
    this.emit('state', this.state);
    this.#openSocket();
    return this.state;
  }

  async refresh() {
    this.state = await this.request('/api/state');
    this.emit('state', this.state);
    return this.state;
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.socket?.close?.();
    this.socket = null;
    this.socketState = 'closed';
    this.emit('socket', { state: 'closed' });
  }

  #openSocket() {
    if (!this.WebSocketImpl) {
      this.socketState = 'unsupported';
      this.emit('socket', { state: 'unsupported' });
      return;
    }
    const protocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const url = `${protocol}://${new URL(this.baseUrl).host}/ws${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
    this.socketState = 'connecting';
    this.emit('socket', { state: 'connecting' });
    let socket;
    try { socket = new this.WebSocketImpl(url); } catch (error) {
      this.socketState = 'error';
      this.emit('socket', { state: 'error', error });
      this.#scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.socketState = 'open';
      this.emit('socket', { state: 'open' });
      this.pingTimer = setInterval(() => {
        try { socket.send(JSON.stringify({ type: 'command', id: Date.now(), action: 'ping' })); } catch { /* closed */ }
      }, 15000);
      this.pingTimer?.unref?.();
    };
    socket.onmessage = (message) => {
      let frame;
      try { frame = JSON.parse(typeof message.data === 'string' ? message.data : message.data.toString()); } catch { return; }
      if (frame.type === 'hello') {
        if (frame.payload?.state) { this.state = frame.payload.state; this.emit('state', this.state); }
        this.emit('hello', frame.payload);
        return;
      }
      if (frame.type === 'pong') { this.emit('pong', frame.payload); return; }
      if (frame.type === 'result') {
        const event = frame.ok === false ? 'command.error' : 'result';
        this.emit(event, frame);
        this.emit('event', frame);
        return;
      }
      this.emit(frame.type, frame.payload);
      this.emit('event', frame);
      if (frame.type !== 'telemetry') this.refresh().catch(() => {});
    };
    socket.onclose = () => {
      clearInterval(this.pingTimer);
      this.socketState = 'closed';
      this.emit('socket', { state: 'closed' });
      this.#scheduleReconnect();
    };
    socket.onerror = (error) => {
      this.socketState = 'error';
      this.emit('socket', { state: 'error', error });
    };
  }

  #scheduleReconnect() {
    if (this.closedByUser || !this.reconnect) return;
    this.attempt += 1;
    const delay = Math.min(this.backoff.maxMs, Math.round(this.backoff.baseMs * this.backoff.factor ** (this.attempt - 1)));
    this.emit('reconnect', { attempt: this.attempt, delayMs: delay });
    this.retryTimer = setTimeout(() => {
      this.refresh().catch(() => {});
      this.#openSocket();
    }, delay);
    this.retryTimer?.unref?.();
  }

  async command(action, payload = {}) {
    if (!this.socket || this.socket.readyState !== 1) throw new DexError('WebSocket is not connected');
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('result', onResult); this.off('error', onError); reject(new DexError(`Command ${action} timed out`)); }, 10000);
      const onResult = (frame) => {
        if (frame?.id !== id) return;
        clearTimeout(timer); this.off('result', onResult); this.off('command.error', onError);
        resolve(frame.payload);
      };
      const onError = (frame) => {
        if (frame?.id !== id) return;
        clearTimeout(timer); this.off('result', onResult); this.off('command.error', onError);
        reject(new DexError(frame.error?.message || 'Command failed', { code: frame.error?.code }));
      };
      this.on('result', onResult); this.on('command.error', onError);
      this.socket.send(JSON.stringify({ type: 'command', id, action, payload }));
    });
  }

  // ── High-level helpers ────────────────────────────────────────────────
  async launch(appId) { return this.request('/api/windows', { method: 'POST', body: { appId } }); }
  async snap(windowId, zone) { return this.request(`/api/windows/${windowId}/snap`, { method: 'POST', body: { zone } }); }
  async closeWindow(windowId) { return this.request(`/api/windows/${windowId}`, { method: 'DELETE' }); }
  async layout(preset) { return this.request('/api/windows/layout', { method: 'POST', body: { preset } }); }

  async clipboard(entry) { return this.request('/api/clipboard', { method: 'POST', body: entry }); }
  async clipboardHistory() { return this.request('/api/clipboard'); }
  async copyItem(id, target = 'device') { return this.request(`/api/clipboard/${id}/copy`, { method: 'POST', body: { target } }); }

  async conversations() { return this.request('/api/telephony/conversations'); }
  async sendSms(to, text, media) {
    return this.request('/api/telephony/messages', { method: 'POST', body: media ? { number: to, text, media } : { number: to, text } });
  }
  async call(number, { video = false } = {}) { return this.request('/api/telephony/calls', { method: 'POST', body: { number, video } }); }
  async hangup(id) { return this.request(`/api/telephony/calls/${id}/hangup`, { method: 'POST', body: {} }); }

  async notifications() { return this.request('/api/notifications'); }
  async reply(notificationId, text) {
    return this.request(`/api/notifications/${notificationId}/action`, { method: 'POST', body: { actionId: 'reply', payload: { text } } });
  }
  async dnd(enabled) { return this.request('/api/notifications/dnd', { method: 'POST', body: { enabled } }); }

  async files(dir = '') { return this.request('/api/files', { query: { dir } }); }
  async upload(name, bytes, { dir = '' } = {}) {
    return this.request('/api/files/upload', {
      method: 'POST', query: { name, dir },
      headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
    });
  }
  downloadUrl(path) { return `${this.baseUrl}/api/files/download?path=${encodeURIComponent(path)}${this.token ? `&token=${encodeURIComponent(this.token)}` : ''}`; }

  async screenshot() { return this.request('/api/capture/screenshot', { method: 'POST', body: {} }); }
  async startRecording() { return this.request('/api/capture/record/start', { method: 'POST', body: { mode: 'screen' } }); }
  async stopRecording() { return this.request('/api/capture/record/stop', { method: 'POST', body: {} }); }

  async search(q) { return this.request('/api/search', { query: { q } }); }
  async settings(patch) { return this.request('/api/settings', { method: 'PATCH', body: patch }); }
  async devices() { return this.request('/api/devices'); }
  async pairStart(body = {}) { return this.request('/api/pair/start', { method: 'POST', body }); }
  async pairStatus() { return this.request('/api/pair/status'); }
  async profiles() { return this.request('/api/gaming/profiles'); }
  async plugins() { return this.request('/api/plugins'); }
  async diagnostics() { return this.request('/api/diagnostics'); }
  async health() { return this.request('/api/health'); }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export default DexClient;
