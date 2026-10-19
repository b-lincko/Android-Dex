/**
 * Console shell: chrome, routing, desktop window manager, command palette,
 * pairing/QR, biometric unlock and accessibility overlays.
 */
import {
  $, $$, applyPreferences, bus, clamp, copyText, debounce, downloadText, el, emptyState, esc,
  fmtBytes, fmtDuration, fmtRelative, fmtTime, hydrateIcons, icon, initShortcuts, makeSvgPlaceholder,
  openModal, closeAllModals, promptDialog, registerShortcut, relativeClock, setShortcutMap,
  toast, toastError, confirmDialog, storage,
} from './core.js';
import { getLocale, localeMeta, t } from './i18n.js';
import { renderPanel } from './panels.js';

const VIEWS = ['desktop', 'apps', 'phone', 'files', 'clipboard', 'notifications', 'media', 'gaming', 'developer', 'settings'];

export const app = {
  api: null,
  view: 'desktop',
  state: null,
  viewState: {},
  renderQueued: false,
  desktop: { dragging: null, scaleHint: null },
};

export const ctx = {
  get api() { return app.api; },
  get state() { return app.state; },
  get settings() { return app.state?.settings || {}; },
  get device() { return app.api?.device; },
  get viewState() { return app.viewState; },
  setViewState(patch) { Object.assign(app.viewState, patch); },
  navigate,
  rerender: () => renderView(),
  refreshChrome,
  saveSettings,
  openModal,
  confirmDialog,
  promptDialog,
  toast,
  toastError,
  copyText,
  openPairing,
  openLock,
  openDeviceMenu,
  openShortcuts,
  openPalette,
  downloadUrl: (path) => app.api.downloadUrl(path),
  mediaLatestUrl: () => app.api.mediaLatestUrl(),
  mode: () => app.api.mode,
};

function state() { return app.api?.state || app.state; }

export async function startShell(api) {
  app.api = api;
  app.state = api.state;
  api.on('state', (next) => {
    app.state = next;
    renderChrome();
    scheduleRender();
  });
  api.on('settings.changed', (settings) => {
    app.state.settings = { ...app.state.settings, ...settings };
    applyPreferences(app.state.settings);
    renderChrome();
    scheduleRender();
  });
  api.on('theme.changed', () => renderChrome());
  api.on('auth.required', () => openAuthDialog());
  api.on('socket.state', () => renderChrome());
  api.on('metrics', () => renderChrome());
  api.on('telemetry', () => renderChrome());
  api.on('notification.received', () => { renderChrome(); scheduleRender(); });
  api.on('system.locked', () => openLock(true));
  api.on('pairing.completed', () => { closeAllModals(); toast(t('toast.paired')); });
  api.on('shortcuts:open', openShortcuts);
  api.on('palette:open', openPalette);

  applyPreferences(state().settings);
  wireChrome();
  initShortcuts();
  refreshShortcutMap();
  registerShortcuts();
  navigate(initialView(), { replace: true, silent: true });
  renderView();
  renderChrome();
  setInterval(renderClock, 20000);
  setInterval(() => { if (app.view === 'desktop') refreshWidgets(); }, 30000);
  document.title = `Android DEX — ${app.api.mode === 'demo' ? 'Demo' : 'Live'} console`;
}

function initialView() {
  const hash = location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(hash) ? hash : 'desktop';
}

function refreshShortcutMap() {
  setShortcutMap(state()?.settings?.hotkeys || {});
}

function registerShortcuts() {
  registerShortcut('search', () => openPalette());
  registerShortcut('clipboard', () => navigate('clipboard'));
  registerShortcut('screenshot', () => captureScreenshot());
  registerShortcut('record', () => toggleRecording());
  registerShortcut('lock', () => openLock());
  registerShortcut('deviceSwitcher', () => openDeviceMenu());
  registerShortcut('pip', () => focusWindowAction((win) => patchWindow(win.id, { pip: !win.pip })));
  registerShortcut('alwaysOnTop', () => focusWindowAction((win) => patchWindow(win.id, { alwaysOnTop: !win.alwaysOnTop })));
  registerShortcut('fullscreen', toggleFullscreen);
  registerShortcut('toggleUi', () => toast('The host hotkey is handled by the desktop client.', { type: 'info' }));
  document.addEventListener('keydown', (event) => {
    if (event.altKey && /^Digit[1-9]$/.test(event.code) && !event.ctrlKey && !event.metaKey) {
      const index = Number(event.code.slice(5)) - 1;
      if (VIEWS[index]) { event.preventDefault(); navigate(VIEWS[index]); }
    }
    if (event.altKey && event.code === 'Digit0') { event.preventDefault(); navigate('settings'); }
  });
}

function visibleWindows() {
  return [...(state()?.windows || [])].sort((a, b) => a.z - b.z);
}

function focusedWindow() {
  return visibleWindows().filter((win) => !win.minimized).at(-1) || null;
}

function focusWindowAction(fn) {
  const win = focusedWindow();
  if (!win) { toast('No window is focused.', { type: 'warn' }); return; }
  Promise.resolve(fn(win)).catch(toastError);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { toastError(error); }
}

export function navigate(view, { replace = false, silent = false } = {}) {
  if (!VIEWS.includes(view)) view = 'desktop';
  app.view = view;
  $$('.rail-btn').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (replace) history.replaceState(null, '', `#/${view}`);
  else if (location.hash !== `#/${view}`) history.pushState(null, '', `#/${view}`);
  if (!silent) renderView();
  $('#view')?.focus({ preventScroll: true });
}

export function scheduleRender() {
  if (app.renderQueued) return;
  app.renderQueued = true;
  requestAnimationFrame(() => {
    app.renderQueued = false;
    const active = document.activeElement;
    const typing = active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
    if (typing) return;
    renderView();
  });
}

export function renderView() {
  const workspace = $('#view');
  if (!workspace) return;
  const previousScroll = workspace.scrollTop;
  workspace.innerHTML = '';
  if (app.view === 'desktop') {
    workspace.append(renderDesktop());
  } else {
    const node = renderPanel(app.view, ctx);
    workspace.append(node);
  }
  hydrateIcons(workspace);
  applyPreferences(state()?.settings || {});
  workspace.scrollTop = previousScroll;
}

function refreshChrome() {
  renderChrome();
  renderClock();
}

function renderClock() {
  const clock = $('#status-clock');
  if (clock) clock.textContent = relativeClock();
  $$('.tb-clock').forEach((node) => {
    node.innerHTML = `<b>${relativeClock()}</b><span>${new Date().toLocaleDateString(getLocale(), { weekday: 'short', day: '2-digit', month: 'short' })}</span>`;
  });
  $$('.widget-clock').forEach((node) => {
    const time = node.querySelector('.time');
    const date = node.querySelector('.date');
    if (time) time.textContent = new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: !(node.dataset.format24 === 'true') });
    if (date) date.textContent = new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  });
}

function refreshWidgets() {
  const battery = $('#widget-battery-pct');
  if (battery) battery.textContent = `${Math.round(app.api.device?.battery?.level || 0)}%`;
}

