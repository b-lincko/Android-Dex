import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startBridge, TOKEN } from './helpers.js';

let ctx;
before(async () => { ctx = await startBridge(); });
after(async () => { await ctx.stop(); });

test('health is public and advertises capabilities', async () => {
  const response = await ctx.request('/api/health', { token: null });
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.ok(response.json.features.includes('webdav'));
  assert.equal(response.json.authRequired, true);
});

test('API requires the bridge token', async () => {
  const unauthorized = await ctx.request('/api/state', { token: null });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.json.error.code, 'unauthorized');
  const wrong = await ctx.request('/api/state', { token: 'nope' });
  assert.equal(wrong.status, 401);
});

test('state snapshot contains every top-level surface', async () => {
  const response = await ctx.request('/api/state');
  assert.equal(response.status, 200);
  for (const key of ['settings', 'devices', 'apps', 'windows', 'monitors', 'widgets', 'clipboard', 'conversations', 'contacts', 'notifications', 'gameProfiles', 'quickTiles', 'media', 'updates', 'reconnect', 'security', 'diagnostics']) {
    assert.ok(key in response.json, `missing ${key}`);
  }
  assert.equal(response.json.security.pairing, null);
});

test('settings validation rejects bad enums and accepts valid patches', async () => {
  const bad = await ctx.request('/api/settings', { method: 'PATCH', body: { theme: 'neon' } });
  assert.equal(bad.status, 400);
  const unknown = await ctx.request('/api/settings', { method: 'PATCH', body: { nope: true } });
  assert.equal(unknown.status, 400);
  const good = await ctx.request('/api/settings', { method: 'PATCH', body: { theme: 'light', uiScale: 110 } });
  assert.equal(good.status, 200);
  assert.equal(good.json.theme, 'light');
  await ctx.request('/api/settings', { method: 'PATCH', body: { theme: 'dark', uiScale: 100 } });
});

