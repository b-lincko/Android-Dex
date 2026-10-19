import {
  copyText, el, esc, fmtBytes, fmtDuration, fmtRelative, icon, openModal, openModal as _open, toast,
} from '../core.js';
import { t } from '../i18n.js';
import { act, button, card, emptyState, pageHead, refreshNote, settingLine, tabs, toggleRow } from './shared.js';

export function renderMedia(ctx) {
  const state = ctx.state;
  const media = state.media;
  const tab = ctx.viewState.mediaTab || 'playback';
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Media & IO',
    title: t('media.title'),
    subtitle: t('media.sub'),
    actions: [
      refreshNote(ctx),
      button(t('media.screenshot'), { iconName: 'camera', className: 'btn btn-sm', onClick: () => capture(ctx) }),
      button(media.recording?.active ? t('media.stop') : t('media.record'), {
        iconName: media.recording?.active ? 'square' : 'circle-dot',
        className: media.recording?.active ? 'btn btn-danger btn-sm' : 'btn btn-sm',
        onClick: () => toggleRecord(ctx),
      }),
    ].filter(Boolean),
  }));

  page.append(tabs([
    ['playback', t('media.nowPlaying')],
    ['routing', 'Audio & mic'],
    ['camera', t('media.virtualCamera')],
    ['capture', t('media.capture')],
    ['input', 'Gamepad & stylus'],
  ], tab, (next) => { ctx.setViewState({ mediaTab: next }); ctx.rerender(); }));

  if (tab === 'playback') page.append(renderPlayback(ctx));
  else if (tab === 'routing') page.append(renderRouting(ctx));
  else if (tab === 'camera') page.append(renderCamera(ctx));
  else if (tab === 'capture') page.append(renderCapture(ctx));
  else page.append(renderInput(ctx));
  return page;
}

