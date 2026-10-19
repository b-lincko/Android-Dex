import {
  copyText, el, esc, icon, openModal, selectControl, settingRow, switchControl, toast, toastError,
} from '../core.js';
import { LOCALES, getLocale, setLocale, t } from '../i18n.js';
import { act, button, card, noteBox, pageHead, refreshNote, settingLine } from './shared.js';

const SECTIONS = [
  ['appearance', 'palette', () => t('settings.appearance')],
  ['connection', 'wifi', () => t('settings.connection')],
  ['sync', 'refresh-cw', () => t('settings.sync')],
  ['notifications', 'bell', () => t('settings.notifications')],
  ['audio', 'volume-2', () => t('settings.audio')],
  ['keyboard', 'keyboard', () => t('settings.keyboard')],
  ['privacy', 'shield', () => t('settings.privacy')],
  ['updates', 'download', () => t('settings.updates')],
  ['about', 'info', () => t('settings.about')],
];

export function renderSettings(ctx) {
  const settings = ctx.state.settings;
  const section = ctx.viewState.settingsSection || 'appearance';
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Preferences',
    title: t('settings.title'),
    subtitle: t('settings.sub'),
    actions: [refreshNote(ctx)].filter(Boolean),
  }));

  const layout = el('div', { class: 'settings-layout' });
  const nav = el('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' });
  SECTIONS.forEach(([id, iconName, label]) => {
    const button = el('button', { class: `settings-nav-item ${section === id ? 'is-active' : ''}`, 'aria-current': section === id ? 'page' : 'false' });
    button.innerHTML = `${icon(iconName)}<span>${label()}</span>`;
    button.addEventListener('click', () => { ctx.setViewState({ settingsSection: id }); ctx.rerender(); });
    nav.append(button);
  });
  nav.append(el('div', { class: 'spacer' }));
  nav.append(button('Keyboard shortcuts', { iconName: 'command', className: 'btn btn-ghost btn-sm', onClick: () => ctx.openShortcuts() }));
  layout.append(nav);

  const main = el('div', { class: 'settings-section' });
  const render = {
    appearance: appearanceSection,
    connection: connectionSection,
    sync: syncSection,
    notifications: notificationSection,
    audio: audioSection,
    keyboard: keyboardSection,
    privacy: privacySection,
    updates: updateSection,
    about: aboutSection,
  }[section];
  main.append(render(ctx, settings));
  layout.append(main);
  page.append(layout);
  return page;
}

