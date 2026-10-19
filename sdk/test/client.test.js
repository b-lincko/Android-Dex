import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DexClient, DexError } from '../dex-client.js';

const url = process.env.DEX_TEST_URL || 'http://127.0.0.1:8790';
const token = process.env.DEX_TEST_TOKEN || 'smoke';

test('connect loads the state snapshot', async () => {
  const dex = new DexClient({ url, token, reconnect: false });
  const state = await dex.connect();
  assert.ok(Array.isArray(state.apps) && state.apps.length > 0);
  assert.equal(state.version, 2);
  assert.ok(state.settings);
  dex.close();
});

test('health is public and identifies the service', async () => {
  const dex = new DexClient({ url, token });
  const health = await dex.health();
  assert.equal(health.service, 'android-dex-bridge');
  assert.equal(health.ok, true);
});

test('request errors surface status and code', async () => {
  const dex = new DexClient({ url, token: 'wrong-token' });
  await assert.rejects(() => dex.request('/api/state'), (error) => {
    assert.ok(error instanceof DexError);
    assert.equal(error.status, 401);
    return true;
  });
});

test('launch, snap and close a window', async () => {
  const dex = new DexClient({ url, token });
  const before = (await dex.refresh()).windows.length;
  const win = await dex.launch('messages');
  assert.ok(win.id);
  const opened = await dex.refresh();
  assert.ok(opened.windows.some((item) => item.id === win.id), 'window exists after launch');
  assert.ok(opened.windows.length >= before, 'launch never removes windows');
  const snapped = await dex.snap(win.id, 'left-half');
  assert.equal(snapped.x, 0, 'left-half starts at x=0');
  assert.ok(snapped.w <= 1280, 'left-half is half of the primary monitor');
  await dex.closeWindow(win.id);
  const closed = await dex.refresh();
  assert.ok(!closed.windows.some((item) => item.id === win.id), 'window is gone after close');
});

test('clipboard add round-trips', async () => {
  const dex = new DexClient({ url, token });
  const entry = await dex.clipboard({ kind: 'text', text: `sdk-${Date.now()}`, source: 'desktop' });
  assert.ok(entry.id);
  const history = await dex.clipboardHistory();
  assert.ok(history.items.some((item) => item.id === entry.id));
});

test('settings patch merges and validates', async () => {
  const dex = new DexClient({ url, token });
  const next = await dex.settings({ highContrast: false });
  assert.equal(next.highContrast, false);
  await assert.rejects(() => dex.settings({ theme: 'neon' }), (error) => {
    assert.equal(error.status, 400);
    return true;
  });
});

test('websocket command returns a result', async () => {
  if (typeof WebSocket === 'undefined') return;
  const dex = new DexClient({ url, token });
  await dex.connect();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not open')), 5000);
    dex.on('socket', (event) => {
      if (event.state === 'open') { clearTimeout(timer); resolve(); }
    });
  });
  const result = await dex.command('ping');
  assert.ok(result);
  dex.close();
});