function renderPlayback(ctx) {
  const media = ctx.state.media;
  const sessions = media.sessions || [];
  const active = sessions.find((session) => session.id === media.activeSessionId) || sessions[0];
  const grid = el('div', { class: 'media-grid' });

  if (active) {
    const player = el('div', { class: 'player-card' });
    const art = el('div', { class: 'art-lg', style: { background: `linear-gradient(140deg, ${active.color}44, ${active.color}11), radial-gradient(circle at 70% 20%, ${active.color}66, transparent 60%)` } });
    art.innerHTML = `<span class="art-glyph">${icon('music')}</span>`;
    player.append(art);
    const top = el('div', { class: 'player-top' });
    top.innerHTML = `<div><div class="card-sub">${esc(active.app)}</div><div class="pi-title">${esc(active.title)}</div><div class="dim">${esc(active.artist)}${active.album ? ` · ${esc(active.album)}` : ''}</div></div>
      <span class="pill ${active.playing ? 'ok' : ''}">${active.playing ? 'Playing' : 'Paused'}</span>`;
    player.append(top);

    const seek = el('input', {
      class: 'seek', type: 'range', min: '0', max: String(active.duration || 100), step: '1', value: String(Math.floor(active.position || 0)),
      'aria-label': 'Seek',
    });
    const times = el('div', { class: 'row between tiny-text dim' });
    const renderTimes = () => {
      times.innerHTML = `<span>${fmtDuration(Number(seek.value))}</span><span>${fmtDuration(active.duration)}</span>`;
    };
    renderTimes();
    seek.addEventListener('input', renderTimes);
    seek.addEventListener('change', async () => {
      try {
        await ctx.api.request('/api/media/control', { method: 'POST', body: { sessionId: active.id, action: 'seek', position: Number(seek.value) } });
        await ctx.api.refresh(); ctx.rerender();
      } catch (error) { ctx.toastError(error); }
    });
    player.append(seek, times);

    const controls = el('div', { class: 'player-controls' });
    controls.append(controlButton('shuffle', 'Shuffle', () => toast('Shuffle toggled on the phone')));
    controls.append(controlButton('skip-back', 'Previous', () => control(ctx, active, 'previous')));
    controls.append(controlButton(active.playing ? 'pause' : 'play', active.playing ? 'Pause' : 'Play', () => control(ctx, active, 'toggle'), true));
    controls.append(controlButton('skip-forward', 'Next', () => control(ctx, active, 'next')));
    controls.append(controlButton('repeat-2', 'Repeat', () => toast('Repeat toggled on the phone')));
    player.append(controls);

    const volume = el('div', { class: 'row between', style: { marginTop: '12px' } });
    const vol = el('input', { class: 'seek', type: 'range', min: '0', max: '100', value: String(ctx.state.media.volume ?? 60), 'aria-label': 'Volume' });
    vol.addEventListener('change', async () => {
      try { await ctx.api.request('/api/media/control', { method: 'POST', body: { sessionId: active.id, action: 'volume', volume: Number(vol.value) } }); await ctx.api.refresh(); } catch (error) { ctx.toastError(error); }
    });
    volume.innerHTML = `<span class="row tiny-text dim">${icon('volume-2')} ${t('media.outputVolume')}</span>`;
    volume.append(vol);
    player.append(volume);
    grid.append(player);
  } else {
    grid.append(card({ body: emptyState('music', 'Nothing is playing', 'Play something on the phone and it appears here.') }));
  }

  const sidebar = el('div', { class: 'stack' });
  const sessionCard = card({ iconName: 'layers', title: t('media.sessions'), body: el('div', { class: 'stack' }) });
  const listNode = sessionCard.querySelector('.stack');
  sessions.forEach((session) => {
    const row = el('button', { class: `mock-row ${session.id === active?.id ? 'is-active' : ''}`, style: { width: '100%', textAlign: 'left' } });
    row.innerHTML = `<span class="mock-tile" style="background:${session.color}22;color:${session.color};width:34px;height:34px">${icon('music')}</span>
      <span style="flex:1;min-width:0"><span class="pi-name">${esc(session.title)}</span><span class="pi-sub">${esc(session.app)} · ${esc(session.artist)}</span></span>
      <span class="tiny-text dim">${session.playing ? icon('volume-2') : icon('pause')}</span>`;
    row.addEventListener('click', async () => {
      try { await ctx.api.request('/api/media/control', { method: 'POST', body: { sessionId: session.id, action: 'focus' } }); await ctx.api.refresh(); ctx.rerender(); } catch (error) { ctx.toastError(error); }
    });
    listNode.append(row);
  });
  if (!sessions.length) listNode.append(el('div', { class: 'dim tiny-text' }, 'No sessions'));
  sidebar.append(sessionCard);
  const routingSummary = card({
    iconName: 'volume-2', title: t('media.audioOutput'),
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      [['desktop', t('media.desktop'), 'monitor'], ['headphones', t('media.headphones'), 'headphones'], ['android', t('media.android'), 'smartphone'], ['hdmi', t('media.hdmi'), 'tv']].forEach(([id, label, iconName]) => {
        const row = el('button', { class: `setting-line ${ctx.state.media.output === id ? 'is-selected' : ''}`, style: { width: '100%', textAlign: 'left' } });
        row.innerHTML = `<span class="sl-body"><span class="sl-title">${icon(iconName)} ${label}</span></span><span class="sl-control">${ctx.state.media.output === id ? '<span class="pill ok">active</span>' : ''}</span>`;
        row.addEventListener('click', async () => {
          try { await ctx.api.request('/api/media/route', { method: 'POST', body: { output: id } }); await ctx.api.refresh(); ctx.rerender(); toast(`Audio → ${label}`); } catch (error) { ctx.toastError(error); }
        });
        wrap.append(row);
      });
      return wrap;
    })(),
  });
  sidebar.append(routingSummary);
  grid.append(sidebar);
  return grid;
}

function controlButton(iconName, label, onClick, primary = false) {
  const node = el('button', { class: primary ? 'icon-btn primary' : 'icon-btn', title: label, 'aria-label': label });
  node.innerHTML = icon(iconName);
  node.addEventListener('click', onClick);
  return node;
}