function appearanceSection(ctx, settings) {
  const wrap = el('div');
  wrap.append(card({
    iconName: 'palette', title: t('settings.appearance'),
    body: el('div', {},
      settingRow({
        title: t('settings.theme'), description: t('settings.themeDesc'),
        control: (() => {
          const group = el('div', { class: 'theme-swatches', role: 'radiogroup', 'aria-label': t('settings.theme') });
          [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']].forEach(([id, label]) => {
            const swatch = el('button', {
              class: `swatch ${id} ${settings.theme === id ? 'is-selected' : ''}`,
              role: 'radio', 'aria-checked': String(settings.theme === id), title: label,
            });
            swatch.innerHTML = `<span class="sw-preview"></span><span>${label}</span>`;
            swatch.addEventListener('click', () => ctx.saveSettings({ theme: id }));
            group.append(swatch);
          });
          return group;
        })(),
      }),
      settingRow({
        title: t('settings.contrast'), description: t('settings.contrastDesc'),
        control: switchControl(settings.highContrast, (value) => ctx.saveSettings({ highContrast: value }), t('settings.contrast')),
      }),
      settingRow({
        title: t('settings.dyslexia'), description: t('settings.dyslexiaDesc'),
        control: switchControl(settings.dyslexiaFont, (value) => ctx.saveSettings({ dyslexiaFont: value }), t('settings.dyslexia')),
      }),
      settingRow({
        title: t('settings.motion'), description: t('settings.motionDesc'),
        control: switchControl(settings.reducedMotion, (value) => ctx.saveSettings({ reducedMotion: value }), t('settings.motion')),
      }),
      settingRow({
        title: t('settings.scale'), description: 'Scales every panel without breaking the layout.',
        control: (() => {
          const group = el('div', { class: 'row' });
          const input = el('input', { type: 'range', min: '85', max: '125', step: '5', value: String(settings.uiScale || 100), class: 'seek', style: { width: '130px' }, 'aria-label': t('settings.scale') });
          const label = el('span', { class: 'mono-text tiny-text' }, `${settings.uiScale || 100}%`);
          input.addEventListener('input', () => { label.textContent = `${input.value}%`; });
          input.addEventListener('change', () => ctx.saveSettings({ uiScale: Number(input.value) }));
          group.append(input, label);
          return group;
        })(),
      }),
      settingRow({
        title: t('settings.density'), description: 'Comfortable or compact rows.',
        control: selectControl([{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], settings.density, (value) => ctx.saveSettings({ density: value })),
      }),
      settingRow({
        title: t('settings.language'), description: 'The interface and RTL layout update immediately.',
        control: (() => {
          const select = el('select', { class: 'select', 'aria-label': t('settings.language') });
          LOCALES.forEach((locale) => {
            const option = el('option', { value: locale.id }, locale.label);
            if (getLocale() === locale.id) option.selected = true;
            select.append(option);
          });
          select.addEventListener('change', () => {
            setLocale(select.value);
            ctx.saveSettings({ locale: select.value, rtl: select.value === 'ar' }).catch(() => {});
          });
          return select;
        })(),
      })),
  }));
  wrap.append(card({
    iconName: 'eye', title: 'Preview',
    body: (() => {
      const sample = el('div', { class: 'stack' });
      sample.innerHTML = `<div class="row wrap"><button class="btn btn-primary">Primary</button><button class="btn">Secondary</button><span class="pill ok">Healthy</span><span class="pill warn">LAN only</span></div>
        <p style="max-width:56ch">The quick brown fox jumps over the lazy dog. 0123456789 — interface scale, contrast and typography apply to every view instantly.</p>
        <div class="row"><span class="switch" aria-checked="true"></span><span class="switch"></span><span class="switch" aria-checked="true"></span></div>`;
      return sample;
    })(),
  }));
  return wrap;
}