function renderChrome() {
  const current = state();
  if (!current) return;
  const device = app.api?.device;
  const mode = app.api?.mode;
  const settings = current.settings;
  const reconnect = current.reconnect || {};
  $('#device-label').textContent = device?.name || 'No device';
  $('#battery-label').textContent = device ? `${Math.round(device.battery?.level ?? 0)}%` : '—';
  $('#battery-icon').innerHTML = icon(device?.battery?.charging ? 'battery-charging' : 'battery');
  $('#signal-label').textContent = settings.offlineMode ? 'LAN only' : `${device?.signal ?? 0}/4`;
  $('#offline-badge').hidden = !settings.offlineMode;

  const connected = device?.status === 'connected' && reconnect.state !== 'offline';
  const dot = $('#conn-dot');
  dot.className = `conn-dot ${connected ? 'ok' : reconnect.state === 'reconnecting' || reconnect.state === 'dropping' ? 'degraded' : 'offline'}`;
  const connLabel = reconnect.state === 'reconnecting' ? `${t('status.reconnecting')} · ${reconnect.attempt}`
    : reconnect.state === 'restoring' ? 'Restoring session'
      : connected ? `${t('status.connected')} · ${device.transport === 'wifi' ? 'Wi-Fi' : 'USB'}`
        : t('status.offline');
  $('#conn-label').textContent = connLabel;
  $('#status-mode').textContent = mode === 'demo' ? t('status.demo') : t('status.live');
  $('#status-endpoint').textContent = mode === 'demo' ? 'static snapshot' : app.api.baseUrl;
  $('#status-endpoint').title = mode === 'demo' ? 'No bridge connected; data stays in this browser.' : app.api.baseUrl;
  $('#status-latency').textContent = app.api.metrics?.latencyMs != null ? `${app.api.metrics.latencyMs} ms` : '— ms';
  const fps = device?.quality?.fps || app.api.metrics?.fps || 60;
  const bitrate = device?.quality?.bitrateMbps || app.api.metrics?.bitrateMbps || 16;
  $('#status-fps').textContent = `${fps} fps`;
  $('#status-bandwidth').textContent = `${bitrate} Mbps`;
  $('#status-reconnect').textContent = `${t('status.reconnect')}: ${reconnect.state || 'connected'}${reconnect.attempt ? ` (${reconnect.attempt})` : ''} · ${reconnect.healthScore ?? 100}%`;
  $('#status-build').textContent = `v${current.updates?.installed || '2.0.0'}`;
  $('#rail-mode').classList.toggle('live', mode === 'live');
  $('#rail-mode').lastElementChild.textContent = mode === 'live' ? 'Live' : 'Demo';
  $('#rail-mode').title = mode === 'live' ? `Live bridge · ${app.api.baseUrl}` : 'Demo mode — start the bridge to control a real device.';

  const unread = (current.notifications || []).filter((item) => !item.read).length;
  const badge = $('#notif-badge');
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  $('#rail-notif-dot').hidden = unread === 0;
  $('#theme-toggle').innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');
  const a11y = $('#status-a11y');
  a11y.hidden = !settings.highContrast;
  const dm = $('#device-menu-label');
  if (dm) dm.textContent = device?.name || '';
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (mq && !mq._dexBound) {
    mq._dexBound = true;
    mq.addEventListener?.('change', () => { if (state()?.settings?.theme === 'system') applyPreferences(state().settings); });
  }
}

function wireChrome() {
  $('#brand-home').addEventListener('click', () => navigate('desktop'));
  $('#omni-open').addEventListener('click', openPalette);
  $('#notif-open').addEventListener('click', () => navigate('notifications'));
  $('#profile-btn').addEventListener('click', () => navigate('settings'));
  $('#settings-shortcut')?.addEventListener('click', openShortcuts);
  $('#help-open').addEventListener('click', openShortcuts);
  $('#pair-open').addEventListener('click', openPairing);
  $('#lock-btn').addEventListener('click', () => openLock());
  $('#theme-toggle').addEventListener('click', async () => {
    const currentTheme = filterTheme();
    const next = currentTheme === 'light' ? 'dark' : 'light';
    await saveSettings({ theme: next });
  });
  $('#a11y-open').addEventListener('click', toggleA11yPanel);
  $('#conn-pill').addEventListener('click', openDeviceMenu);
  $('#device-pill').addEventListener('click', openDeviceMenu);
  $('#status-latency').addEventListener('click', () => { app.api.refresh().then(() => toast(`Refreshed in ${app.api.metrics?.latencyMs ?? '?'} ms`, { type: 'info' })); });
  $$('.rail-btn').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  window.addEventListener('hashchange', () => {
    const view = initialView();
    if (view !== app.view) navigate(view, { replace: true, silent: true });
    renderView();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#a11y-panel') && !event.target.closest('#a11y-open')) $('#a11y-panel').hidden = true;
  });
}

function filterTheme() {
  return state()?.settings?.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state()?.settings?.theme || 'dark';
}

export async function saveSettings(patch, { quiet = false } = {}) {
  try {
    const next = await app.api.request('/api/settings', { method: 'PATCH', body: patch });
    app.state.settings = { ...app.state.settings, ...next };
    applyPreferences(app.state.settings);
    renderChrome();
    renderView();
    if (!quiet) toast(t('common.saved'), { type: 'success', timeout: 1500 });
    return next;
  } catch (error) {
    toastError(error);
    throw error;
  }
}

// ── Desktop ───────────────────────────────────────────────────────────
function renderDesktop() {
  const current = state();
  const page = el('div', { class: 'desktop-page' });
  const toolbar = el('div', { class: 'desktop-toolbar' });

  const layouts = el('div', { class: 'tool-group', role: 'group', 'aria-label': t('desktop.layouts') });
  for (const [preset, label, iconName] of [['2-columns', '2 columns', 'columns-2'], ['3-columns', '3 columns', 'columns-2'], ['2x2', '2×2', 'grid-2x2'], ['main-side', 'Main + side', 'panel-right'], ['focus', 'Focus', 'app-window']]) {
    layouts.append(el('button', { class: 'btn btn-sm', title: label, onclick: () => applyLayout(preset) }, icon(iconName), label));
  }
  toolbar.append(layouts);

  const actions = el('div', { class: 'tool-group' });
  actions.append(el('button', { class: 'btn btn-sm', onclick: openWidgetMenu }, icon('plus'), t('desktop.addWidget')));
  actions.append(el('button', { class: 'btn btn-sm', onclick: openLaunchMenu }, icon('layout-grid'), t('desktop.launch')));
  actions.append(el('button', { class: 'btn btn-sm', onclick: captureScreenshot }, icon('camera'), 'Screenshot'));
  toolbar.append(actions);

  const meta = el('div', { class: 'desktop-meta' });
  meta.innerHTML = `<span class="pill">${icon('monitor')} ${current.monitors.length} ${t('desktop.monitors').toLowerCase()}</span>
    <span class="pill ok">${icon('app-window')} ${current.windows.length} windows</span>
    <span class="pill">${app.api.mode === 'demo' ? icon('sparkles') + ' demo render' : icon('activity') + ' live signal'}</span>`;
  toolbar.append(meta);
  page.append(toolbar);

  const strip = el('div', { class: 'monitor-strip' });
  const stripWidth = Math.max(0, $('#view').clientWidth - 52);
  const perMonitor = current.monitors.length > 1 ? Math.max(420, Math.floor((stripWidth - 16) / current.monitors.length)) : Math.min(stripWidth, 1400);
  for (const monitor of current.monitors) {
    const wraps = Math.min(monitor.width, perMonitor);
    const wrapper = el('div', { class: 'monitor-wrap', style: { width: `${wraps}px`, maxWidth: '100%' } });
    const label = el('div', { class: 'monitor-label' });
    label.innerHTML = `${icon('monitor')}<span>${esc(monitor.name)}</span>
      <span class="dim">${monitor.width}×${monitor.height} · ${monitor.refresh} Hz${monitor.primary ? ' · primary' : ''}</span>
      <span class="cnt dim">${current.windows.filter((win) => win.monitorId === monitor.id).length} windows</span>
      <button class="icon-btn" title="Monitor settings" aria-label="Monitor settings">${icon('settings')}</button>`;
    label.querySelector('button').addEventListener('click', () => openMonitorMenu(monitor));
    const surface = el('div', {
      class: `monitor${monitor.primary ? ' primary' : ''}`, role: 'region',
      'aria-label': `${monitor.name} desktop surface`,
      style: { aspectRatio: `${monitor.width} / ${monitor.height}`, width: '100%' },
      dataset: { monitorId: monitor.id },
    });
    surface.innerHTML = `<div class="monitor-backdrop-note">${esc(monitor.name)} · ${monitor.width}×${monitor.height}</div>`;

    current.widgets.filter((widget) => widget.monitorId === monitor.id).forEach((widget) => surface.append(renderWidget(widget, monitor)));
    visibleWindows().filter((win) => win.monitorId === monitor.id).forEach((win) => surface.append(renderWindow(win, monitor)));
    surface.append(renderTaskbar(monitor));
    wrapper.append(label, surface);
    strip.append(wrapper);
  }
  page.append(strip);
  if (!current.windows.length) {
    const hint = el('div', { class: 'card', style: { textAlign: 'center', padding: '18px' } });
    hint.innerHTML = `<div class="muted" style="font-size:.8rem">${t('desktop.noWindowsHint')}</div>`;
    page.append(hint);
  }
  return page;
}

async function applyLayout(preset) {
  try {
    await app.api.request('/api/windows/layout', { method: 'POST', body: { preset } });
    toast(`Layout applied: ${preset}`, { type: 'success', timeout: 1600 });
    renderView();
  } catch (error) { toastError(error); }
}

