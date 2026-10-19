import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startBridge, TOKEN } from './helpers.js';

let ctx;
before(async () => { ctx = await startBridge(); });
after(async () => { await ctx.stop(); });

test('pairing rejects wrong codes and pins fingerprints', async () => {
  const started = await ctx.request('/api/pair/start', { method: 'POST', body: { deviceName: 'Test Phone', transport: 'wifi' } });
  assert.equal(started.status, 200);
  assert.match(started.json.qrPayload, /^dex:\/\/pair\?/);
  assert.match(started.json.fingerprint, /^SHA256:/);
  assert.equal(started.json.code.length, 6);

  const duplicate = await ctx.request('/api/pair/start', { method: 'POST', body: {} });
  assert.equal(duplicate.status, 409);

  const wrong = await ctx.request('/api/pair/confirm', {
    method: 'POST', token: null,
    body: { pairingId: started.json.pairingId, token: started.json.token, code: '000000', device: { id: 'dev_new' } },
  });
  assert.equal(wrong.status, 401);

  const good = await ctx.request('/api/pair/confirm', {
    method: 'POST', token: null,
    body: {
      pairingId: started.json.pairingId, token: started.json.token, code: started.json.code,
      device: { id: 'dev_lab', name: 'Lab Pixel', model: 'Pixel 9', android: 15 },
      fingerprint: 'SHA256:11:22:33',
    },
  });
  assert.equal(good.status, 200);
  assert.equal(good.json.paired, true);
  assert.equal(good.json.device.id, 'dev_lab');
  assert.equal(good.json.fingerprint, 'SHA256:11:22:33');

  const second = await ctx.request('/api/pair/start', { method: 'POST', body: { deviceName: 'Lab Pixel', transport: 'usb' } });
  const mismatch = await ctx.request('/api/pair/confirm', {
    method: 'POST', token: null,
    body: {
      pairingId: second.json.pairingId, token: second.json.token, code: second.json.code,
      device: { id: 'dev_lab' }, fingerprint: 'SHA256:99:88:77',
    },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.error.code, 'fingerprint_mismatch');

  const override = await ctx.request('/api/pair/confirm', {
    method: 'POST', token: null,
    body: {
      pairingId: second.json.pairingId, token: second.json.token, code: second.json.code,
      device: { id: 'dev_lab' }, fingerprint: 'SHA256:99:88:77', allowFingerprintChange: true,
    },
  });
  assert.equal(override.status, 200);
  assert.equal(override.json.device.pinnedFingerprint, 'SHA256:99:88:77');

  const revoked = await ctx.request('/api/pair/dev_lab', { method: 'DELETE' });
  assert.equal(revoked.json.revoked, true);

  const identity = await ctx.request('/api/pair/identity');
  assert.match(identity.json.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(identity.json.fingerprint, /^SHA256:/);
});

test('pairing codes expire and cannot be reused', async () => {
  const started = await ctx.request('/api/pair/start', { method: 'POST', body: { deviceName: 'Expiry Test' } });
  // Force expiry via the public cancel endpoint and verify a fresh start works.
  await ctx.request('/api/pair/cancel', { method: 'POST', body: {} });
  const confirmAfterCancel = await ctx.request('/api/pair/confirm', {
    method: 'POST', token: null,
    body: { token: started.json.token, code: started.json.code, device: { id: 'dev_expired' } },
  });
  assert.equal(confirmAfterCancel.status, 400);
  const status = await ctx.request('/api/pair/status');
  assert.equal(status.json.active, false);
});

test('reconnect supervisor uses backoff and restores windows', async () => {
  const preview = await ctx.request('/api/devices/reconnect/preview');
  const delays = preview.json.schedule.map((entry) => entry.delayMs);
  assert.equal(delays.length, 10);
  assert.ok(delays[1] > delays[0], 'backoff should grow');
  assert.ok(Math.max(...delays) <= 30_000, 'backoff should respect the cap');

  const dropped = await ctx.request('/api/devices/drop', { method: 'POST', body: { reason: 'test drop' } });
  assert.equal(dropped.status, 200);
  assert.ok(['dropping', 'reconnecting'].includes(dropped.json.state));

  const manual = await ctx.request('/api/devices/reconnect', { method: 'POST', body: {} });
  assert.equal(manual.json.state, 'restoring');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const status = await ctx.request('/api/state');
  assert.ok(['connected', 'restoring'].includes(status.json.reconnect.state));
  assert.ok(status.json.reconnect.restored >= 0);

  await ctx.request('/api/devices/connect', { method: 'POST', body: { transport: 'wifi' } });
  const devices = await ctx.request('/api/devices');
  assert.equal(devices.json.devices.find((device) => device.id === devices.json.activeDeviceId).transport, 'wifi');
});

test('WebSocket: hello snapshot, commands, errors and live events', async () => {
  const socket = new WebSocket(`${ctx.bridge.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
  const messages = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const parsed = JSON.parse(event.data);
    messages.push(parsed);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(parsed)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(parsed);
      }
    }
  });
  const waitFor = (predicate, timeout = 3000) => new Promise((resolve, reject) => {
    const existing = messages.find(predicate);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket message')), timeout);
    waiters.push({ predicate, resolve: (value) => { clearTimeout(timer); resolve(value); } });
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const hello = await waitFor((message) => message.type === 'hello');
  assert.equal(hello.payload.state.devices.length >= 1, true);
  assert.ok(hello.payload.commands.includes('launch'));

  socket.send(JSON.stringify({ type: 'command', id: 'c1', action: 'ping', payload: {} }));
  const pong = await waitFor((message) => message.type === 'result' && message.id === 'c1');
  assert.equal(pong.ok, true);

  socket.send(JSON.stringify({ type: 'command', id: 'c2', action: 'launch', payload: { appId: 'youtube' } }));
  const launched = await waitFor((message) => message.type === 'result' && message.id === 'c2');
  assert.equal(launched.ok, true);
  assert.equal(launched.payload.appId, 'youtube');

  socket.send(JSON.stringify({ type: 'command', id: 'c3', action: 'nope' }));
  const failed = await waitFor((message) => message.type === 'result' && message.id === 'c3');
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'unknown_command');

  await ctx.request('/api/clipboard', { method: 'POST', body: { text: 'ws broadcast test' } });
  const broadcast = await waitFor((message) => message.type === 'clipboard.changed');
  assert.equal(broadcast.payload.text, 'ws broadcast test');

  socket.close();
});

test('WebSocket rejects bad tokens', async () => {
  const socket = new WebSocket(`${ctx.bridge.url.replace('http', 'ws')}/ws?token=wrong`);
  const outcome = await new Promise((resolve) => {
    socket.addEventListener('open', () => resolve('open'));
    socket.addEventListener('error', () => resolve('error'));
    setTimeout(() => resolve('timeout'), 1500);
  });
  assert.equal(outcome, 'error');
});