function connectionSection(ctx, settings) {
  const state = ctx.state;
  const wrap = el('div');
  wrap.append(card({
    iconName: 'wifi', title: t('settings.connection'),
    subtitle: 'Encrypted pairing and transport recovery.',
    body: el('div', {},
      settingRow({ title: t('settings.autoReconnect'), description: t('settings.autoReconnectDesc'), control: switchControl(settings.autoReconnect, (value) => ctx.saveSettings({ autoReconnect: value })) }),
      settingRow({ title: t('settings.wakeOnConnect'), description: t('settings.wakeOnConnectDesc'), control: switchControl(settings.wakeOnConnect, (value) => ctx.saveSettings({ wakeOnConnect: value })) }),
      settingRow({ title: t('settings.encrypted'), description: t('settings.encryptedDesc'), control: switchControl(settings.encryptedWireless, (value) => ctx.saveSettings({ encryptedWireless: value })) }),
      settingRow({ title: t('settings.offline'), description: t('settings.offlineDesc'), control: switchControl(settings.offlineMode, (value) => ctx.saveSettings({ offlineMode: value })) }),
      settingRow({ title: t('settings.bandwidth'), description: t('settings.bandwidthDesc'), control: selectControl([
        { value: 'low', label: 'Low · 720p 30fps' }, { value: 'medium', label: 'Medium · 1080p 60fps' }, { value: 'high', label: 'High · native 120fps' },
      ], settings.bandwidth, (value) => ctx.saveSettings({ bandwidth: value })) }),
      settingRow({ title: t('settings.autoLaunch'), description: t('settings.autoLaunchDesc'), control: switchControl(settings.autoLaunch, (value) => ctx.saveSettings({ autoLaunch: value })) }),
      settingRow({ title: t('settings.idle'), description: t('settings.idleDesc'), control: switchControl(settings.idlePrevention, (value) => act(ctx, () => ctx.api.request('/api/system/keepawake', { method: 'POST', body: { enabled: value } }), { success: value ? 'Idle prevention on' : 'Idle prevention off' })) }),
      settingRow({
        title: t('settings.chargeLimit'), description: t('settings.chargeLimitDesc'),
        control: (() => {
          const wrapNode = el('div', { class: 'row' });
          const select = selectControl([{ value: '0', label: 'No limit' }, { value: '80', label: '80%' }, { value: '85', label: '85%' }, { value: '90', label: '90%' }], String(settings.chargeLimit || 0), (value) => act(ctx, () => ctx.api.request(`/api/devices/${ctx.device.id}/charge`, { method: 'POST', body: { enabled: true, limit: Number(value) } }), { success: 'Charge limit applied' }));
          wrapNode.append(select);
          return wrapNode;
        })(),
      })),
  }));

  const reconnect = state.reconnect || {};
  const info = card({
    iconName: 'refresh-cw', title: 'Reconnect state',
    body: (() => {
      const node = el('div', {});
      node.innerHTML = `<div class="row wrap" style="margin-bottom:8px">
        <span class="pill ${reconnect.state === 'connected' ? 'ok' : 'warn'}">${esc(reconnect.state || 'unknown')}</span>
        <span class="pill">attempt ${reconnect.attempt ?? 0}</span>
        <span class="pill">${reconnect.totalDrops ?? 0} drops</span>
        <span class="pill">health ${reconnect.healthScore ?? 100}%</span></div>
        <div class="tiny-text dim">Backoff: base ${settings.reconnectBackoff?.baseMs ?? 600} ms × ${settings.reconnectBackoff?.factor ?? 1.8}, capped at ${(settings.reconnectBackoff?.maxMs ?? 30000) / 1000}s with ±${Math.round((settings.reconnectBackoff?.jitter ?? 0.2) * 100)}% jitter.</div>`;
      node.append(el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button('Reconnect now', { iconName: 'zap', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/devices/reconnect', { method: 'POST', body: {} }), { success: 'Reconnect triggered' }) }),
        button('Simulate drop', { iconName: 'unplug', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/devices/drop', { method: 'POST', body: { reason: 'simulated from settings' } }), { success: 'Transport dropped' }) }),
        button('Backoff preview', { iconName: 'line-chart', className: 'btn btn-sm', onClick: () => previewBackoff(ctx) })));
      return node;
    })(),
  });
  wrap.append(info);
  return wrap;
}

async function previewBackoff(ctx) {
  try {
    const data = await ctx.api.request('/api/devices/reconnect/preview');
    const body = el('div');
    body.innerHTML = `<div class="tiny-text dim" style="margin-bottom:8px">Next retry delays with the current configuration:</div>
      <div class="macro-steps">${(data.schedule || []).map((ms, index) => `<span class="macro-step"><span class="step-n">${index + 1}</span>${(ms / 1000).toFixed(2)}s</span>`).join('')}</div>`;
    openModal({ title: 'Exponential backoff', subtitle: 'Jitter is applied per attempt.', body });
  } catch (error) { ctx.toastError(error); }
}

function syncSection(ctx, settings) {
  return card({
    iconName: 'refresh-cw', title: t('settings.sync'),
    subtitle: 'Everything is peer-to-peer over your LAN. There is no cloud account.',
    body: el('div', {},
      settingRow({ title: t('settings.clipboard'), description: t('settings.clipboardDesc'), control: switchControl(settings.clipboardSync, (value) => ctx.saveSettings({ clipboardSync: value })) }),
      settingRow({ title: t('clipboard.images'), description: 'Include images in the synced history.', control: switchControl(settings.clipboardImages, (value) => ctx.saveSettings({ clipboardImages: value })) }),
      settingRow({ title: t('settings.fileDrop'), description: t('settings.fileDropDesc'), control: switchControl(settings.fileDropEnabled, (value) => ctx.saveSettings({ fileDropEnabled: value })) }),
      settingRow({ title: t('settings.mount'), description: t('settings.mountDesc'), control: switchControl(settings.filesystemMount, (value) => ctx.saveSettings({ filesystemMount: value })) }),
      settingRow({ title: 'Profile cloud sync', description: 'Opt-in sync of game profiles to a self-hosted directory.', control: switchControl(settings.gameProfileCloudSync, (value) => ctx.saveSettings({ gameProfileCloudSync: value })) }),
      el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button('Open clipboard', { iconName: 'clipboard', className: 'btn btn-sm', onClick: () => ctx.navigate('clipboard') }),
        button('Browse share', { iconName: 'folder', className: 'btn btn-sm', onClick: () => ctx.navigate('files') }))),
  });
}

function notificationSection(ctx, settings) {
  return card({
    iconName: 'bell', title: t('settings.notifications'),
    body: el('div', {},
      settingRow({ title: t('notifications.mirror'), description: t('settings.mirrorDesc'), control: switchControl(settings.mirrorToOsNotificationCenter, (value) => ctx.saveSettings({ mirrorToOsNotificationCenter: value })) }),
      settingRow({ title: t('settings.inlineReply'), description: t('settings.inlineReplyDesc'), control: switchControl(settings.replyFromNotifications, (value) => ctx.saveSettings({ replyFromNotifications: value })) }),
      settingRow({ title: t('notifications.dnd'), description: 'Mirror the phone’s Do Not Disturb state.', control: switchControl(settings.dnd, (value) => act(ctx, () => ctx.api.request('/api/notifications/dnd', { method: 'POST', body: { enabled: value } }), { success: value ? 'DND on' : 'DND off' })) }),
      settingRow({ title: t('settings.biometric'), description: t('settings.biometricDesc'), control: switchControl(settings.biometricForwarding, (value) => ctx.saveSettings({ biometricForwarding: value })) }),
      el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button('Send test notification', { iconName: 'bell-ring', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/notifications/test', { method: 'POST', body: { app: 'Settings', title: 'Test notification', body: 'Desktop mirroring works.', icon: 'bell', color: '#8a8f98' } }), { success: 'Test sent' }) }),
        button('Manage quick tiles', { iconName: 'sliders-horizontal', className: 'btn btn-sm', onClick: () => ctx.navigate('notifications') }))),
  });
}

function audioSection(ctx, settings) {
  const media = ctx.state.media;
  return card({
    iconName: 'volume-2', title: t('settings.audio'),
    body: el('div', {},
      settingRow({ title: t('settings.audioOutput'), description: 'Where Android audio is rendered.', control: selectControl([{ value: 'desktop', label: 'Desktop speakers' }, { value: 'headphones', label: 'Headphones' }, { value: 'android', label: 'Phone speaker' }, { value: 'hdmi', label: 'HDMI' }], media.output, (value) => act(ctx, () => ctx.api.request('/api/media/route', { method: 'POST', body: { output: value } }), { success: 'Audio route updated' })) }),
      settingRow({ title: t('settings.mic'), description: 'Forward the desktop microphone into Android.', control: switchControl(settings.micPassthrough, (value) => act(ctx, () => ctx.api.request('/api/media/mic', { method: 'POST', body: { enabled: value } }), { success: value ? 'Mic on' : 'Mic off' })) }),
      settingRow({ title: t('settings.camera'), description: 'Expose the phone camera as an MJPEG webcam.', control: switchControl(settings.virtualCamera, (value) => act(ctx, () => ctx.api.request('/api/media/webcam', { method: 'POST', body: { enabled: value } }), { success: value ? 'Virtual camera on' : 'Virtual camera off' })) }),
      settingRow({ title: 'Gamepad passthrough', description: 'Translate controller input into Android touches.', control: switchControl(settings.gamepadPassthrough, (value) => ctx.saveSettings({ gamepadPassthrough: value })) }),
      settingRow({ title: 'Stylus pressure', description: 'Forward pressure and tilt events.', control: switchControl(settings.stylusPressure, (value) => ctx.saveSettings({ stylusPressure: value })) }),
      el('div', { class: 'row wrap', style: { marginTop: '10px' } }, button('Open media & IO', { iconName: 'monitor-speaker', className: 'btn btn-sm', onClick: () => ctx.navigate('media') }))),
  });
}

function keyboardSection(ctx, settings) {
  const hotkeys = settings.hotkeys || {};
  const wrap = el('div');
  wrap.append(card({
    iconName: 'keyboard', title: t('settings.keyboard'), subtitle: t('settings.hotkeyHint'),
    body: el('div', { id: 'hotkey-list' }),
  }));
  const list = wrap.querySelector('#hotkey-list');
  Object.entries(hotkeys).slice(0, 40).forEach(([action, accelerator]) => {
    const row = el('div', { class: 'hotkey-row' });
    row.innerHTML = `<span class="row">${icon('command')} <span>${esc(action)}</span></span>
      <span class="row"><kbd>${esc(accelerator)}</kbd><button class="btn btn-sm" aria-label="Rebind ${esc(action)}">${t('gaming.bind')}</button></span>`;
    row.querySelector('button').addEventListener('click', () => rebindHotkey(ctx, action, accelerator));
    list.append(row);
  });
  if (!Object.keys(hotkeys).length) list.append(el('div', { class: 'dim tiny-text' }, 'No hotkeys configured.'));
  wrap.append(noteBox('info', 'Hotkeys fire system-wide when the desktop client is running. Browser shortcuts still take priority inside this console.'));
  return wrap;
}

function rebindHotkey(ctx, action, current) {
  const body = el('div', { class: 'stack' });
  const display = el('div', { class: 'pair-code' }, current);
  const hint = el('p', { class: 'dim', style: { textAlign: 'center' } }, 'Press a new combination, or Esc to cancel.');
  body.append(display, hint);
  const modal = openModal({ title: `Rebind ${action}`, body, small: true });
  function onKey(event) {
    if (event.key === 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    const accelerator = parts.join('+');
    display.textContent = accelerator;
    document.removeEventListener('keydown', onKey, true);
    ctx.api.request('/api/hotkeys', { method: 'PATCH', body: { action, accelerator } })
      .then(async () => {
        modal.close();
        if (ctx.state.settings.hotkeys) ctx.state.settings.hotkeys[action] = accelerator;
        toast(`${action} → ${accelerator}`);
        ctx.rerender();
      })
      .catch((error) => { ctx.toastError(error); document.addEventListener('keydown', onKey, true); });
  }
  setTimeout(() => document.addEventListener('keydown', onKey, true), 40);
}

function privacySection(ctx, settings) {
  const state = ctx.state;
  return card({
    iconName: 'shield', title: t('settings.privacy'),
    subtitle: 'Local by default: no telemetry, no accounts, no external calls.',
    body: el('div', {},
      settingRow({ title: t('settings.crash'), description: t('settings.crashDesc'), control: switchControl(settings.crashReporting, (value) => act(ctx, () => ctx.api.request('/api/diagnostics/crash-reports', { method: 'POST', body: { enabled: value } }), { success: value ? 'Local crash bundles enabled' : 'Crash reporting off' })) }),
      settingRow({ title: t('settings.telemetry'), description: t('settings.telemetryDesc'), control: (() => { const node = el('button', { class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', disabled: true, 'aria-label': 'Telemetry is always off' }); return node; })() }),
      settingRow({ title: 'Paired fingerprints', description: `${state.security?.pairedFingerprints?.length || 0} device(s) pinned. A changed fingerprint is rejected until you re-trust it.`, control: button('Manage', { iconName: 'fingerprint', className: 'btn btn-sm', onClick: () => manageFingerprints(ctx) }) }),
      settingRow({ title: 'Pairing token', description: 'Required for every API and WebSocket connection.', control: el('span', { class: 'pill' }, 'required') }),
      el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button('View audit log', { iconName: 'scroll-text', className: 'btn btn-sm', onClick: () => showAudit(ctx) }),
        button('Purge crash bundles', { iconName: 'trash-2', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/diagnostics/crashes', { method: 'DELETE' }), { success: 'Crash bundles purged' }) }))),
  });
}

async function manageFingerprints(ctx) {
  const state = ctx.state;
  const body = el('div', { class: 'stack' });
  (state.security?.pairedFingerprints || []).forEach((entry) => {
    const row = el('div', { class: 'setting-line' });
    row.innerHTML = `<div class="sl-body"><div class="sl-title">${esc(entry.deviceId)}</div><div class="sl-desc mono-text">${esc(entry.fingerprint)}</div></div>`;
    row.append(button('Revoke', {
      iconName: 'trash-2', className: 'btn btn-danger btn-sm',
      onClick: async () => {
        try {
          await ctx.api.request(`/api/pair/${entry.deviceId}`, { method: 'DELETE' });
          row.remove();
          await ctx.api.refresh(); ctx.rerender();
          toast('Fingerprint revoked');
        } catch (error) { ctx.toastError(error); }
      },
    }));
    body.append(row);
  });
  if (!(state.security?.pairedFingerprints || []).length) body.append(el('p', { class: 'dim' }, 'No paired devices.'));
  openModal({ title: 'Paired fingerprints', subtitle: 'Trust-on-first-use, pinned forever until revoked.', body, wide: true });
}

async function showAudit(ctx) {
  const state = ctx.state;
  const body = el('div', { class: 'stack' });
  (state.security?.audit || []).slice(-40).reverse().forEach((entry) => {
    const row = el('div', { class: 'log-line' });
    row.innerHTML = `<span class="dim tiny-text">${esc(entry.ts)}</span> <span class="pill ${entry.severity === 'warn' ? 'warn' : ''}">${esc(entry.event)}</span> <span class="tiny-text">${esc(entry.detail || '')}</span>`;
    body.append(row);
  });
  if (!(state.security?.audit || []).length) body.append(el('p', { class: 'dim' }, 'No audit entries yet.'));
  openModal({ title: 'Security audit log', subtitle: 'Stored locally in the bridge data directory.', body, wide: true });
}

function updateSection(ctx, settings) {
  const updates = ctx.state.updates || {};
  const wrap = el('div');
  wrap.append(card({
    iconName: 'download', title: t('settings.updates'),
    subtitle: `Installed ${updates.installed || '—'} · latest ${updates.latest || '—'}`,
    body: (() => {
      const body = el('div', {});
      body.append(settingRow({ title: t('settings.updateChannel'), description: 'Stable is tested; beta gets features early.', control: selectControl([{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }, { value: 'nightly', label: 'Nightly' }], updates.channel || settings.updateChannel, (value) => act(ctx, () => ctx.api.request('/api/updates/channel', { method: 'PATCH', body: { channel: value } }), { success: `Channel: ${value}` })) }));
      body.append(settingRow({ title: t('settings.autoUpdate'), description: t('settings.autoUpdateDesc'), control: switchControl(settings.autoUpdate, (value) => ctx.saveSettings({ autoUpdate: value })) }));
      const status = el('div', { class: 'stack tiny-text', style: { margin: '10px 0' } });
      status.innerHTML = `<div class="row wrap"><span class="pill ${updates.available ? 'warn' : 'ok'}">${updates.available ? `Update ${esc(updates.latest)} available` : 'Up to date'}</span>
        <span class="pill">${esc(updates.notes || '')}</span></div>
        ${updates.sha256 ? `<div class="mono-text dim">sha256 ${esc(updates.sha256)}</div>` : ''}
        ${updates.signature ? `<div class="mono-text dim">GPG ${esc(String(updates.signature).slice(0, 60))}…</div>` : ''}`;
      body.append(status);
      body.append(el('div', { class: 'row wrap' },
        button('Check now', { iconName: 'refresh-cw', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/updates/check', { method: 'POST', body: {} }), { success: 'Checked for updates' }) }),
        button('Download & stage', { iconName: 'download', className: 'btn btn-primary btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/updates/apply', { method: 'POST', body: {} }), { success: 'Update verified and staged' }) }),
        button('Release notes', { iconName: 'external-link', className: 'btn btn-sm', onClick: () => window.open(updates.downloadUrl || 'https://github.com/Shrey113/Android-Dex/releases/latest', '_blank', 'noopener') })));
      return body;
    })(),
  }));
  wrap.append(noteBox('shield-check', 'Updates are SHA256 + GPG verified before staging. Nightly builds are unsigned and must be enabled explicitly.'));
  return wrap;
}

function aboutSection(ctx, settings) {
  const state = ctx.state;
  const bridge = ctx.api.baseUrl || (ctx.mode() === 'demo' ? 'demo (no bridge)' : location.origin);
  const wrap = el('div');
  wrap.append(card({
    iconName: 'info', title: 'Android DEX',
    subtitle: `Console ${state.bridge?.version || state.version || '2.0.0'} · ${ctx.mode() === 'live' ? 'live bridge' : 'demo mode'}`,
    body: (() => {
      const body = el('div', {});
      const rows = [
        [t('settings.endpoint'), bridge],
        ['Bridge version', state.bridge?.version || '—'],
        ['Android', `${ctx.device?.model || '—'} · Android ${ctx.device?.android || '—'}`],
        ['Transport', `${ctx.device?.transport || '—'} · ${ctx.device?.ip || ''}`],
        ['Battery', ctx.device ? `${Math.round(ctx.device.battery?.level || 0)}% ${ctx.device.battery?.charging ? 'charging' : ''}` : '—'],
        ['Node', state.bridge?.node || '—'],
        ['Data directory', state.bridge?.dataDir || '—'],
      ];
      rows.forEach(([label, value]) => body.append(settingLine(label, '', el('span', { class: 'mono-text tiny-text' }, String(value)))));
      body.append(el('div', { class: 'row wrap', style: { marginTop: '12px' } },
        button('Documentation', { iconName: 'book-open', className: 'btn btn-sm', onClick: () => window.open('https://github.com/Shrey113/Android-Dex#readme', '_blank', 'noopener') }),
        button('Report an issue', { iconName: 'bug', className: 'btn btn-sm', onClick: () => window.open('https://github.com/Shrey113/Android-Dex/issues', '_blank', 'noopener') }),
        button('Licences', { iconName: 'scale', className: 'btn btn-sm', onClick: () => openModal({ title: 'Licences', body: el('pre', { class: 'code' }, 'Android DEX is MIT licensed.\nIcons: Lucide (ISC).\nQR encoder: qrcode-generator (MIT).\nscrcpy: Apache-2.0.\nSee NOTICE for the full list.'), wide: true }) }),
        button('Keyboard shortcuts', { iconName: 'command', className: 'btn btn-sm', onClick: () => ctx.openShortcuts() })));
      body.append(el('div', { class: 'row wrap', style: { marginTop: '12px' } },
        button(ctx.mode() === 'demo' ? 'Start the bridge' : 'Disconnect bridge', {
          iconName: ctx.mode() === 'demo' ? 'server' : 'unplug',
          className: 'btn btn-sm',
          onClick: () => ctx.openPairing(),
        }),
        ctx.mode() === 'demo' ? button('Factory-reset demo data', {
          iconName: 'rotate-ccw', className: 'btn btn-danger btn-sm',
          onClick: async () => {
            if (!(await ctx.confirmDialog({ title: 'Reset demo data?', message: 'Restores the bundled demo snapshot and clears local changes.', confirmLabel: 'Reset', danger: true }))) return;
            await ctx.api.request('/api/demo/reset').catch(() => {});
            if (ctx.api.resetDemo) ctx.api.resetDemo();
            await ctx.api.refresh().catch(() => {});
            ctx.rerender();
            toast('Demo data reset');
          },
        }) : null));
      return body;
    })(),
  }));
  wrap.append(card({
    iconName: 'scale', title: 'Trust & transparency',
    body: el('div', { class: 'stack tiny-text' },
      el('div', { class: 'row' }, icon('shield-check'), el('span', {}, 'Reproducible builds, SHA256SUMS and GPG signatures ship with every release.')),
      el('div', { class: 'row' }, icon('file-text'), el('span', {}, 'SPDX SBOM lists every bundled binary and licence.')),
      el('div', { class: 'row' }, icon('bug'), el('span', {}, 'Crash reporting is opt-in and local only; nothing leaves this machine.')),
      el('div', { class: 'row' }, icon('code-2'), el('span', {}, 'The companion protocol and REST schema are public in the developer view.'))),
  }));
  return wrap;
}