function renderTaskbar(monitor) {
  const bar = el('div', { class: 'desk-taskbar', role: 'toolbar', 'aria-label': 'Desktop taskbar' });
  bar.append(el('button', { class: 'tb-btn', title: 'Open apps', 'aria-label': 'Open app drawer', onclick: openLaunchMenu, html: icon('layout-grid') }));
  bar.append(el('button', { class: 'tb-btn', title: 'Universal search', 'aria-label': 'Universal search', onclick: openPalette, html: icon('search') }));
  bar.append(el('span', { class: 'tb-sep' }));
  const running = visibleWindows().filter((win) => win.monitorId === monitor.id);
  running.slice(0, 7).forEach((win) => {
    const appInfo = app.state.apps.find((item) => item.id === win.appId);
    const button = el('button', {
      class: 'tb-app', title: win.title, 'aria-label': `Focus ${win.title}`,
      style: { background: win.color || appInfo?.color || 'var(--accent)' },
      onclick: () => focusWindow(win.id),
    }, esc((win.title || '?').slice(0, 1).toUpperCase()));
    if (win.minimized) button.style.opacity = '.55';
    bar.append(button);
  });
  if (running.length > 7) bar.append(el('span', { class: 'dim', style: { fontSize: '.6rem' } }, `+${running.length - 7}`));
  bar.append(el('span', { class: 'tb-sep' }));
  bar.append(el('button', { class: 'tb-btn', title: t('desktop.addWidget'), 'aria-label': t('desktop.addWidget'), onclick: openWidgetMenu, html: icon('plus') }));
  const clock = el('div', { class: 'tb-clock' });
  clock.innerHTML = `<b>${relativeClock()}</b><span>${new Date().toLocaleDateString(getLocale(), { weekday: 'short', day: '2-digit', month: 'short' })}</span>`;
  bar.append(clock);
  return bar;
}