async function control(ctx, session, action, extra = {}) {
  try {
    await ctx.api.request('/api/media/control', { method: 'POST', body: { sessionId: session.id, action, ...(typeof extra === 'object' ? extra : {}) } });
    await ctx.api.refresh(); ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

function renderRouting(ctx) {
  const media = ctx.state.media;
  const settings = ctx.state.settings;
  const grid = el('div', { class: 'grid cols-2' });
  grid.append(card({
    iconName: 'volume-2', title: t('media.audioOutput'),
    subtitle: 'Choose where Android audio is played. Switching keeps latency low.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      [['desktop', t('media.desktop'), 'monitor'], ['headphones', t('media.headphones'), 'headphones'], ['android', t('media.android'), 'smartphone'], ['hdmi', t('media.hdmi'), 'tv']].forEach(([id, label, iconName]) => {
        const row = el('button', { class: `setting-line ${media.output === id ? 'is-selected' : ''}`, style: { width: '100%', textAlign: 'left' } });
        row.innerHTML = `<span class="sl-body"><span class="sl-title">${icon(iconName)} ${label}</span></span><span class="sl-control">${media.output === id ? '<span class="pill ok">active</span>' : '<span class="dim tiny-text">switch</span>'}</span>`;
        row.addEventListener('click', async () => {
          try { await ctx.api.request('/api/media/route', { method: 'POST', body: { output: id } }); await ctx.api.refresh(); ctx.rerender(); toast(`Audio routed to ${label}`); } catch (error) { ctx.toastError(error); }
        });
        wrap.append(row);
      });
      wrap.append(toggleRow('Mute Android audio', 'Keep the stream quiet while you are on a call.', media.muted, (value) => act(ctx, () => ctx.api.request('/api/media/control', { method: 'POST', body: { action: 'mute', muted: value } }), { success: value ? 'Muted' : 'Unmuted' })));
      return wrap;
    })(),
  }));

  const micCard = card({
    iconName: 'mic', title: t('media.mic'), subtitle: t('media.micDesc'),
    body: (() => {
      const wrap = el('div');
      wrap.append(toggleRow('Microphone passthrough', settings.micPassthrough ? 'Desktop audio input is forwarded to Android.' : 'Android uses its own microphone.', settings.micPassthrough, (value) => act(ctx, () => ctx.api.request('/api/media/mic', { method: 'POST', body: { enabled: value } }), { success: value ? 'Mic passthrough on' : 'Mic passthrough off' })));
      const gain = el('div', { class: 'field' });
      gain.innerHTML = `<label>${icon('gauge')} Gain <span class="dim">${media.micGain ?? 55}%</span></label>`;
      const slider = el('input', { type: 'range', min: '0', max: '100', value: String(media.micGain ?? 55), class: 'seek' });
      slider.addEventListener('change', () => act(ctx, () => ctx.api.request('/api/media/mic', { method: 'POST', body: { enabled: true, gain: Number(slider.value) } }), { success: 'Gain updated' }));
      gain.append(slider);
      wrap.append(gain);
      const meter = el('div', { class: 'meter', title: 'Input level' });
      for (let i = 0; i < 18; i += 1) meter.append(el('span', { class: i < 9 ? 'on' : '' }));
      wrap.append(el('div', { class: 'tiny-text dim', style: { margin: '6px 0 4px' } }, 'Input level'), meter);
      wrap.append(el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button('Test tone', { iconName: 'play', className: 'btn btn-sm', onClick: () => toast('Test tone played through the phone') }),
        button('Select device', { iconName: 'headphones', className: 'btn btn-sm', onClick: () => toast(`Host device: ${settings.hostMicDevice || 'default input'}`) })));
      return wrap;
    })(),
  });
  grid.append(micCard);
  return grid;
}

function renderCamera(ctx) {
  const media = ctx.state.media;
  const preview = el('div', { class: 'video-preview' });
  const img = el('img', { src: ctx.mediaLatestUrl(), alt: 'Virtual camera preview' });
  preview.append(img);
  preview.append(el('span', { class: 'vp-tag' }, `${media.webcamFps || 30} fps · MJPEG`));
  if (!media.virtualCamera) {
    const overlay = el('div', { class: 'mirror-backdrop-note' });
    overlay.innerHTML = `${icon('video-off')}<div>Virtual camera is off</div>`;
    preview.append(overlay);
  }
  const cardNode = card({
    iconName: 'video', title: t('media.virtualCamera'), subtitle: t('media.virtualCamDesc'),
    body: el('div', {},
      preview,
      toggleRow('Expose virtual camera', 'Registers an MJPEG device that Zoom, Teams, OBS and browsers can pick up.', media.virtualCamera, (value) => act(ctx, () => ctx.api.request('/api/media/webcam', { method: 'POST', body: { enabled: value } }), { success: value ? t('media.virtualCamOn') : 'Virtual camera off' })),
      el('div', { class: 'row wrap', style: { marginTop: '10px' } },
        button(t('media.openObs'), { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(ctx.api.streamUrl()) }),
        button('Open stream', { iconName: 'external-link', className: 'btn btn-sm', onClick: () => window.open(ctx.api.streamUrl(), '_blank', 'noopener') }),
        button('Frame source', { iconName: 'camera', className: 'btn btn-sm', onClick: () => toast('Camera source: back wide · auto exposure') }))),
  });
  const info = card({
    iconName: 'info', title: 'How to use it',
    body: el('div', { class: 'stack tiny-text' },
      el('div', { class: 'mock-row' }, el('span', { class: 'step-n' }, '1'), el('span', {}, 'Turn the camera on here.')),
      el('div', { class: 'mock-row' }, el('span', { class: 'step-n' }, '2'), el('span', {}, `Point your video app at "${settingsName(ctx)}".`)),
      el('div', { class: 'mock-row' }, el('span', { class: 'step-n' }, '3'), el('span', {}, 'Latency is 120–200 ms on LAN at 720p; lower the FPS for slower links.'))),
  });
  return el('div', { class: 'grid cols-2' }, cardNode, info);
}

