/**
 * Minimal RFC 6455 client for the tests.
 *
 * Node only exposes a global `WebSocket` from v21/22, while the bridge supports
 * Node 20.11+. Using the built-in client made the whole suite fail on Node 20
 * with `ReferenceError: WebSocket is not defined`, so the tests carry their own
 * tiny implementation instead of raising the runtime floor.
 *
 * Supports text frames, fragmentation, ping/pong and close. No extensions, no
 * permessage-deflate — exactly what the bridge's own server speaks.
 */
import { EventEmitter } from 'node:events';
import http from 'node:http';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

export class TestWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.readyState = 'connecting';
    this.socket = null;
    this.received = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;

    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
      },
    });

    request.on('upgrade', (response, socket, head) => {
      const expected = crypto.createHash('sha1')
        .update(request.getHeader('sec-websocket-key') + GUID)
        .digest('base64');
      if (response.headers['sec-websocket-accept'] !== expected) {
        socket.destroy();
        this.#fail(new Error('invalid Sec-WebSocket-Accept'));
        return;
      }
      this.socket = socket;
      this.readyState = 'open';
      socket.setNoDelay(true);
      socket.on('data', (chunk) => this.#onData(chunk));
      socket.on('close', () => this.#closed());
      socket.on('error', (error) => this.#fail(error));
      // Early frames (the server's `hello`) can arrive with the 101 response.
      if (head && head.length) this.#onData(head);
      this.emit('open');
    });

    request.on('response', (response) => {
      response.resume();
      this.#fail(new Error(`unexpected HTTP ${response.statusCode}`));
    });
    request.on('error', (error) => this.#fail(error));
    request.end();
  }

  // The DOM-style API keeps the test readable and matches browser code.
  addEventListener(type, listener) {
    this.on(type, listener);
  }

  removeEventListener(type, listener) {
    this.off(type, listener);
  }

  send(text) {
    if (this.readyState !== 'open') throw new Error('socket is not open');
    this.socket.write(encodeFrame(0x1, text));
  }

  close() {
    if (this.socket && this.readyState === 'open') {
      try { this.socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch { /* already gone */ }
    }
    this.readyState = 'closing';
    this.socket?.end();
    setTimeout(() => this.socket?.destroy(), 50).unref?.();
  }

  #fail(error) {
    this.readyState = 'closed';
    if (this.listenerCount('error')) this.emit('error', error);
    else this.emit('close', { code: 1006, reason: error.message });
  }

  #closed() {
    const wasOpen = this.readyState === 'open';
    this.readyState = 'closed';
    if (wasOpen) this.emit('close', { code: 1000, reason: '' });
  }

  #onData(chunk) {
    this.received = Buffer.concat([this.received, chunk]);
    for (;;) {
      const frame = this.#readFrame();
      if (!frame) return;
      this.#handleFrame(frame);
      if (this.readyState === 'closed') return;
    }
  }

  #readFrame() {
    const buffer = this.received;
    if (buffer.length < 2) return null;
    const fin = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < offset + 2) return null;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return null;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    let mask = null;
    if (masked) {
      if (buffer.length < offset + 4) return null;
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.length < offset + length) return null;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    this.received = buffer.subarray(offset + length);
    return { fin, opcode, payload };
  }

  #handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x9) { this.socket?.write(encodeFrame(0xa, payload)); return; }
    if (opcode === 0xa) return;
    if (opcode === 0x8) {
      this.readyState = 'closed';
      this.socket?.end();
      this.emit('close', { code: payload.length >= 2 ? payload.readUInt16BE(0) : 1005, reason: payload.subarray(2).toString() });
      return;
    }
    if (opcode === 0x0) this.fragments.push(payload);
    else { this.fragmentOpcode = opcode; this.fragments = [payload]; }
    if (!fin) return;
    const complete = Buffer.concat(this.fragments);
    const type = this.fragmentOpcode;
    this.fragments = [];
    this.fragmentOpcode = null;
    if (type === 0x1) this.emit('message', { data: complete.toString('utf8') });
    else if (type === 0x2) this.emit('message', { data: complete });
  }
}

export const createSocket = (url) => new TestWebSocket(url);

/** Resolve once the socket is open, reject on error or timeout. */
export function waitOpen(socket, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === 'open') return resolve(socket);
    const timer = setTimeout(() => reject(new Error('websocket open timed out')), timeout);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); });
    socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