function renderWidget(widget, monitor) {
  const style = {
    left: `${(widget.x / monitor.width) * 100}%`, top: `${(widget.y / monitor.height) * 100}%`,
    width: `${(widget.w / monitor.width) * 100}%`, height: `${(widget.h / monitor.height) * 100}%`,
  };
  const node = el('div', {
    class: `widget widget-${widget.type}`, style, dataset: { widgetId: widget.id },
    role: 'group', 'aria-label': `${widget.type} widget`,
  });
  const head = el('div', { class: 'w-head' });
  const labels = { clock: 'Clock', battery: 'Battery', weather: 'Weather', notes: 'Notes', media: 'Media' };
  head.innerHTML = `${icon(widget.type === 'weather' ? 'sun' : widget.type === 'battery' ? 'battery' : widget.type === 'notes' ? 'file-text' : widget.type === 'media' ? 'music' : 'clock')}<span>${labels[widget.type] || widget.type}</span>`;
  const del = el('button', { class: 'w-del', title: 'Remove widget', 'aria-label': 'Remove widget', html: icon('x') });
  del.addEventListener('click', async (event) => {
    event.stopPropagation();
    try { await app.api.request(`/api/widgets/${widget.id}`, { method: 'DELETE' }); renderView(); } catch (error) { toastError(error); }
  });
  head.append(del);
  node.append(head);

  if (widget.type === 'clock') {
    node.dataset.format24 = String(widget.config?.format24h !== false);
    const content = el('div');
    content.innerHTML = `<div class="time">${new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: widget.config?.format24h === false })}</div>
      <div class="date">${new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
    node.append(content);
  } else if (widget.type === 'battery') {
    const battery = app.api.device?.battery || { level: 0, charging: false, temperature: 0 };
    const content = el('div');
    content.innerHTML = `<div class="pct"><span id="widget-battery-pct">${Math.round(battery.level)}%</span><small>${battery.charging ? 'charging' : 'on battery'}</small></div>
      <div class="batt-bar"><span style="width:${battery.level}%"></span></div>
      <div class="tiny-text" style="opacity:.7;margin-top:5px">${battery.temperature?.toFixed(1) || '—'} °C · ${app.api.device?.name || ''}</div>`;
    node.append(content);
  } else if (widget.type === 'weather') {
    const content = el('div');
    content.innerHTML = `<div class="city">${esc(widget.config?.city || 'Doha')}</div><div class="temp">${icon('sun')} 34°</div><div class="tiny-text" style="opacity:.7">Clear · feels 38°</div>`;
    node.append(content);
  } else if (widget.type === 'notes') {
    const content = el('div', { class: 'note-body' }, widget.config?.text || 'Double-click to edit');
    node.append(content);
    node.addEventListener('dblclick', async () => {
      const text = await promptDialog({ title: 'Notes widget', label: 'Text', value: widget.config?.text || '', multiline: true });
      if (text !== null) {
        try { await app.api.request(`/api/widgets/${widget.id}`, { method: 'PATCH', body: { config: { text } } }); renderView(); } catch (error) { toastError(error); }
      }
    });
  } else {
    const session = state().media.sessions.find((item) => item.playing) || state().media.sessions[0];
    node.innerHTML += `<div style="margin-top:6px;font-weight:600">${esc(session?.title || 'Nothing playing')}</div><div style="opacity:.65">${esc(session?.artist || '')}</div>`;
  }

  enableWidgetDrag(node, widget, monitor);
  return node;
}

function enableWidgetDrag(node, widget, monitor) {
  let start = null;
  node.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    start = { x: event.clientX, y: event.clientY, wx: widget.x, wy: widget.y, rect: node.parentElement.getBoundingClientRect() };
    node.setPointerCapture(event.pointerId);
  });
  node.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dx = (event.clientX - start.x) / start.rect.width * monitor.width;
    const dy = (event.clientY - start.y) / start.rect.height * monitor.height;
    const x = clamp(start.wx + dx, 0, monitor.width - widget.w);
    const y = clamp(start.wy + dy, 0, monitor.height - widget.h);
    node.style.left = `${(x / monitor.width) * 100}%`;
    node.style.top = `${(y / monitor.height) * 100}%`;
    start.next = { x: Math.round(x), y: Math.round(y) };
  });
  node.addEventListener('pointerup', async () => {
    if (start?.next) {
      try { await app.api.request(`/api/widgets/${widget.id}`, { method: 'PATCH', body: start.next }); } catch (error) { toastError(error); }
    }
    start = null;
  });
}

function mockAppContent(win) {
  const current = state();
  const appInfo = current.apps.find((item) => item.id === win.appId);
  const modeBadge = app.api.mode === 'demo' ? t('desktop.demoRender') : 'live';
  const status = `<div class="mirror-status"><div class="mi">${new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })}</div>
    <div class="mi">${icon('wifi')}${icon('signal')}${icon('battery')}</div></div>`;
  const header = `<div class="mirror-badge">${modeBadge} · ${win.orientation === 'landscape' ? 'landscape' : 'portrait'}</div>`;
  let body = '';
  switch (win.appId) {
    case 'messages': {
      const conversation = current.conversations.find((item) => item.id === 'conv_maya') || current.conversations[0];
      const bubbles = (conversation?.messages || []).slice(-4).map((message) => `<div class="mock-bubble ${message.from === 'me' ? 'me' : 'them'}">${esc(message.text)}</div>`).join('');
      body = `<div class="mock-header"><div class="mock-avatar" style="background:${conversation?.avatarColor || '#3ddc84'}">${esc((conversation?.name || 'M')[0])}</div>
        <div><h4>${esc(conversation?.name || 'Messages')}</h4><div class="tiny-text" style="opacity:.55">${conversation?.rcs ? 'RCS · ' : 'SMS · '}online</div></div></div>
        <div class="mock-list">${bubbles}</div><div class="mirror-fab" style="--m-accent:#3ddc84">${icon('message-square')}</div>`;
      break;
    }
    case 'spotify': {
      const session = current.media.sessions.find((item) => item.app === 'Spotify') || current.media.sessions[0];
      body = `<div class="mock-player"><div class="mock-art" style="--m-accent:${session?.color || '#1db954'}"></div>
        <div><div style="font-weight:650;font-size:.78rem">${esc(session?.title || 'Nothing playing')}</div><div style="opacity:.6;font-size:.65rem">${esc(session?.artist || '')}</div></div>
        <div class="mock-ctrl">${icon('skip-back')}${icon('pause')}${icon('skip-forward')}</div>
        <div class="mock-track"><div class="mock-progress"><span style="width:${session ? (session.position / session.duration) * 100 : 0}%"></span></div></div></div>`;
      break;
    }
    case 'teams':
      body = `<div class="mock-header"><div class="mock-avatar" style="background:#6264a7">DR</div><div><h4>Design review</h4><div class="tiny-text" style="opacity:.55">4 participants · recording</div></div></div>
        <div class="mock-grid">${['Maya', 'Sven', 'You', 'Jonas'].map((name) => `<div class="mock-tile">${name}</div>`).join('')}</div>
        <div style="display:flex;gap:6px;justify-content:center;padding-bottom:10px">${icon('mic')}${icon('video')}${icon('monitor')}${icon('phone-off')}</div>`;
      break;
    case 'youtube':
      body = `<div class="mock-video"></div><div style="padding:0 14px 12px"><div style="font-weight:600;font-size:.74rem">Building a headless Android bridge</div><div class="tiny-text" style="opacity:.55">DevConf 2026 · 128K views</div></div>`;
      break;
    case 'chrome':
      body = `<div style="display:flex;gap:5px;padding:7px 9px;background:rgba(255,255,255,.04)"><span class="mock-avatar" style="width:14px;height:14px;background:#4285f4"></span><span style="flex:1;background:rgba(255,255,255,.07);border-radius:5px;padding:2px 7px;font-size:.56rem;opacity:.65">https://docs.android-dex.dev</span></div>
        <div class="mock-skeleton"><span style="width:60%;height:14px"></span><span></span><span></span><span style="width:75%"></span><span style="width:40%"></span></div>`;
      break;
    case 'minecraft':
    case 'genshin':
      body = `<div class="mock-video" style="background:linear-gradient(140deg,#21331f,#1a2430 55%,#31241a)"></div><div style="display:flex;gap:8px;justify-content:center;padding-bottom:10px;opacity:.5;font-size:.58rem">${icon('gamepad-2')} keyboard + mouse mapped</div>`;
      break;
    case 'photos':
    case 'gallery':
      body = `<div class="mock-grid">${[1, 2, 3, 4].map((n) => `<div class="mock-tile" style="background:linear-gradient(${n * 47}deg,#1f2937,#0e7490)"></div>`).join('')}</div>`;
      break;
    default:
      body = `<div class="mock-header"><div class="app-icon" style="width:28px;height:28px;border-radius:8px;background:${appInfo?.color || '#888'}">${icon(appInfo?.icon || 'app-window')}</div><div><h4>${esc(appInfo?.name || win.title)}</h4><div class="tiny-text" style="opacity:.55">${esc(win.package)}</div></div></div>
        <div class="mock-skeleton"><span></span><span></span><span style="width:55%"></span></div>
        <div style="margin-top:auto;padding:10px 14px;font-size:.56rem;opacity:.45">Input forwarded over ADB · ${win.dpi} dpi</div>`;
  }
  return `<div class="mirror" style="--m-accent:${win.color}">${status}<div class="mirror-app">${body}</div>${header}</div>`;
}

function renderWindow(win, monitor) {
  const node = el('div', {
    class: `window${win.alwaysOnTop ? ' is-pinned' : ''}${win.pip ? ' pip' : ''}${win.minimized ? ' is-minimized' : ''}${focusedWindow()?.id === win.id ? ' is-focused' : ''}`,
    style: {
      left: `${(win.x / monitor.width) * 100}%`, top: `${(win.y / monitor.height) * 100}%`,
      width: `${(win.w / monitor.width) * 100}%`, height: `${(win.h / monitor.height) * 100}%`,
      zIndex: win.alwaysOnTop ? 30 + win.z : win.z, '--win-color': win.color,
    },
    dataset: { windowId: win.id, appId: win.appId },
    role: 'dialog', 'aria-label': `${win.title} app window`,
  });
  const bar = el('div', { class: 'win-bar' });
  bar.innerHTML = `<span class="win-dot"></span><span class="win-title">${esc(win.title)}</span>
    ${win.alwaysOnTop ? `<span class="win-flag pin">pin</span>` : ''}${win.pip ? `<span class="win-flag pip">PiP</span>` : ''}
    <span class="win-flags">${win.snapped ? `<span class="win-flag">${esc(win.snapped.replace('-', ' '))}</span>` : ''}</span>
    <div class="win-tools">
      <button data-act="pin" class="${win.alwaysOnTop ? 'on' : ''}" title="Always on top" aria-label="Toggle always on top">${icon('pin')}</button>
      <button data-act="pip" class="${win.pip ? 'on' : ''}" title="Picture-in-picture" aria-label="Picture-in-picture">${icon('picture-in-picture-2')}</button>
      <button data-act="orient" title="Force orientation: ${win.orientation}" aria-label="Force orientation">${icon('rotate-cw')}</button>
      <button data-act="min" title="Minimise" aria-label="Minimise">${icon('minimize-2')}</button>
      <button data-act="max" title="Maximise" aria-label="Maximise">${icon('maximize-2')}</button>
      <button data-act="close" class="close" title="Close" aria-label="Close window">${icon('x')}</button>
    </div>`;
  bar.addEventListener('pointerdown', (event) => beginWindowDrag(event, win, node, monitor));
  bar.addEventListener('contextmenu', (event) => { event.preventDefault(); openWindowMenu(win); });
  node.append(bar);

  const body = el('div', { class: 'win-body' });
  body.innerHTML = mockAppContent(win);
  if (win.pip) body.style.pointerEvents = 'none';
  node.append(body);
  const resize = el('div', { class: 'win-resize', title: 'Resize' });
  enableWindowResize(resize, win, node, monitor);
  node.append(resize);

  node.addEventListener('pointerdown', () => {
    if (focusedWindow()?.id !== win.id) {
      // Raising is local + persisted, but do not spam the API on every click.
      win.z = Math.max(0, ...state().windows.map((item) => item.z)) + 1;
      $$('.window', node.parentElement).forEach((other) => {
        other.classList.toggle('is-focused', other.dataset.windowId === win.id);
        other.style.zIndex = other.dataset.windowId === win.id ? String(win.z + 2) : String(other.dataset.windowId === win.id ? win.z : Number(other.style.zIndex));
      });
      app.api.request(`/api/windows/${win.id}/focus`, { method: 'POST', body: {} }).catch(() => {});
    }
  }, { capture: true });

  bar.querySelectorAll('[data-act]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = button.dataset.act;
      try {
        if (action === 'pin') await patchWindow(win.id, { alwaysOnTop: !win.alwaysOnTop });
        else if (action === 'pip') await patchWindow(win.id, { pip: !win.pip });
        else if (action === 'orient') await patchWindow(win.id, { orientation: win.orientation === 'portrait' ? 'landscape' : win.orientation === 'landscape' ? 'locked-landscape' : 'portrait' });
        else if (action === 'min') await patchWindow(win.id, { minimized: true });
        else if (action === 'max') await app.api.request(`/api/windows/${win.id}/snap`, { method: 'POST', body: { zone: 'maximize' } }).then(renderView);
        else if (action === 'close') { await app.api.request(`/api/windows/${win.id}`, { method: 'DELETE' }); renderView(); }
      } catch (error) { toastError(error); }
    });
  });
  return node;
}

async function focusWindow(id) {
  try { await app.api.request(`/api/windows/${id}/focus`, { method: 'POST', body: {} }); renderView(); } catch (error) { toastError(error); }
}

async function patchWindow(id, patch) {
  try {
    await app.api.request(`/api/windows/${id}`, { method: 'PATCH', body: patch });
    renderView();
  } catch (error) { toastError(error); }
}

function beginWindowDrag(event, win, node, monitor) {
  if (event.button !== 0 || event.target.closest('button')) return;
  const surface = node.parentElement;
  const rect = surface.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY, wx: win.x, wy: win.y, zone: null };
  node.setPointerCapture(event.pointerId);
  const hint = el('div', { class: 'snap-hint', style: { display: 'none' } });
  surface.append(hint);
  const zones = [
    ['left-half', 0, 0, .5, 1], ['right-half', .5, 0, .5, 1], ['maximize', 0, 0, 1, 1],
    ['top-left', 0, 0, .5, .5], ['top-right', .5, 0, .5, .5], ['bottom-left', 0, .5, .5, .5], ['bottom-right', .5, .5, .5, .5],
  ];

  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - start.x) / rect.width * monitor.width;
    const dy = (moveEvent.clientY - start.y) / rect.height * monitor.height;
    const x = clamp(start.wx + dx, 0, monitor.width - win.w);
    const y = clamp(start.wy + dy, 0, monitor.height - win.h);
    node.style.left = `${(x / monitor.width) * 100}%`;
    node.style.top = `${(y / monitor.height) * 100}%`;
    start.next = { x: Math.round(x), y: Math.round(y) };
    const localX = moveEvent.clientX - rect.left;
    const localY = moveEvent.clientY - rect.top;
    let zone = null;
    if (localX < 18) zone = localY < rect.height / 2 ? 'left-half' : 'left-half';
    else if (localX > rect.width - 18) zone = 'right-half';
    else if (localY < 14) zone = 'maximize';
    if (zone) {
      const found = zones.find(([name]) => name === zone);
      if (found) {
        hint.style.display = 'block';
        hint.style.left = `${found[1] * 100}%`; hint.style.top = `${found[2] * 100}%`;
        hint.style.width = `${found[3] * 100}%`; hint.style.height = `${found[4] * 100}%`;
        start.zone = zone;
      }
    } else {
      hint.style.display = 'none';
      start.zone = null;
    }
  };
  const up = async () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    hint.remove();
    try {
      if (start.zone) await app.api.request(`/api/windows/${win.id}/snap`, { method: 'POST', body: { zone: start.zone } });
      else if (start.next) await app.api.request(`/api/windows/${win.id}`, { method: 'PATCH', body: start.next });
      renderView();
    } catch (error) { toastError(error); }
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

function enableWindowResize(handle, win, node, monitor) {
  let start = null;
  handle.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    const surface = node.parentElement;
    start = { x: event.clientX, y: event.clientY, w: win.w, h: win.h, rect: surface.getBoundingClientRect() };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!start) return;
    const width = clamp(start.w + (event.clientX - start.x) / start.rect.width * monitor.width, 220, monitor.width - win.x);
    const height = clamp(start.h + (event.clientY - start.y) / start.rect.height * monitor.height, 150, monitor.height - win.y);
    node.style.width = `${(width / monitor.width) * 100}%`;
    node.style.height = `${(height / monitor.height) * 100}%`;
    start.next = { w: Math.round(width), h: Math.round(height) };
  });
  handle.addEventListener('pointerup', async () => {
    if (start?.next) {
      try { await app.api.request(`/api/windows/${win.id}`, { method: 'PATCH', body: start.next }); } catch (error) { toastError(error); }
    }
    start = null;
  });
}

function openWindowMenu(win) {
  const body = el('div', { class: 'stack' });
  const zones = [['left-half', 'Left half'], ['right-half', 'Right half'], ['top-half', 'Top half'], ['bottom-half', 'Bottom half'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['maximize', 'Maximise']];
  const grid = el('div', { class: 'grid cols-3' });
  zones.forEach(([zone, label]) => grid.append(el('button', { class: 'btn', onclick: async () => { closeAllModals(); await app.api.request(`/api/windows/${win.id}/snap`, { method: 'POST', body: { zone } }); renderView(); } }, label)));
  body.append(el('div', { class: 'section-title', style: { marginTop: '0' } }, 'Snap zone'), grid);
  const monitorRow = el('div', { class: 'row wrap' });
  state().monitors.forEach((monitor) => monitorRow.append(el('button', {
    class: `btn ${win.monitorId === monitor.id ? 'btn-primary' : ''}`,
    onclick: async () => { closeAllModals(); await app.api.request(`/api/windows/${win.id}`, { method: 'PATCH', body: { monitorId: monitor.id } }); renderView(); },
  }, `${monitor.name} ${monitor.width}×${monitor.height}`)));
  body.append(el('div', { class: 'section-title' }, 'Route to monitor'), monitorRow);
  const dpiRow = el('div', { class: 'row wrap' });
  [[240, 'Compact'], [320, 'Default'], [480, 'Large']].forEach(([dpi, label]) => dpiRow.append(el('button', {
    class: `btn ${win.dpi === dpi ? 'btn-primary' : ''}`,
    onclick: async () => { closeAllModals(); await app.api.request(`/api/windows/${win.id}`, { method: 'PATCH', body: { dpi } }); renderView(); },
  }, `${label} (${dpi} dpi)`)));
  body.append(el('div', { class: 'section-title' }, 'Per-app density'), dpiRow);
  const orientRow = el('div', { class: 'row wrap' });
  ['portrait', 'landscape', 'locked-portrait', 'locked-landscape', 'sensor'].forEach((orientation) => orientRow.append(el('button', {
    class: `btn ${win.orientation === orientation ? 'btn-primary' : ''}`, onclick: async () => { closeAllModals(); await app.api.request(`/api/windows/${win.id}`, { method: 'PATCH', body: { orientation } }); renderView(); },
  }, orientation.replace('-', ' '))));
  body.append(el('div', { class: 'section-title' }, 'Orientation'), orientRow);
  body.append(el('button', {
    class: 'btn btn-block', onclick: async () => {
      const platform = navigator.userAgent.includes('Win') ? 'windows' : navigator.userAgent.includes('Mac') ? 'macos' : 'linux';
      const entry = await app.api.request(`/api/apps/${win.appId}/launcher`, { query: { platform } });
      downloadText(entry.content, entry.filename);
      toast(`Launcher entry downloaded for ${entry.app}`);
    },
  }, icon('external-link'), 'Download host launcher entry'));
  openModal({ title: win.title, subtitle: `${win.package} · ${win.dpi} dpi · ${win.monitorId}`, body, wide: true });
}

function openWidgetMenu() {
  const body = el('div', { class: 'stack' });
  const grid = el('div', { class: 'grid cols-2' });
  [['clock', 'Clock', 'clock'], ['battery', 'Battery', 'battery-charging'], ['weather', 'Weather', 'sun'], ['notes', 'Notes', 'file-text'], ['media', 'Now playing', 'music']].forEach(([type, label, iconName]) => {
    grid.append(el('button', {
      class: 'app-card', onclick: async () => {
        try {
          await app.api.request('/api/widgets', { method: 'POST', body: { type } });
          closeAllModals(); renderView(); toast(`${label} widget added`);
        } catch (error) { toastError(error); }
      },
    }, el('span', { class: 'app-icon', style: { background: 'var(--accent)' }, html: icon(iconName) }), el('span', { class: 'app-meta' }, el('span', { class: 'app-name' }, label))));
  });
  body.append(grid);
  body.append(el('p', { class: 'dim tiny-text' }, 'Widgets stay on the desktop surface and never leave the host. Drag to move, double-click notes to edit.'));
  openModal({ title: t('desktop.addWidget'), body, small: true });
}

function openLaunchMenu() {
  const body = el('div');
  const search = el('input', { class: 'input', placeholder: t('apps.search'), 'aria-label': t('apps.search') });
  const grid = el('div', { class: 'app-grid', style: { marginTop: '12px', maxHeight: '52vh', overflow: 'auto' } });
  const draw = (query = '') => {
    grid.innerHTML = '';
    state().apps.filter((item) => `${item.name} ${item.package}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30).forEach((item) => {
      const button = el('button', { class: 'app-card', onclick: async () => { try { await app.api.request('/api/windows', { method: 'POST', body: { appId: item.id } }); closeAllModals(); navigate('desktop'); } catch (error) { toastError(error); } } });
      button.innerHTML = `<span class="app-icon" style="background:${item.color}">${icon(item.icon)}</span><span class="app-meta"><span class="app-name">${esc(item.name)}</span><span class="app-pkg">${esc(item.package)}</span></span>`;
      grid.append(button);
    });
  };
  draw();
  search.addEventListener('input', () => draw(search.value));
  body.append(search, grid);
  openModal({ title: t('desktop.launch'), subtitle: 'Opens a resizable window on the desktop', body, wide: true });
}