test('clipboard supports text, images, pinning, copy and clear', async () => {
  const created = await ctx.request('/api/clipboard', { method: 'POST', body: { text: 'hello from test', kind: 'text' } });
  assert.equal(created.status, 200);
  assert.equal(created.json.source, 'desktop');
  const listed = await ctx.request('/api/clipboard');
  assert.ok(listed.json.items.some((item) => item.text === 'hello from test'));
  const pinned = await ctx.request(`/api/clipboard/${created.json.id}`, { method: 'PATCH' });
  assert.equal(pinned.json.pinned, true);
  const copied = await ctx.request(`/api/clipboard/${created.json.id}/copy`, { method: 'POST', body: { target: 'host' } });
  assert.equal(copied.json.target, 'host');
  const image = await ctx.request('/api/clipboard', { method: 'POST', body: { kind: 'image', text: 'shot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } });
  assert.equal(image.json.kind, 'image');
  const badImage = await ctx.request('/api/clipboard', { method: 'POST', body: { kind: 'image', dataUrl: 'javascript:alert(1)' } });
  assert.equal(badImage.status, 400);
  const cleared = await ctx.request('/api/clipboard/clear', { method: 'POST', body: { keepPinned: true } });
  assert.ok(cleared.json.removed >= 1);
});

test('files: list, upload, download, mkdir, delete', async () => {
  const initial = await ctx.request('/api/files');
  assert.equal(initial.status, 200);
  assert.ok(initial.json.items.some((item) => item.name === 'Read Me.md'));
  assert.equal(initial.json.share.webdav, '/dav/');

  const uploaded = await ctx.request('/api/files/upload?name=notes.txt&dir=Documents', {
    method: 'POST', body: Buffer.from('hello bridge'), headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.json.size, 12);

  const downloaded = await ctx.request('/api/files/download?path=Documents%2Fnotes.txt');
  assert.equal(downloaded.text, 'hello bridge');

  const made = await ctx.request('/api/files/mkdir', { method: 'POST', body: { path: 'Projects/Deep' } });
  assert.equal(made.json.kind, 'folder');

  const traversal = await ctx.request('/api/files/download?path=..%2F..%2Fetc%2Fpasswd');
  assert.equal(traversal.status, 404);

  const deleted = await ctx.request('/api/files?path=Documents%2Fnotes.txt', { method: 'DELETE' });
  assert.equal(deleted.status, 200);
});

test('WebDAV exposes the share as a mountable drive', async () => {
  const options = await ctx.request('/dav/', { method: 'OPTIONS', token: null });
  assert.equal(options.status, 401);

  const optionsAuthed = await fetch(`${ctx.bridge.url}/dav/`, {
    method: 'OPTIONS', headers: { authorization: `Basic ${Buffer.from(`dex:${TOKEN}`).toString('base64')}` },
  });
  assert.equal(optionsAuthed.status, 200);
  assert.match(optionsAuthed.headers.get('dav'), /1/);

  const propfind = await fetch(`${ctx.bridge.url}/dav/`, {
    method: 'PROPFIND', headers: { authorization: `Bearer ${TOKEN}`, depth: '1' },
  });
  assert.equal(propfind.status, 207);
  const xml = await propfind.text();
  assert.match(xml, /<d:multistatus/);
  assert.match(xml, /Read Me\.md/);

  const put = await fetch(`${ctx.bridge.url}/dav/Inbox/drop.txt`, {
    method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'dropped',
  });
  assert.equal(put.status, 201);

  const get = await fetch(`${ctx.bridge.url}/dav/Inbox/drop.txt`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(await get.text(), 'dropped');

  const propfindDeep = await fetch(`${ctx.bridge.url}/dav/Inbox/drop.txt`, {
    method: 'PROPFIND', headers: { authorization: `Bearer ${TOKEN}`, depth: '0' },
  });
  assert.equal(propfindDeep.status, 207);
  assert.match(await propfindDeep.text(), /drop\.txt/);

  const removed = await fetch(`${ctx.bridge.url}/dav/Inbox/drop.txt`, {
    method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(removed.status, 204);
});

test('windows: launch, snap, PiP, orientation, DPI and monitor routing', async () => {
  const launched = await ctx.request('/api/windows', { method: 'POST', body: { appId: 'chrome' } });
  assert.equal(launched.status, 200);
  const id = launched.json.id;

  const snapped = await ctx.request(`/api/windows/${id}/snap`, { method: 'POST', body: { zone: 'right-half' } });
  assert.equal(snapped.json.snapped, 'right-half');
  assert.equal(snapped.json.x, 1280);
  assert.equal(snapped.json.w, 1280);

  const pip = await ctx.request(`/api/windows/${id}`, { method: 'PATCH', body: { pip: true } });
  assert.equal(pip.json.pip, true);
  assert.equal(pip.json.alwaysOnTop, true);

  const oriented = await ctx.request(`/api/windows/${id}`, { method: 'PATCH', body: { orientation: 'locked-landscape', dpi: 480 } });
  assert.equal(oriented.json.orientation, 'locked-landscape');
  assert.equal(oriented.json.dpi, 480);

  const routed = await ctx.request(`/api/windows/${id}`, { method: 'PATCH', body: { monitorId: 'mon_side' } });
  assert.equal(routed.json.monitorId, 'mon_side');

  const invalid = await ctx.request(`/api/windows/${id}`, { method: 'PATCH', body: { orientation: 'diagonal' } });
  assert.equal(invalid.status, 400);

  const layout = await ctx.request('/api/windows/layout', { method: 'POST', body: { preset: '3-columns' } });
  assert.equal(layout.status, 200);
  assert.ok(layout.json.windows.length >= 2);

  const launcher = await ctx.request('/api/apps/chrome/launcher?platform=linux');
  assert.match(launcher.json.content, /\[Desktop Entry\]/);
  assert.match(launcher.json.filename, /chrome\.desktop/);

  await ctx.request(`/api/windows/${id}`, { method: 'DELETE' });
});

test('widgets can be added, moved and removed', async () => {
  const added = await ctx.request('/api/widgets', { method: 'POST', body: { type: 'weather', x: 100, y: 100 } });
  assert.equal(added.json.type, 'weather');
  const patched = await ctx.request(`/api/widgets/${added.json.id}`, { method: 'PATCH', body: { x: 300, config: { city: 'Berlin' } } });
  assert.equal(patched.json.x, 300);
  assert.equal(patched.json.config.city, 'Berlin');
  const removed = await ctx.request(`/api/widgets/${added.json.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
});

test('media: playback, routing, mic, screenshot, webcam frames and recording', async () => {
  const media = await ctx.request('/api/media');
  assert.ok(media.json.sessions.length >= 1);

  const paused = await ctx.request('/api/media/control', { method: 'POST', body: { action: 'pause' } });
  assert.equal(paused.json.session.playing, false);
  const seek = await ctx.request('/api/media/control', { method: 'POST', body: { action: 'seek', value: 30 } });
  assert.equal(seek.json.session.position, 30);

  const routed = await ctx.request('/api/media/route', { method: 'POST', body: { output: 'headphones', volume: 40 } });
  assert.equal(routed.json.output, 'headphones');
  const badRoute = await ctx.request('/api/media/route', { method: 'POST', body: { output: 'toaster' } });
  assert.equal(badRoute.status, 400);

  const mic = await ctx.request('/api/media/mic', { method: 'POST', body: { enabled: true, gain: 80 } });
  assert.equal(mic.json.enabled, true);

  const cam = await ctx.request('/api/media/webcam', { method: 'POST', body: { enabled: true, fps: 24 } });
  assert.equal(cam.json.enabled, true);
  assert.match(cam.json.streamUrl, /webcam\/stream/);

  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const ingest = await ctx.request('/api/media/webcam/frame', {
    method: 'POST', body: frame, headers: { 'content-type': 'image/jpeg' },
  });
  assert.equal(ingest.status, 200);
  assert.equal(ingest.json.bytes, 4);

  const latest = await ctx.raw('/api/media/webcam/latest');
  assert.equal(latest.headers.get('content-type'), 'image/jpeg');

  const shot = await ctx.request('/api/capture/screenshot', { method: 'POST', body: { label: 'test' } });
  assert.match(shot.json.name, /^test_.*\.png$/);
  const png = await ctx.raw(shot.json.url);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), 'PNG');

  const started = await ctx.request('/api/capture/record/start', { method: 'POST', body: { mode: 'screen' } });
  assert.equal(started.json.active, true);
  const stopped = await ctx.request('/api/capture/record/stop', {
    method: 'POST', body: Buffer.from('fake-webm'), headers: { 'content-type': 'video/webm' },
  });
  assert.equal(stopped.json.size, 9);
  assert.match(stopped.json.name, /\.webm$/);

  const shots = await ctx.request('/api/capture/shots');
  assert.ok(shots.json.screenshots.length >= 1);
});

test('search finds apps, contacts, files and settings', async () => {
  const response = await ctx.request('/api/search?q=sp');
  assert.equal(response.status, 200);
  const types = response.json.groups.map((group) => group.type);
  assert.ok(types.includes('apps'));
  const settings = await ctx.request('/api/search?q=clipboard');
  assert.ok(settings.json.groups.some((group) => group.type === 'settings'));
});

test('openapi documents routes', async () => {
  const response = await ctx.request('/api/openapi.json', { token: null });
  assert.equal(response.status, 200);
  assert.equal(response.json.openapi, '3.1.0');
  assert.ok(response.json.paths['/api/clipboard']);
  assert.ok(response.json.paths['/api/windows/{id}/snap']);
  assert.equal(response.json.components.securitySchemes.bearerAuth.scheme, 'bearer');
});

test('static app serving works when configured', async () => {
  const other = await startBridge({ appDir: fileURLToPath(new URL('../../app', import.meta.url)) });
  try {
    const index = await fetch(`${other.bridge.url}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    const asset = await fetch(`${other.bridge.url}/assets/icons.svg`);
    assert.equal(asset.status, 200);
  } finally {
    await other.stop();
  }
});