function settingsName(ctx) { return ctx.mode() === 'live' ? 'Android DEX Camera' : 'Android DEX Camera (demo)'; }

function renderCapture(ctx) {
  const grid = el('div', { class: 'grid cols-2' });
  const captureCard = card({
    iconName: 'camera', title: t('media.capture'), subtitle: 'Screenshots and recordings are saved to the shared folder.',
    body: el('div', {},
      el('div', { class: 'capture-grid' },
        (() => {
          const node = el('button', { class: 'capture' });
          node.innerHTML = `${icon('camera')}<span>${t('media.screenshot')}</span><span class="cap-meta">Ctrl+Shift+1</span>`;
          node.addEventListener('click', () => capture(ctx));
          return node;
        })(),
        (() => {
          const recording = ctx.state.media.recording?.active;
          const node = el('button', { class: `capture ${recording ? 'is-recording' : ''}` });
          node.innerHTML = `${icon(recording ? 'square' : 'circle-dot')}<span>${recording ? t('media.stop') : t('media.record')}</span><span class="cap-meta">Ctrl+Shift+2</span>`;
          node.addEventListener('click', () => toggleRecord(ctx));
          return node;
        })()),
      el('p', { class: 'dim tiny-text' }, 'Screenshots land in Screenshots/; recordings in Recordings/. Both are available over WebDAV.'),
      el('div', { class: 'row wrap' },
        button('Screenshot gallery', { iconName: 'images', className: 'btn btn-sm', onClick: () => showGallery(ctx, 'shots') }),
        button('Recordings', { iconName: 'video', className: 'btn btn-sm', onClick: () => showGallery(ctx, 'records') })),
    ),
  });
  grid.append(captureCard);
  const shortcuts = card({
    iconName: 'keyboard', title: 'Hotkeys',
    body: el('div', { class: 'stack' },
      ...(ctx.state.settings.hotkeys ? Object.entries(ctx.state.settings.hotkeys).filter(([action]) => /capture|record/.test(action)).map(([action, accel]) => el('div', { class: 'hotkey-row' }, el('span', {}, action), el('kbd', {}, accel))) : [el('div', { class: 'dim tiny-text' }, 'Configure hotkeys in Settings → Keyboard.')])),
  });
  grid.append(shortcuts);
  return grid;
}