function openMonitorMenu(monitor) {
  const body = el('div', { class: 'stack' });
  const width = el('input', { class: 'input', type: 'number', value: monitor.width, min: 800, max: 15360 });
  const height = el('input', { class: 'input', type: 'number', value: monitor.height, min: 600, max: 8640 });
  const scale = el('input', { class: 'input', type: 'number', value: monitor.scale || 100, min: 50, max: 300 });
  const primary = el('button', { class: `btn ${monitor.primary ? 'btn-primary' : ''}`, onclick: async () => { try { await app.api.request(`/api/monitors/${monitor.id}`, { method: 'PATCH', body: { width: Number(width.value), height: Number(height.value), scale: Number(scale.value) } }); closeAllModals(); renderView(); } catch (error) { toastError(error); } } }, 'Apply resolution');
  body.append(el('div', { class: 'grid cols-3' }, el('div', { class: 'field' }, el('label', {}, 'Width'), width), el('div', { class: 'field' }, el('label', {}, 'Height'), height), el('div', { class: 'field' }, el('label', {}, 'Scale %'), scale)));
  body.append(el('div', { class: 'row' }, el('button', {
    class: 'btn', onclick: async () => { try { await app.api.request(`/api/monitors/${monitor.id}`, { method: 'PATCH', body: { primary: true } }); closeAllModals(); renderView(); } catch (error) { toastError(error); } },
  }, icon('star'), 'Make primary'), primary));
  openModal({ title: monitor.name, subtitle: `${monitor.width}×${monitor.height} @ ${monitor.refresh} Hz`, body });
}

