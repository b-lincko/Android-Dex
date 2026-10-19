import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startBridge } from './helpers.js';

let ctx;
before(async () => { ctx = await startBridge(); });
after(async () => { await ctx.stop(); });

test('telephony: conversations, SMS, calls, DTMF and contacts', async () => {
  const conversations = await ctx.request('/api/telephony/conversations');
  assert.ok(conversations.json.conversations.length >= 4);
  assert.equal(conversations.json.conversations[0].pinned, true);

  const first = conversations.json.conversations[0];
  const read = await ctx.request(`/api/telephony/conversations/${first.id}`);
  assert.equal(read.json.unread, 0);

  const sent = await ctx.request('/api/telephony/messages', { method: 'POST', body: { conversationId: first.id, text: 'Sent from the CLI test' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.message.from, 'me');
  assert.equal(sent.json.message.status, 'sending');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const refreshed = await ctx.request(`/api/telephony/conversations/${first.id}`);
  assert.equal(refreshed.json.messages.at(-1).status, 'delivered');

  const toNew = await ctx.request('/api/telephony/messages', { method: 'POST', body: { number: '+15551230000', text: 'New thread' } });
  assert.equal(toNew.status, 200);
  assert.ok(toNew.json.conversationId);

  const contacts = await ctx.request('/api/telephony/contacts');
  const contact = contacts.json.contacts[0];
  const called = await ctx.request('/api/telephony/calls', { method: 'POST', body: { contactId: contact.id } });
  assert.equal(called.status, 200);
  const callId = called.json.id;
  const duplicate = await ctx.request('/api/telephony/calls', { method: 'POST', body: { contactId: contact.id } });
  assert.equal(duplicate.status, 400);

  const answered = await ctx.request(`/api/telephony/calls/${callId}/answer`, { method: 'POST', body: {} });
  assert.equal(answered.json.status, 'active');
  const dtmf = await ctx.request(`/api/telephony/calls/${callId}/dtmf`, { method: 'POST', body: { digits: '42#' } });
  assert.equal(dtmf.json.dtmf, '42#');
  const muted = await ctx.request(`/api/telephony/calls/${callId}/mute`, { method: 'POST', body: { muted: true } });
  assert.equal(muted.json.muted, true);
  const ended = await ctx.request(`/api/telephony/calls/${callId}/hangup`, { method: 'POST', body: {} });
  assert.equal(ended.json.status, 'ended');
});

test('notifications: inline reply, DND sync, mirror status', async () => {
  const list = await ctx.request('/api/notifications');
  assert.ok(list.json.notifications.length >= 4);
  assert.equal(typeof list.json.mirror.available, 'boolean');

  const replyTarget = list.json.notifications.find((item) => item.actions.some((action) => action.reply));
  assert.ok(replyTarget, 'expected a notification with reply action');
  const replied = await ctx.request(`/api/notifications/${replyTarget.id}/action`, {
    method: 'POST', body: { actionId: 'reply', payload: { text: 'Replying inline from the console' } },
  });
  assert.equal(replied.status, 200);
  assert.ok(replied.json.conversationId);
  const conversation = await ctx.request(`/api/telephony/conversations/${replied.json.conversationId}`);
  assert.equal(conversation.json.messages.at(-1).text, 'Replying inline from the console');

  const noText = await ctx.request(`/api/notifications/${replyTarget.id}/action`, { method: 'POST', body: { actionId: 'reply', payload: {} } });
  assert.equal(noText.status, 400);

  const dnd = await ctx.request('/api/notifications/dnd', { method: 'POST', body: { enabled: true } });
  assert.equal(dnd.json.dnd, true);
  const settings = await ctx.request('/api/settings');
  assert.equal(settings.json.dnd, true);
  const tile = (await ctx.request('/api/system/tiles')).json.tiles.find((item) => item.id === 'dnd');
  assert.equal(tile.enabled, true);
  await ctx.request('/api/notifications/dnd', { method: 'POST', body: { enabled: false } });

  const testNote = await ctx.request('/api/notifications/test', { method: 'POST', body: { app: 'CI', title: 'Test', body: 'Hello' } });
  assert.equal(testNote.json.app, 'CI');
  await ctx.request('/api/notifications/read-all', { method: 'POST', body: {} });
});

test('system: tiles, airplane cascade, hotspot, lock/unlock, charge throttle', async () => {
  const tiles = await ctx.request('/api/system/tiles');
  assert.equal(tiles.json.tiles.length, 8);

  const airplane = await ctx.request('/api/system/tiles/airplane/toggle', { method: 'POST', body: { enabled: true } });
  assert.equal(airplane.json.enabled, true);
  const after = await ctx.request('/api/system/tiles');
  assert.equal(after.json.tiles.find((item) => item.id === 'wifi').enabled, false);
  assert.equal(after.json.tiles.find((item) => item.id === 'cellular').enabled, false);
  await ctx.request('/api/system/tiles/airplane/toggle', { method: 'POST', body: { enabled: false } });

  const hotspot = await ctx.request('/api/system/hotspot', { method: 'POST', body: { enabled: true, ssid: 'DEX-Test', band: '5GHz' } });
  assert.equal(hotspot.json.enabled, true);
  assert.match(hotspot.json.detail, /DEX-Test/);

  const locked = await ctx.request('/api/system/lock', { method: 'POST', body: { reason: 'test' } });
  assert.equal(locked.json.locked, true);
  assert.ok(locked.json.challenge.id);
  const denied = await ctx.request('/api/system/biometric', { method: 'POST', body: { challengeId: locked.json.challenge.id, success: false } });
  assert.equal(denied.json.unlocked, false);

  const relocked = await ctx.request('/api/system/lock', { method: 'POST', body: {} });
  const unlocked = await ctx.request('/api/system/biometric', { method: 'POST', body: { challengeId: relocked.json.challenge.id, success: true } });
  assert.equal(unlocked.json.unlocked, true);

  const throttle = await ctx.request('/api/devices/dev_pixel8pro/charge', { method: 'POST', body: { enabled: true, limit: 75 } });
  assert.equal(throttle.json.limit, 75);
  const keep = await ctx.request('/api/system/keepawake', { method: 'POST', body: { enabled: true } });
  assert.equal(keep.json.idlePrevention, true);
});

test('gaming: profiles, bindings, sensitivity gate, macros, sharing and catalog', async () => {
  const created = await ctx.request('/api/gaming/profiles', {
    method: 'POST',
    body: {
      name: 'Test layout', game: 'Test Game',
      controls: [{ type: 'tap', key: 'F', x: 0.5, y: 0.5, label: 'Fire' }],
      sensitivity: { deadzone: 0.1 },
    },
  });
  assert.equal(created.status, 200);
  const id = created.json.id;

  const invalid = await ctx.request('/api/gaming/profiles', { method: 'POST', body: { name: 'Bad', controls: [{ type: 'magic', key: 'A', x: 0, y: 0 }] } });
  assert.equal(invalid.status, 400);

  const control = created.json.controls[0];
  const bound = await ctx.request(`/api/gaming/profiles/${id}/bind`, { method: 'POST', body: { controlId: control.id, key: 'G' } });
  assert.equal(bound.json.key, 'G');

  const gated = await ctx.request(`/api/gaming/profiles/${id}/sensitivity`, { method: 'POST', body: { aimAssist: true } });
  assert.equal(gated.status, 428);
  assert.equal(gated.json.error.code, 'fairplay_ack_required');

  const ack = await ctx.request('/api/gaming/fairplay/ack', { method: 'POST', body: {} });
  assert.equal(ack.json.acknowledged, true);
  const sensitivity = await ctx.request(`/api/gaming/profiles/${id}/sensitivity`, { method: 'POST', body: { xCurve: 0.7, deadzone: 0.12, aimAssist: true } });
  assert.equal(sensitivity.json.aimAssist, true);
  assert.equal(sensitivity.json.deadzone, 0.12);

  const macro = await ctx.request(`/api/gaming/profiles/${id}/macros`, {
    method: 'POST',
    body: { name: 'Combo', steps: [{ type: 'tap', x: 0.2, y: 0.3, delayMs: 0 }, { type: 'swipe', x: 0.4, y: 0.5, x2: 0.6, y2: 0.7, delayMs: 120 }] },
  });
  assert.equal(macro.json.steps.length, 2);
  const edited = await ctx.request(`/api/gaming/profiles/${id}/macros/${macro.json.id}`, { method: 'PATCH', body: { name: 'Combo v2', steps: [{ type: 'tap', x: 0.9, y: 0.9, delayMs: 50 }] } });
  assert.equal(edited.json.name, 'Combo v2');

  const recorded = await ctx.request(`/api/gaming/profiles/${id}/macros/record`, {
    method: 'POST', body: { name: 'Recorded', events: [{ type: 'tap', x: 0.1, y: 0.2, t: 0 }, { type: 'tap', x: 0.3, y: 0.4, t: 250 }] },
  });
  assert.equal(recorded.json.steps[1].delayMs, 250);

  const mapping = await ctx.request(`/api/gaming/profiles/${id}/controller`, { method: 'POST', body: { buttonA: { action: 'tap', x: 0.8, y: 0.9 } } });
  assert.equal(mapping.json.buttonA.action, 'tap');

  const exported = await ctx.request(`/api/gaming/profiles/${id}/export`);
  assert.match(exported.json.shareCode, /^dexgame:/);
  const imported = await ctx.request('/api/gaming/import', { method: 'POST', body: { code: exported.json.shareCode } });
  assert.equal(imported.status, 200);
  assert.match(imported.json.name, /Test layout/);

  const tampered = exported.json.shareCode.slice(0, -2) + 'zz';
  const rejected = await ctx.request('/api/gaming/import', { method: 'POST', body: { code: tampered } });
  assert.equal(rejected.status, 400);

  const published = await ctx.request(`/api/gaming/profiles/${id}/publish`, { method: 'POST', body: {} });
  assert.equal(published.json.sharing, 'community');
  const catalog = await ctx.request('/api/gaming/marketplace');
  assert.ok(catalog.json.local.some((entry) => entry.profileId === id));
  assert.ok(catalog.json.curated.length >= 3);

  const syncDisabled = await ctx.request(`/api/gaming/profiles/${id}/sync`, { method: 'POST', body: {} });
  assert.equal(syncDisabled.status, 409);
  await ctx.request('/api/settings', { method: 'PATCH', body: { gameProfileCloudSync: true } });
  const synced = await ctx.request(`/api/gaming/profiles/${id}/sync`, { method: 'POST', body: {} });
  assert.equal(synced.json.synced, true);
});

test('plugins: discovery, enable, hook invocation, disable', async () => {
  const scanned = await ctx.request('/api/plugins/scan', { method: 'POST', body: {} });
  const plugin = scanned.json.find((item) => item.id === 'speaker-notes');
  assert.ok(plugin, 'speaker-notes plugin should be discovered');
  assert.ok(plugin.permissions.includes('clipboard:read'));

  const enabled = await ctx.request('/api/plugins/speaker-notes', { method: 'PATCH', body: { enabled: true } });
  assert.equal(enabled.json.enabled, true);
  assert.equal(enabled.json.loaded, true);

  const hook = await ctx.request('/api/plugins/speaker-notes/hooks/clipboard.changed', { method: 'POST', body: { kind: 'text', text: 'note' } });
  assert.equal(hook.json.ok, true);

  const disabled = await ctx.request('/api/plugins/speaker-notes', { method: 'PATCH', body: { enabled: false } });
  assert.equal(disabled.json.loaded, false);
});

test('updates: channels, check and verify', async () => {
  const state = await ctx.request('/api/updates');
  assert.equal(state.json.installed, '2.0.0');
  const channels = await ctx.request('/api/updates/channels');
  const names = channels.json.channels.map((channel) => channel.channel);
  assert.deepEqual(names.sort(), ['beta', 'nightly', 'stable']);

  const stable = await ctx.request('/api/updates/check', { method: 'POST', body: {} });
  assert.equal(stable.json.available, false);

  const beta = await ctx.request('/api/updates/channel', { method: 'PATCH', body: { channel: 'beta' } });
  assert.equal(beta.json.available, true);
  assert.match(beta.json.latest, /^2\.1\.0/);

  const applied = await ctx.request('/api/updates/apply', { method: 'POST', body: {} });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.restartRequired, true);
  await ctx.request('/api/updates/channel', { method: 'PATCH', body: { channel: 'stable' } });
});

test('diagnostics: summary, opt-in crash bundles, compatibility and benchmark', async () => {
  const summary = await ctx.request('/api/diagnostics');
  assert.equal(summary.json.crashReporting, false);
  assert.ok(summary.json.metrics.httpRequests > 0);

  const rejected = await ctx.request('/api/diagnostics/crashes', { method: 'POST', body: { message: 'boom' } });
  assert.equal(rejected.json.accepted, false);

  const enabled = await ctx.request('/api/diagnostics/crash-reports', { method: 'POST', body: { enabled: true } });
  assert.equal(enabled.json.crashReporting, true);
  assert.equal(enabled.json.upload, false);

  const stored = await ctx.request('/api/diagnostics/crashes', { method: 'POST', body: { message: 'boom', stack: 'at test', context: { route: '/x' } } });
  assert.equal(stored.json.accepted, true);
  assert.equal(stored.json.storedLocally, true);

  const crashes = await ctx.request('/api/diagnostics/crashes');
  assert.ok(crashes.json.entries.length >= 1);
  const purged = await ctx.request('/api/diagnostics/crashes', { method: 'DELETE' });
  assert.equal(purged.json.ok, true);

  const compatibility = await ctx.request('/api/diagnostics/compatibility');
  assert.ok(compatibility.json.tiers.length >= 3);
  assert.ok(compatibility.json.oem.some((item) => /One UI/.test(item.oem)));

  const bench = await ctx.request('/api/diagnostics/benchmark', { method: 'POST', body: {} });
  assert.ok(bench.json.results.jsonStringifyPerOpUs > 0);
  assert.ok(bench.json.results.eventBusP95Us >= 0);

  const sbom = await ctx.request('/api/diagnostics/sbom');
  assert.equal(typeof sbom.json.available, 'boolean');
  const logs = await ctx.request('/api/diagnostics/logs?count=20');
  assert.ok(Array.isArray(logs.json.entries));
});