async function capture(ctx) {
  try {
    const result = await ctx.api.request('/api/capture/screenshot', { method: 'POST', body: { mode: 'full' } });
    toast(`${t('toast.screenshot')} · ${result.file?.name || result.name || 'screenshot.png'}`);
    await ctx.api.refresh().catch(() => {});
    ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

async function toggleRecord(ctx) {
  const active = ctx.state.media.recording?.active;
  try {
    if (active) {
      const result = await ctx.api.request('/api/capture/record/stop', { method: 'POST', body: {} });
      toast(`Recording saved · ${result.recording?.name || result.name || ''} (${result.recording?.durationSec || result.durationSec || 0}s)`);
    } else {
      await ctx.api.request('/api/capture/record/start', { method: 'POST', body: { mode: 'screen' } });
      toast('Recording started');
    }
    await ctx.api.refresh(); ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

async function showGallery(ctx, kind) {
  try {
    const data = await ctx.api.request(kind === 'shots' ? '/api/capture/shots' : '/api/capture/records');
    const items = data.screenshots || data.recordings || [];
    const body = el('div');
    if (!items.length) body.append(emptyState('images', t('media.noShots')));
    else {
      const grid = el('div', { class: 'capture-grid' });
      items.forEach((item) => {
        const node = el('button', { class: 'capture' });
        node.innerHTML = `${icon(kind === 'shots' ? 'image' : 'video')}<span>${esc(item.name)}</span><span class="cap-meta">${fmtBytes(item.size)} · ${fmtRelative(item.modified)}</span>`;
        node.addEventListener('click', () => window.open(ctx.downloadUrl(item.path), '_blank', 'noopener'));
        grid.append(node);
      });
      body.append(grid);
    }
    openModal({ title: kind === 'shots' ? 'Screenshot gallery' : 'Recordings', body, wide: true });
  } catch (error) { ctx.toastError(error); }
}

function renderInput(ctx) {
  const state = ctx.state;
  const grid = el('div', { class: 'grid cols-2' });
  const padCard = card({
    iconName: 'gamepad-2', title: t('media.gamepad'), subtitle: 'Xbox, DualSense and 8BitDo controllers map to Android touch events.',
    body: (() => {
      const wrap = el('div');
      wrap.append(toggleRow('Controller passthrough', state.input?.gamepad?.connected ? 'Controller connected' : 'Connect a controller to the desktop.', Boolean(state.input?.gamepad?.passthrough), (value) => act(ctx, () => ctx.api.request('/api/input/gamepad', { method: 'POST', body: { connected: true, passthrough: value, buttons: 0, axes: [0, 0, 0, 0] } }), { success: value ? 'Passthrough on' : 'Passthrough off' })));
      const viz = el('div', { class: 'gamepad-viz' });
      viz.innerHTML = `<span class="dpad" aria-hidden="true">${icon('plus')}</span><span class="ck" data-btn="a">A</span><span class="ck" data-btn="b">B</span><span class="ck" data-btn="x">X</span><span class="ck" data-btn="y">Y</span><span class="ck" data-btn="lb">LB</span><span class="ck" data-btn="rb">RB</span>`;
      wrap.append(viz);
      wrap.append(el('div', { class: 'dim tiny-text', style: { marginTop: '8px' } }, state.input?.gamepad?.connected ? `Detected: ${state.input.gamepad.id || 'Generic XInput'}` : 'No controller detected — plug one in and press a button.'));
      return wrap;
    })(),
  });
  grid.append(padCard);

  const stylusCard = card({
    iconName: 'pen-tool', title: t('media.stylus'), subtitle: t('media.stylusHint'),
    body: (() => {
      const canvas = el('canvas', { width: '560', height: '220', class: 'pad-lg', style: { width: '100%', height: '220px', touchAction: 'none' } });
      const ctx2d = canvas.getContext?.('2d');
      if (!ctx2d) return el('div', { class: 'empty' }, icon('pen-tool'), el('h3', {}, 'Stylus test pad unavailable'), el('p', {}, 'This browser does not expose a 2D canvas.'));
      ctx2d.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#111';
      ctx2d.fillRect(0, 0, 560, 220);
      let drawing = false;
      let lastPressure = 0;
      const pos = (event) => {
        const rect = canvas.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * (560 / rect.width), y: (event.clientY - rect.top) * (220 / rect.height) };
      };
      const draw = (event) => {
        if (!drawing) return;
        const { x, y } = pos(event);
        const pressure = event.pointerType === 'pen' ? event.pressure || 0.4 : 0.55;
        ctx2d.strokeStyle = 'var(--accent)';
        ctx2d.strokeStyle = '#3ddc84';
        ctx2d.lineWidth = 1 + pressure * 9;
        ctx2d.lineCap = 'round';
        ctx2d.lineTo(x, y);
        ctx2d.stroke();
        lastPressure = Math.round(pressure * 100);
        const label = document.querySelector('#stylus-pressure');
        if (label) label.textContent = `${lastPressure}%`;
        ctx.api.request('/api/input/stylus', { method: 'POST', body: { pressure: Number(pressure.toFixed(3)), tiltX: event.tiltX || 0, tiltY: event.tiltY || 0, active: true } }).catch(() => {});
      };
      canvas.addEventListener('pointerdown', (event) => {
        drawing = true;
        const { x, y } = pos(event);
        ctx2d.beginPath();
        ctx2d.moveTo(x, y);
        canvas.setPointerCapture?.(event.pointerId);
      });
      canvas.addEventListener('pointermove', draw);
      canvas.addEventListener('pointerup', () => {
        drawing = false;
        ctx.api.request('/api/input/stylus', { method: 'POST', body: { pressure: 0, active: false } }).catch(() => {});
      });
      const wrap = el('div');
      wrap.append(canvas);
      const meterRow = el('div', { class: 'row between tiny-text dim' });
      meterRow.innerHTML = `<span>${icon('pen-tool')} Pressure <strong id="stylus-pressure">0%</strong></span><span>${state.input?.stylus?.strokes || 0} strokes sent</span>`;
      wrap.append(meterRow);
      wrap.append(toggleRow('Stylus pressure', 'Forward pressure and tilt to Android.', Boolean(ctx.state.settings.stylusPressure), (value) => ctx.saveSettings({ stylusPressure: value })));
      return wrap;
    })(),
  });
  grid.append(stylusCard);
  return grid;
}