// ── Command palette ───────────────────────────────────────────────────
export function openPalette() {
  if ($('.palette-backdrop')) return;
  const backdrop = el('div', { class: 'palette-backdrop' });
  const palette = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('search.title') });
  const inputWrap = el('div', { class: 'palette-input' });
  inputWrap.innerHTML = `${icon('search')}`;
  const input = el('input', { placeholder: t('search.placeholder'), 'aria-label': t('search.title'), autocomplete: 'off' });
  inputWrap.append(input, el('kbd', {}, 'Esc'));
  const results = el('div', { class: 'palette-results' });
  const foot = el('div', { class: 'palette-foot' });
  foot.innerHTML = `<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span>`;
  palette.append(inputWrap, results, foot);
  backdrop.append(palette);
  $('#palette-root').append(backdrop);
  hydrateIcons(palette);

  let activeIndex = 0;
  let flat = [];
  const close = () => backdrop.remove();

  const quickActions = [
    { title: 'Open Settings', subtitle: 'Preferences, connection, updates', icon: 'settings', action: { type: 'settings', section: 'appearance' } },
    { title: 'Clipboard history', subtitle: 'Text + images synced with the phone', icon: 'clipboard', action: { type: 'view', view: 'clipboard' } },
    { title: 'Phone: calls & messages', subtitle: 'Dialer, SMS, contacts', icon: 'phone', action: { type: 'view', view: 'phone' } },
    { title: 'Take a screenshot', subtitle: 'Saved to the share and gallery', icon: 'camera', action: { type: 'screenshot' } },
    { title: 'Start / stop recording', subtitle: 'Capture the mirrored desktop', icon: 'video', action: { type: 'record' } },
    { title: 'Pair a new device', subtitle: 'QR + 6-digit code, fingerprint pinned', icon: 'qr-code', action: { type: 'pair' } },
    { title: 'Lock the phone', subtitle: 'Forwarded biometric prompt', icon: 'lock', action: { type: 'lock' } },
    { title: 'Toggle theme', subtitle: 'Dark / light', icon: 'sun', action: { type: 'theme' } },
    { title: 'Keyboard shortcuts', subtitle: 'All global actions', icon: 'keyboard', action: { type: 'shortcuts' } },
  ];

  const renderItems = (groups) => {
    results.innerHTML = '';
    flat = [];
    if (!groups.length) {
      results.append(el('div', { class: 'palette-empty' }, query ? t('search.empty') : ''));
      return;
    }
    for (const group of groups) {
      results.append(el('div', { class: 'palette-group' }, group.label));
      for (const item of group.items) {
        const index = flat.length;
        const row = el('button', { class: 'palette-item', role: 'option' });
        row.innerHTML = `<span class="pi-icon" style="background:${item.color || 'var(--accent)'}">${icon(item.icon || 'arrow-up-right')}</span>
          <span class="pi-body"><span class="pi-title">${esc(item.title)}</span><span class="pi-sub">${esc(item.subtitle || '')}</span></span>
          <span class="dim">${icon('corner-down-left')}</span>`;
        row.addEventListener('mouseenter', () => { activeIndex = index; highlight(); });
        row.addEventListener('click', () => run(item));
        flat.push({ ...item, node: row });
        results.append(row);
      }
    }
    activeIndex = Math.min(activeIndex, flat.length - 1);
    highlight();
  };

  const highlight = () => {
    flat.forEach((item, index) => item.node.classList.toggle('is-active', index === activeIndex));
    flat[activeIndex]?.node.scrollIntoView?.({ block: 'nearest' });
  };

  let query = '';
  const search = debounce(async () => {
    if (!query.trim()) {
      renderItems([{ label: 'Quick actions', items: quickActions }]);
      return;
    }
    try {
      const data = await app.api.request('/api/search', { query: { q: query } });
      renderItems(data.groups || []);
    } catch (error) {
      renderItems([{ label: 'Quick actions', items: quickActions.filter((action) => action.title.toLowerCase().includes(query.toLowerCase())) }]);
    }
  }, 140);

  const run = async (item) => {
    close();
    const action = item.action || {};
    try {
      if (action.type === 'launch') { await app.api.request('/api/windows', { method: 'POST', body: { appId: action.appId } }); navigate('desktop'); }
      else if (action.type === 'call') { await app.api.request('/api/telephony/calls', { method: 'POST', body: { number: action.number, contactId: action.contactId } }); navigate('phone'); }
      else if (action.type === 'open-conversation') { app.viewState.conversationId = action.conversationId; navigate('phone'); }
      else if (action.type === 'files') { app.viewState.filesDir = action.path || ''; navigate('files'); }
      else if (action.type === 'settings') { app.viewState.settingsSection = action.section; navigate('settings'); }
      else if (action.type === 'game-profile') { app.viewState.profileId = action.profileId; navigate('gaming'); }
      else if (action.type === 'clipboard') navigate('clipboard');
      else if (action.type === 'notifications') navigate('notifications');
      else if (action.type === 'plugins') { app.viewState.devTab = 'plugins'; navigate('developer'); }
      else if (action.type === 'view') navigate(action.view);
      else if (action.type === 'screenshot') captureScreenshot();
      else if (action.type === 'record') toggleRecording();
      else if (action.type === 'pair') openPairing();
      else if (action.type === 'lock') openLock();
      else if (action.type === 'theme') saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }, { quiet: true });
      else if (action.type === 'shortcuts') openShortcuts();
    } catch (error) { toastError(error); }
  };

  input.addEventListener('input', () => { query = input.value; search(); activeIndex = 0; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(flat.length - 1, activeIndex + 1); highlight(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); highlight(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (flat[activeIndex]) run(flat[activeIndex]); }
    else if (event.key === 'Escape') close();
  });
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  window.addEventListener('keydown', function escListener(event) { if (event.key === 'Escape') { close(); window.removeEventListener('keydown', escListener); } });
  renderItems([{ label: 'Quick actions', items: quickActions }]);
  setTimeout(() => input.focus(), 30);
}

// ── Actions ───────────────────────────────────────────────────────────
export async function captureScreenshot() {
  try {
    const shot = await app.api.request('/api/capture/screenshot', { method: 'POST', body: {} });
    toast(t('toast.screenshot'), { title: shot.name });
    if (app.view === 'media' || app.view === 'desktop') renderView();
  } catch (error) { toastError(error); }
}

export async function toggleRecording() {
  const media = state().media;
  try {
    if (media.recording?.active) {
      const recording = await app.api.request('/api/capture/record/stop', { method: 'POST', body: {} });
      toast(`Recording saved · ${fmtDuration(recording.durationSec)}`, { title: recording.name });
    } else {
      await app.api.request('/api/capture/record/start', { method: 'POST', body: { mode: 'screen' } });
      toast('Recording started', { type: 'info' });
    }
    renderView();
  } catch (error) { toastError(error); }
}

