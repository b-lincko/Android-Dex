/**
 * Dependency-free RFC 6455 WebSocket server (text frames, fragmentation,
 * ping/pong, close). Used for the live control plane:
 *   → server: hello, events
 *   ← client: {type:"command", id, action, payload}
 *
 * Security: optional token check on the upgrade request and a hard cap on
 * message size (1 MB). Binary frames are rejected.
 */
import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1024 * 1024;

export class WebSocketHub {
  constructor({ runtime, token = null, path = '/ws' } = {}) {
    this.runtime = runtime;
    this.token = token;
    this.path = path;
    this.clients = new Set();
    this.commandHandler = null;
  }

  onCommand(handler) { this.commandHandler = handler; }

  authorized(req, url) {
    if (!this.token) return true;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ') && header.slice(7) === this.token) return true;
    const provided = url.searchParams.get('token');
    return provided === this.token;
  }

  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!this.authorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain\r\n\r\ninvalid token');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));
    const client = new WsClient(socket, this);
    this.clients.add(client);
    this.runtime.state.diagnostics.metrics.wsClients = this.clients.size;
    this.runtime.logger.info('ws', `client connected (${this.clients.size} total)`);
    this.sendTo(client, {
      type: 'hello',
      payload: {
        bridge: 'Android DEX Bridge',
        version: '2.0.0',
        commands: ['launch', 'media.control', 'clipboard.add', 'sms.send', 'call.start', 'window.snap', 'settings.patch', 'search', 'ping'],
        state: this.runtime.snapshot(),
      },
    });
    this.broadcast('clients', { count: this.clients.size });
    socket.on('close', () => this.remove(client));
    socket.on('error', () => this.remove(client));
    return client;
  }

  remove(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    this.runtime.state.diagnostics.metrics.wsClients = this.clients.size;
    this.broadcast('clients', { count: this.clients.size });
  }

  sendTo(client, message) {
    try { client.sendJson(message); } catch { this.remove(client); }
  }

  broadcast(type, payload) {
    const frame = JSON.stringify({ type, payload, ts: new Date().toISOString() });
    for (const client of this.clients) {
      try { client.sendText(frame); } catch { this.remove(client); }
    }
  }

  attach() {
    const bus = this.runtime.bus;
    const forward = [
      'telemetry', 'notification.received', 'notification.updated', 'notification.replied', 'notification.dismissed',
      'clipboard.changed', 'clipboard.updated', 'clipboard.removed', 'clipboard.cleared',
      'telephony.message', 'telephony.status', 'telephony.read', 'telephony.typing',
      'calls.incoming', 'calls.outgoing', 'calls.active', 'calls.ended', 'calls.dtmf', 'calls.mute', 'calls.changed',
      'windows.changed', 'windows.launched', 'windows.closed', 'windows.focused', 'windows.routed',
      'widgets.changed', 'monitors.changed', 'media.changed', 'media.routed', 'media.mic', 'media.webcam',
      'capture.screenshot', 'capture.recording-started', 'capture.recording-stopped',
      'reconnect.state', 'reconnect.dropped', 'reconnect.restored', 'reconnect.manual',
      'system.tile', 'system.locked', 'system.unlocked', 'system.keep-awake', 'system.charge-throttle',
      'device.connected', 'device.wake', 'device.disconnected', 'pairing.started', 'pairing.completed', 'pairing.cancelled',
      'gaming.profile-changed', 'gaming.bound', 'gaming.macro', 'gaming.sensitivity', 'gaming.published', 'gaming.synced',
      'updates.checked', 'updates.applied', 'plugins.changed', 'plugins.activated', 'plugins.deactivated',
      'settings.changed', 'theme.changed', 'dnd.changed', 'locale.changed', 'hotkeys.changed',
      'input.gamepad', 'input.stylus', 'files.changed', 'transfer.queued', 'transfer.complete', 'transfer.received',
      'diagnostics.crash-stored', 'search.open.request', 'clipboard.open.request', 'capture.screenshot.request',
      'capture.record.toggle', 'system.lock.request', 'hotkey.pressed',
    ];
    for (const event of forward) {
      bus.on(event, (payload) => this.broadcast(event, payload));
    }
    bus.on('clients', () => {});
  }

  /** Handle a parsed client message. */
  async onMessage(client, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.sendTo(client, { type: 'error', payload: { code: 'bad_json', message: 'messages must be JSON' } });
    }
    if (message.type === 'ping') return this.sendTo(client, { type: 'pong', payload: { ts: Date.now() } });
    if (message.type !== 'command') {
      return this.sendTo(client, { type: 'error', payload: { code: 'unknown_type', message: `unknown message type ${message.type}` } });
    }
    if (!this.commandHandler) {
      return this.sendTo(client, { type: 'error', payload: { code: 'unsupported', message: 'commands are not enabled' } });
    }
    const { id, action, payload } = message;
    try {
      const result = await this.commandHandler(action, payload || {});
      this.sendTo(client, { type: 'result', id, ok: true, payload: result });
    } catch (error) {
      this.sendTo(client, { type: 'result', id, ok: false, error: { code: error.code || 'error', message: error.message } });
    }
  }

  close() {
    for (const client of this.clients) client.close(1001, 'server shutting down');
    this.clients.clear();
  }
}

class WsClient {
  constructor(socket, hub) {
    this.socket = socket;
    this.hub = hub;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.alive = true;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.setKeepAlive?.(true, 30_000);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const second = this.buffer[1];
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (length > MAX_PAYLOAD) return this.close(1009, 'message too large');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (this.buffer.length < offset + 4 + length) return;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.alloc(length);
      for (let i = 0; i < length; i += 1) payload[i] = this.buffer[offset + 4 + i] ^ mask[i % 4];
      this.buffer = this.buffer.subarray(offset + 4 + length);
      this.handleFrame(fin, opcode, payload);
    }
  }

  handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) return this.close(1000, 'peer closed');
    if (opcode === 0x9) return this.sendFrame(0xa, payload);
    if (opcode === 0xa) return;
    if (opcode === 0x2) return this.close(1003, 'binary frames are not supported');
    if (opcode === 0x1 || opcode === 0x0) {
      if (opcode === 0x1) {
        this.fragmentOpcode = 0x1;
        this.fragments = [payload];
      } else {
        this.fragments.push(payload);
      }
      if (!fin) return;
      const complete = Buffer.concat(this.fragments);
      this.fragments = [];
      this.fragmentOpcode = null;
      this.hub.onMessage(this, complete.toString('utf8'));
    }
  }

  sendJson(message) { this.sendText(JSON.stringify(message)); }

  sendText(text) { this.sendFrame(0x1, Buffer.from(text, 'utf8')); }

  sendFrame(opcode, payload) {
    if (this.socket.destroyed) throw new Error('socket closed');
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  close(code = 1000, reason = '') {
    try {
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code, 0);
      payload.write(reason, 2);
      this.sendFrame(0x8, payload);
      this.socket.end();
    } catch { /* already closed */ }
    this.hub.remove(this);
  }
}

export const _internals = { randomBytes, MAX_PAYLOAD };