// ── Pairing ───────────────────────────────────────────────────────────
export async function openPairing() {
  const body = el('div');
  const intro = el('div', { class: 'stack' });
  const nameField = el('div', { class: 'field' }, el('label', {}, t('pair.deviceName')), el('input', { class: 'input', id: 'pair-name', value: 'My Android device' }));
  const transport = el('div', { class: 'field' }, el('label', {}, t('pair.transport')), (() => {
    const select = el('select', { class: 'select' });
    select.innerHTML = `<option value="wifi">${t('pair.wifi')}</option><option value="usb">${t('pair.usb')}</option>`;
    return select;
  })());
  const startButton = el('button', { class: 'btn btn-primary', onclick: start }, icon('qr-code'), t('pair.start'));
  intro.append(nameField, transport, startButton);
  body.append(intro);
  const stage = el('div');
  body.append(stage);
  const modal = openModal({
    title: t('pair.title'), subtitle: t('pair.sub'), body, wide: true,
    footer: el('button', { class: 'btn btn-ghost', onclick: () => closeAllModals() }, t('common.close')),
  });

  async function start() {
    try {
      startButton.disabled = true;
      const data = await app.api.request('/api/pair/start', { method: 'POST', body: { deviceName: nameField.querySelector('input').value || 'Android device', transport: transport.querySelector('select').value } });
      renderPairing(data);
    } catch (error) {
      toastError(error);
      startButton.disabled = false;
    }
  }

  function renderPairing(data) {
    intro.hidden = true;
    stage.innerHTML = '';
    const qrStage = el('div', { class: 'qr-stage' });
    try {
      if (window.qrcode) {
        const qr = window.qrcode(0, 'M');
        qr.addData(data.qrPayload);
        qr.make();
        qrStage.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } else {
        qrStage.innerHTML = `<div class="dim">QR renderer unavailable — copy the payload below.</div>`;
      }
    } catch {
      qrStage.innerHTML = `<div class="dim">Could not render QR. Use the payload below.</div>`;
    }
    stage.append(qrStage);
    const code = el('div', { class: 'pair-code' });
    String(data.code || '000000').split('').forEach((digit) => code.append(el('span', {}, digit)));
    stage.append(el('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '4px' } }, el('span', { class: 'dim tiny-text' }, t('pair.code'))), code);
    stage.append(el('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '12px' } },
      el('span', { class: 'pill accent' }, icon('fingerprint'), data.fingerprint || 'SHA256:…')));
    stage.append(el('div', { class: 'card', style: { background: 'var(--bg-soft)' } },
      el('div', { class: 'tiny-text dim', style: { marginBottom: '6px' } }, t('pair.steps')),
      el('ol', { style: { paddingLeft: '18px', fontSize: '.74rem', lineHeight: '1.8' } },
        ...(data.adbSteps || []).map((step) => el('li', {}, step)))));
    const payloadBox = el('textarea', { class: 'textarea mono-text', readonly: true, style: { marginTop: '10px', minHeight: '58px' } });
    payloadBox.value = data.qrPayload;
    stage.append(payloadBox);
    const actions = el('div', { class: 'row wrap', style: { marginTop: '10px' } });
    actions.append(el('button', { class: 'btn', onclick: () => copyText(data.qrPayload) }, icon('copy'), t('common.copy')));
    if (app.api.mode === 'demo') {
      actions.append(el('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await app.api.request('/api/pair/confirm', { method: 'POST', body: { pairingId: data.pairingId, token: data.token, code: data.code, device: { id: 'demo_paired', name: nameField.querySelector('input').value } } });
            closeAllModals();
            toast(t('toast.paired'));
            await app.api.refresh();
            renderView();
          } catch (error) { toastError(error); }
        },
      }, icon('smartphone'), 'Simulate companion scan'));
    } else {
      actions.append(el('span', { class: 'dim tiny-text' }, 'Waiting for the companion to scan…'));
      const poll = setInterval(async () => {
        if (!document.body.contains(stage)) { clearInterval(poll); return; }
        try {
          const status = await app.api.request('/api/pair/status');
          if (!status.active && status.paired?.length) {
            clearInterval(poll);
            closeAllModals();
            toast(t('toast.paired'));
            await app.api.refresh();
            renderView();
          }
        } catch { clearInterval(poll); }
      }, 2500);
    }
    const cancel = el('button', { class: 'btn btn-ghost', onclick: async () => { try { await app.api.request('/api/pair/cancel', { method: 'POST', body: {} }); } catch { /* ignore */ } closeAllModals(); } }, t('common.cancel'));
    actions.append(cancel);
    stage.append(actions);
    stage.append(el('p', { class: 'dim tiny-text', style: { marginTop: '10px' } }, t('pair.security')));
  }
}

// ── Lock / biometrics ─────────────────────────────────────────────────
export async function openLock(silent = false) {
  if ($('#lock-modal') && !silent) return;
  let challenge = null;
  try {
    const result = await app.api.request('/api/system/lock', { method: 'POST', body: { reason: 'desktop lock button' } });
    challenge = result.challenge;
  } catch (error) { toastError(error); return; }
  const body = el('div', { class: 'biometric', id: 'lock-modal' });
  body.innerHTML = `<div class="bio-ring">${icon('fingerprint')}</div>
    <div><div style="font-weight:600;font-size:.9rem">${t('lock.sub')}</div>
    <div class="dim tiny-text" style="margin-top:4px">${esc(challenge?.prompt || 'Biometric prompt forwarded from the phone')}</div></div>
    <div class="row" style="gap:8px">
      <button class="btn btn-ghost" id="lock-deny">${t('lock.deny')}</button>
      <button class="btn btn-primary" id="lock-unlock">${icon('fingerprint')} ${t('lock.unlock')}</button>
    </div>
    <button class="btn btn-ghost btn-sm" id="lock-fail">${t('lock.simulateFail')}</button>`;
  const modal = openModal({ title: t('lock.title'), body, small: true, onClose: () => {} });
  const unlock = async (success) => {
    try {
      await app.api.request('/api/system/biometric', { method: 'POST', body: { challengeId: challenge?.id, success } });
      if (success) { closeAllModals(); toast(t('lock.unlocked')); renderView(); }
      else toast('Biometric attempt denied — the phone stays locked.', { type: 'error' });
    } catch (error) { toastError(error); }
  };
  body.querySelector('#lock-unlock').addEventListener('click', () => unlock(true));
  body.querySelector('#lock-fail').addEventListener('click', () => unlock(false));
  body.querySelector('#lock-deny').addEventListener('click', () => closeAllModals());
  modal.backdrop.addEventListener('click', (event) => { if (event.target === modal.backdrop) event.stopPropagation(); });
}

// ── Device menu ───────────────────────────────────────────────────────
export function openDeviceMenu() {
  const current = state();
  const device = app.api.device;
  const body = el('div', { class: 'stack' });
  const list = el('div', { class: 'stack', style: { gap: '6px' } });
  current.devices.forEach((item) => {
    const card = el('div', { class: `card ${item.id === current.activeDeviceId ? 'selected' : ''}`, style: { padding: '12px', borderColor: item.id === current.activeDeviceId ? 'var(--accent)' : 'var(--border)' } });
    card.innerHTML = `<div class="row"><span class="conn-dot ${item.status === 'connected' ? 'ok' : 'degraded'}"></span>
      <div style="flex:1"><div style="font-weight:600">${esc(item.name)}</div>
      <div class="dim tiny-text">${esc(item.model)} · Android ${item.android} · ${item.transport === 'wifi' ? 'Wi-Fi' : 'USB'} · ${Math.round(item.battery?.level ?? 0)}%</div></div>
      ${item.id === current.activeDeviceId ? '<span class="pill ok">active</span>' : `<button class="btn btn-sm" data-select="${item.id}">Use</button>`}</div>`;
    card.querySelector('[data-select]')?.addEventListener('click', async () => {
      try { await app.api.request('/api/devices/select', { method: 'POST', body: { deviceId: item.id } }); closeAllModals(); await app.api.refresh(); renderChrome(); renderView(); } catch (error) { toastError(error); }
    });
    list.append(card);
  });
  if (!current.devices.length) list.append(emptyState('smartphone', 'No devices paired', 'Pair an Android device over USB or Wi-Fi to get started.'));
  body.append(list);

  const actions = el('div', { class: 'row wrap' });
  const act = (label, iconName, fn, kind = 'btn') => {
    const button = el('button', { class: kind }, icon(iconName), label);
    button.addEventListener('click', fn);
    return button;
  };
  actions.append(act('Connect', 'plug', async () => {
    try { await app.api.request('/api/devices/connect', { method: 'POST', body: { transport: device?.transport || 'usb' } }); await app.api.refresh(); renderChrome(); renderView(); toast('Device connected'); } catch (error) { toastError(error); }
  }, 'btn btn-primary btn-sm'));
  actions.append(act('Reconnect now', 'refresh-cw', async () => {
    try { await app.api.request('/api/devices/reconnect', { method: 'POST', body: {} }); await app.api.refresh(); renderChrome(); renderView(); toast('Reconnect requested'); } catch (error) { toastError(error); }
  }, 'btn btn-sm'));
  actions.append(act('Simulate drop', 'unplug', async () => {
    try { await app.api.request('/api/devices/drop', { method: 'POST', body: { reason: 'simulated from console' } }); await app.api.refresh(); renderChrome(); renderView(); toast('Transport dropped — watching backoff', { type: 'warn' }); } catch (error) { toastError(error); }
  }, 'btn btn-sm'));
  actions.append(act('Pair new', 'qr-code', () => { closeAllModals(); openPairing(); }, 'btn btn-sm'));
  body.append(el('div', { class: 'section-title' }, 'Connection'), actions);

  const preview = current.reconnect;
  const conn = el('div', { class: 'card', style: { padding: '12px' } });
  conn.innerHTML = `<div class="row"><span class="pill ${preview.state === 'connected' ? 'ok' : 'warn'}">${preview.state}</span>
    <span class="dim tiny-text">attempt ${preview.attempt} · health ${preview.healthScore}%</span></div>
    <div class="tiny-text dim" style="margin-top:6px">Exponential backoff · jitter 20% · cap 30 s${preview.nextRetryAt ? ` · next ${fmtTime(preview.nextRetryAt, { seconds: true })}` : ''}</div>`;
  body.append(el('div', { class: 'section-title' }, 'Reconnect'), conn);

  if (device) {
    const quality = el('div', { class: 'row wrap' });
    [['low', 'Low · 3 Mbps'], ['medium', 'Medium · 8 Mbps'], ['high', 'High · 16 Mbps']].forEach(([preset, label]) => quality.append(el('button', {
      class: `btn btn-sm ${device.quality?.preset === preset ? 'btn-primary' : ''}`,
      onclick: async () => {
        try { await app.api.request(`/api/devices/${device.id}`, { method: 'PATCH', body: { quality: { preset } } }); await app.api.refresh(); renderChrome(); renderView(); } catch (error) { toastError(error); }
      },
    }, label)));
    body.append(el('div', { class: 'section-title' }, 'Stream quality'), quality);

    const charge = el('div', { class: 'card', style: { padding: '12px' } });
    const limit = el('input', { type: 'range', min: 40, max: 100, value: current.settings.chargeLimit || 80 });
    const readout = el('span', { class: 'pill' }, `${current.settings.chargeLimit || 80}%`);
    limit.addEventListener('input', () => { readout.textContent = `${limit.value}%`; });
    limit.addEventListener('change', async () => {
      try { await app.api.request(`/api/devices/${device.id}/charge`, { method: 'POST', body: { enabled: true, limit: Number(limit.value) } }); await app.api.refresh(); renderChrome(); } catch (error) { toastError(error); }
    });
    charge.append(el('div', { class: 'row between' }, el('span', { class: 'tiny-text dim' }, 'Charge limit while mirroring'), readout), limit);
    body.append(el('div', { class: 'section-title' }, 'Battery safety'), charge);
  }

  openModal({ title: 'Devices & connection', subtitle: `${current.devices.length} paired · ${app.api.mode === 'live' ? app.api.baseUrl : 'demo mode'}`, body });
}

// ── Shortcuts & accessibility ─────────────────────────────────────────
export function openShortcuts() {
  const hotkeys = state()?.settings?.hotkeys || {};
  const labels = {
    toggleUi: 'Show / hide console (host)', deviceSwitcher: 'Device switcher', screenshot: 'Screenshot',
    record: 'Start / stop recording', clipboard: 'Clipboard history', search: 'Universal search',
    lock: 'Lock phone', pip: 'Picture-in-picture (focused)', alwaysOnTop: 'Always on top (focused)',
    fullscreen: 'Toggle fullscreen',
  };
  const body = el('div', { class: 'stack' });
  const table = el('div');
  Object.entries(hotkeys).forEach(([action, accelerator]) => {
    const row = el('div', { class: 'hotkey-row' });
    row.innerHTML = `<span>${esc(labels[action] || action)}</span><button class="btn btn-sm hotkey-btn">${esc(accelerator)}</button>`;
    row.querySelector('button').addEventListener('click', () => rebindHotkey(action, accelerator, row.querySelector('button')));
    table.append(row);
  });
  body.append(table);
  body.append(el('p', { class: 'dim tiny-text', style: { marginTop: '10px' } }, 'Press a new combination after clicking a shortcut. Conflicts are rejected by the bridge. Global OS hotkeys are registered by the desktop client.'));
  const extra = el('div', { class: 'card', style: { marginTop: '12px' } });
  extra.innerHTML = `<div class="tiny-text dim" style="line-height:1.9">
    <div><kbd>Alt</kbd>+<kbd>1…9</kbd> switch views</div>
    <div><kbd>Ctrl</kbd>+<kbd>K</kbd> universal search</div>
    <div><kbd>?</kbd> this dialog</div>
    <div><kbd>Esc</kbd> close dialogs</div></div>`;
  body.append(extra);
  openModal({ title: t('shortcuts.title'), subtitle: t('shortcuts.sub'), body, wide: true, footer: el('button', { class: 'btn btn-ghost', onclick: () => closeAllModals() }, t('common.close')) });
}

async function rebindHotkey(action, current, button) {
  button.classList.add('listening');
  button.textContent = t('gaming.pressKey');
  const handler = async (event) => {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    event.preventDefault();
    document.removeEventListener('keydown', handler, true);
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    const accelerator = parts.join('+');
    try {
      const hotkeys = await app.api.request('/api/hotkeys', { method: 'PATCH', body: { action, accelerator } });
      app.state.settings.hotkeys = hotkeys;
      setShortcutMap(hotkeys);
      button.textContent = accelerator;
      toast(`Rebound to ${accelerator}`);
    } catch (error) {
      button.textContent = current;
      toastError(error);
    } finally {
      button.classList.remove('listening');
    }
  };
  document.addEventListener('keydown', handler, true);
}

function toggleA11yPanel() {
  const panel = $('#a11y-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const settings = state().settings;
  panel.innerHTML = '';
  const title = el('h3', {}, t('a11y.title'));
  panel.append(title);
  panel.append(settingToggle(t('a11y.contrast'), settings.highContrast, (value) => saveSettings({ highContrast: value }, { quiet: true })));
  panel.append(settingToggle(t('a11y.dyslexia'), settings.dyslexiaFont, (value) => saveSettings({ dyslexiaFont: value }, { quiet: true })));
  panel.append(settingToggle(t('a11y.motion'), settings.reducedMotion, (value) => saveSettings({ reducedMotion: value }, { quiet: true })));
  const scale = el('div', { class: 'switch-row' });
  const range = el('input', { type: 'range', min: 80, max: 150, step: 5, value: settings.uiScale || 100, 'aria-label': t('a11y.scale') });
  const label = el('span', { class: 'pill' }, `${settings.uiScale || 100}%`);
  range.addEventListener('input', () => { label.textContent = `${range.value}%`; });
  range.addEventListener('change', () => saveSettings({ uiScale: Number(range.value) }, { quiet: true }));
  scale.append(el('div', { class: 'sr-body' }, el('div', { class: 'sr-title' }, t('a11y.scale'))), label, range);
  scale.style.flexWrap = 'wrap';
  panel.append(scale);
  const locale = el('div', { class: 'field', style: { marginTop: '10px' } });
  const select = el('select', { class: 'select', 'aria-label': t('settings.language') });
  for (const item of LOCALES_FALLBACK) {
    const option = el('option', { value: item }, item.toUpperCase());
    if ((settings.locale || 'en') === item) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => saveSettings({ locale: select.value }, { quiet: true }).then(() => { toggleA11yPanel(); toggleA11yPanel(); }));
  locale.append(el('label', {}, t('settings.language')), select);
  panel.append(locale);
  panel.append(el('button', { class: 'btn btn-ghost btn-sm btn-block', style: { marginTop: '10px' }, onclick: () => { panel.hidden = true; openShortcuts(); } }, icon('keyboard'), t('a11y.shortcuts')));
  panel.hidden = false;
  hydrateIcons(panel);
}

const LOCALES_FALLBACK = ['en', 'es', 'hi', 'ar', 'zh', 'fr'];

function settingToggle(title, checked, onChange) {
  const row = el('div', { class: 'switch-row' });
  const body = el('div', { class: 'sr-body' }, el('div', { class: 'sr-title' }, title));
  row.append(body, (() => {
    const button = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(checked)), 'aria-label': title });
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return button;
  })());
  return row;
}

function openAuthDialog() {
  if ($('#auth-modal')) return;
  const body = el('div', { class: 'stack' });
  const base = el('div', { class: 'field' }, el('label', {}, 'Bridge URL'), el('input', { class: 'input', value: storage.get('api.base', location.origin), id: 'auth-base' }));
  const token = el('div', { class: 'field' }, el('label', {}, 'Bridge token'), el('input', { class: 'input', type: 'password', id: 'auth-token', placeholder: 'DEX_TOKEN', value: storage.get('api.token', '') }));
  body.append(el('p', { class: 'muted tiny-text' }, 'This bridge requires a token. Find it in the bridge startup output or run `android-dex doctor`.'), base, token);
  const foot = el('div', { class: 'row' });
  const connect = el('button', { class: 'btn btn-primary' }, icon('plug'), 'Connect');
  connect.addEventListener('click', () => {
    storage.set('api.base', base.querySelector('input').value.replace(/\/$/, ''));
    storage.set('api.token', token.querySelector('input').value.trim());
    location.reload();
  });
  foot.append(connect);
  openModal({ title: 'Bridge authentication', subtitle: 'Token required', body, footer: foot, small: true, labelledBy: 'auth-modal' });
  $('#modal-root .modal').id = 'auth-modal';
}
