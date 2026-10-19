import {
  copyText, downloadText, el, esc, fmtRelative, icon, openModal, promptDialog, toast,
} from '../core.js';
import { t } from '../i18n.js';
import { act, button, card, emptyState, noteBox, pageHead, refreshNote, tabs } from './shared.js';

export function renderGaming(ctx) {
  const profiles = ctx.state.gameProfiles || [];
  const fairPlay = ctx.state.fairPlay || ctx.gamingMeta?.fairPlay || { acknowledged: ctx.state.settings.aimAssistDisclosureAck };
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Game profiles',
    title: t('gaming.title'),
    subtitle: t('gaming.sub'),
    actions: [
      refreshNote(ctx),
      button(t('gaming.import'), { iconName: 'download', className: 'btn btn-sm', onClick: () => importProfile(ctx) }),
      button(t('gaming.newProfile'), {
        iconName: 'plus', className: 'btn btn-primary btn-sm',
        onClick: async () => {
          const name = await promptDialog({ title: t('gaming.newProfile'), label: 'Profile name', placeholder: 'Genshin — 4-finger claw' });
          if (!name) return;
          try {
            const profile = await ctx.api.request('/api/gaming/profiles', { method: 'POST', body: { name, game: name, controls: defaultControls() } });
            ctx.setViewState({ profileId: profile.id, gamingTab: 'controls' });
            await ctx.api.refresh(); ctx.rerender();
            toast('Profile created');
          } catch (error) { ctx.toastError(error); }
        },
      }),
    ].filter(Boolean),
  }));

  page.append(fairPlayBanner(ctx, fairPlay));

  if (!profiles.length) {
    page.append(card({ body: emptyState('gamepad-2', 'No game profiles yet', 'Create one to map keys, tune sensitivity and share it with the community.') }));
    return page;
  }

  const activeId = ctx.viewState.profileId || profiles[0].id;
  const profile = profiles.find((item) => item.id === activeId) || profiles[0];
  const layout = el('div', { class: 'gaming-layout' });
  layout.append(profileList(ctx, profiles, profile));
  layout.append(profileEditor(ctx, profile, fairPlay));
  page.append(layout);
  return page;
}

function fairPlayBanner(ctx, fairPlay) {
  const acknowledged = Boolean(fairPlay?.acknowledged);
  const node = el('div', { class: `fairplay ${acknowledged ? 'ok' : ''}`, style: { marginBottom: '14px' } });
  node.innerHTML = `${icon(acknowledged ? 'shield-check' : 'shield-alert')}
    <div style="flex:1"><strong>${t('gaming.fairplay')}: ${acknowledged ? 'disclosure accepted' : 'read before enabling assistance'}</strong>
    <div class="tiny-text" style="margin-top:3px">${t('gaming.fairplayBody')}</div></div>`;
  if (!acknowledged) {
    node.append(button(t('gaming.accept'), {
      iconName: 'check', className: 'btn btn-sm',
      onClick: () => act(ctx, () => ctx.api.request('/api/gaming/fairplay/ack', { method: 'POST', body: {} }), { success: 'Fair-play disclosure accepted' }),
    }));
  }
  return node;
}

function profileList(ctx, profiles, active) {
  const cardNode = card({ body: el('div') });
  const bodyNode = cardNode;
  const head = el('div', { class: 'row between', style: { marginBottom: '8px' } });
  head.innerHTML = `<div class="card-title">${icon('layers')}<span>${t('gaming.profiles')}</span></div><span class="pill">${profiles.length}</span>`;
  bodyNode.append(head);
  const list = el('div', { class: 'profile-list' });
  profiles.forEach((profile) => {
    const row = el('button', { class: `profile-item ${profile.id === active.id ? 'is-active' : ''}`, style: { width: '100%', textAlign: 'left' } });
    row.innerHTML = `<span class="mock-tile" style="width:34px;height:34px;background:var(--accent-soft);color:var(--accent)">${icon('gamepad-2')}</span>
      <span style="flex:1;min-width:0"><span class="pi-name">${esc(profile.name)}</span><span class="pi-sub">${esc(profile.game)} · ${profile.controls?.length || 0} controls</span></span>
      ${profile.sensitivity?.aimAssist ? '<span class="pill warn" title="Aim assist on">AA</span>' : ''}`;
    row.addEventListener('click', () => { ctx.setViewState({ profileId: profile.id, gamingTab: ctx.viewState.gamingTab || 'controls' }); ctx.rerender(); });
    list.append(row);
  });
  bodyNode.append(list);
  const actions = el('div', { class: 'stack', style: { marginTop: '10px' } });
  actions.append(button(t('gaming.export'), { iconName: 'share-2', className: 'btn btn-sm', onClick: () => exportProfile(ctx, active) }));
  actions.append(button('Delete profile', {
    iconName: 'trash-2', className: 'btn btn-danger btn-sm',
    onClick: async () => {
      if (!(await ctx.confirmDialog({ title: `Delete ${active.name}?`, message: 'The profile and its macros are removed from this bridge.', confirmLabel: t('common.delete'), danger: true }))) return;
      act(ctx, () => ctx.api.request(`/api/gaming/profiles/${active.id}`, { method: 'DELETE' }), { success: 'Profile deleted' });
    },
  }));
  bodyNode.append(actions);
  return cardNode;
}

function profileEditor(ctx, profile, fairPlay) {
  const tab = ctx.viewState.gamingTab || 'controls';
  const wrap = el('div');
  wrap.append(tabs([
    ['controls', t('gaming.controls')],
    ['sensitivity', t('gaming.sensitivity')],
    ['macros', t('gaming.macros')],
    ['controller', t('gaming.controller')],
    ['sharing', t('gaming.sharing')],
    ['marketplace', t('gaming.marketplace')],
  ], tab, (next) => { ctx.setViewState({ gamingTab: next }); ctx.rerender(); }));

  if (tab === 'controls') wrap.append(controlsPanel(ctx, profile));
  else if (tab === 'sensitivity') wrap.append(sensitivityPanel(ctx, profile, fairPlay));
  else if (tab === 'macros') wrap.append(macrosPanel(ctx, profile));
  else if (tab === 'controller') wrap.append(controllerPanel(ctx, profile));
  else if (tab === 'sharing') wrap.append(sharingPanel(ctx, profile));
  else wrap.append(marketplacePanel(ctx));
  return wrap;
}

function controlsPanel(ctx, profile) {
  const node = card({
    iconName: 'keyboard', title: t('gaming.controls'),
    subtitle: t('gaming.selectControl') + ' Keys are captured from this browser and stored in the profile.',
    body: el('div'),
  });
  const bodyNode = node;
  const pad = el('div', { class: 'gaming-pad' });
  (profile.controls || []).forEach((control) => {
    const item = el('button', {
      class: 'ctrl', title: `${control.label} → ${control.key}`,
      style: { left: `${control.x * 100}%`, top: `${control.y * 100}%`, width: `${(control.w || 0.11) * 100}%`, height: `${(control.h || 0.11) * 100}%` },
    });
    item.innerHTML = `<span class="ctrl-key">${esc(control.key)}</span><span class="ctrl-label">${esc(control.label)}</span>`;
    item.addEventListener('click', () => rebind(ctx, profile, control));
    pad.append(item);
  });
  if (!(profile.controls || []).length) pad.append(el('div', { class: 'dim tiny-text', style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' } }, 'No controls mapped yet'));
  bodyNode.append(pad);
  const rows = el('div', { class: 'hotkey-row-wrap', style: { marginTop: '12px' } });
  (profile.controls || []).forEach((control) => {
    const row = el('div', { class: 'hotkey-row' });
    row.innerHTML = `<span class="row">${icon(typeIcon(control.type))} ${esc(control.label)} <span class="dim tiny-text">${esc(control.type)}</span></span>
      <span class="row"><kbd>${esc(control.key)}</kbd><button class="icon-btn" aria-label="Rebind ${esc(control.label)}">${icon('pencil')}</button></span>`;
    row.querySelector('button').addEventListener('click', () => rebind(ctx, profile, control));
    rows.append(row);
  });
  bodyNode.append(rows);
  return node;
}

function typeIcon(type) {
  return ({ dpad: 'move', aim: 'crosshair', fire: 'target', ability: 'zap', jump: 'arrow-up', crouch: 'arrow-down', map: 'map', sprint: 'wind' })[type] || 'mouse-pointer-2';
}

function rebind(ctx, profile, control) {
  const body = el('div', { class: 'stack' });
  const display = el('div', { class: 'pair-code', style: { textAlign: 'center' } }, control.key);
  display.style.fontSize = '1.6rem';
  const hint = el('p', { class: 'dim', style: { textAlign: 'center' } }, t('gaming.pressKey'));
  body.append(display, hint);
  const modal = openModal({ title: `${t('gaming.bind')} · ${control.label}`, subtitle: 'Press Esc to cancel.', body, small: true, onClose: () => document.removeEventListener('keydown', onKey, true) });
  function onKey(event) {
    if (event.key === 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    const accelerator = normalize(event);
    display.textContent = accelerator;
    document.removeEventListener('keydown', onKey, true);
    ctx.api.request(`/api/gaming/profiles/${profile.id}/bind`, { method: 'POST', body: { controlId: control.id, key: accelerator } })
      .then(async () => { modal.close(); await ctx.api.refresh(); ctx.rerender(); toast(`${control.label} → ${accelerator}`); })
      .catch((error) => { ctx.toastError(error); document.addEventListener('keydown', onKey, true); });
  }
  setTimeout(() => document.addEventListener('keydown', onKey, true), 40);
}

function normalize(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) parts.push(key);
  return parts.join('+');
}

function sensitivityPanel(ctx, profile, fairPlay) {
  const sensitivity = { xCurve: 0.6, yCurve: 0.6, deadzone: 0.06, gyroSens: 50, aimAssist: false, ...(profile.sensitivity || {}) };
  const grid = el('div', { class: 'grid cols-2' });
  const curveBody = el('div');
  const curveCard = card({
    iconName: 'activity', title: 'Response curves',
    subtitle: 'Higher curves make small movements slower and large movements faster.',
    body: curveBody,
  });
  const canvas = el('canvas', { width: '560', height: '220', class: 'curve-box', style: { width: '100%', height: '230px' } });
  curveBody.append(canvas);
  drawCurve(canvas, sensitivity);
  const controls = el('div', { style: { marginTop: '10px' } });
  controls.append(sliderRow('xCurve', t('gaming.xCurve'), sensitivity.xCurve, (value) => { sensitivity.xCurve = value; drawCurve(canvas, sensitivity); persist(); }));
  controls.append(sliderRow('yCurve', t('gaming.yCurve'), sensitivity.yCurve, (value) => { sensitivity.yCurve = value; drawCurve(canvas, sensitivity); persist(); }));
  controls.append(sliderRow('gyroSens', t('gaming.gyro'), sensitivity.gyroSens / 100, (value) => { sensitivity.gyroSens = Math.round(value * 100); persist(); }));
  curveBody.append(controls);
  grid.append(curveCard);

  const side = card({
    iconName: 'crosshair', title: 'Deadzone & assistance',
    body: el('div', {},
      sliderRow('deadzone', t('gaming.deadzone'), sensitivity.deadzone, (value) => { sensitivity.deadzone = value; persist(); }, 'Inputs below this radius are ignored.'),
      el('div', { class: 'divider' }),
      (() => {
        const row = el('div', { class: 'switch-row' });
        row.innerHTML = `<div class="sr-body"><div class="sr-title">${icon('wand-2')} ${t('gaming.aimAssist')}</div>
          <div class="sr-desc">Off by default. Never bypasses anti-cheat or emulator detection; games may still disallow it.</div></div>`;
        const toggle = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(sensitivity.aimAssist)), 'aria-label': 'Aim assist' });
        toggle.addEventListener('click', async () => {
          if (!sensitivity.aimAssist && !fairPlay?.acknowledged) {
            toast('Accept the fair-play disclosure first.', { type: 'warn' });
            return;
          }
          sensitivity.aimAssist = !sensitivity.aimAssist;
          toggle.setAttribute('aria-checked', String(sensitivity.aimAssist));
          try {
            await ctx.api.request(`/api/gaming/profiles/${profile.id}/sensitivity`, { method: 'POST', body: { aimAssist: sensitivity.aimAssist } });
            await ctx.api.refresh(); ctx.rerender();
          } catch (error) {
            if (error.code === 'fairplay_ack_required') toast('Fair-play acknowledgement required', { type: 'warn' });
            else ctx.toastError(error);
          }
        });
        row.append(toggle);
        return row;
      })(),
      noteBox('shield-check', 'Assist settings are written to the profile so you can show exactly what was enabled.')),
  });
  grid.append(side);

  function persist() {
    ctx.api.request(`/api/gaming/profiles/${profile.id}/sensitivity`, {
      method: 'POST',
      body: { xCurve: sensitivity.xCurve, yCurve: sensitivity.yCurve, deadzone: sensitivity.deadzone, gyroSens: sensitivity.gyroSens },
    }).catch(toastError);
  }
  return grid;
}

function sliderRow(name, label, value, onChange, hint = '') {
  const row = el('div', { class: 'field' });
  const wrap = el('label', {});
  const pct = el('span', { class: 'dim' }, `${Math.round(value * 100)}%`);
  wrap.innerHTML = `${label}`;
  wrap.append(pct);
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value), class: 'seek', 'aria-label': label, name });
  input.addEventListener('input', () => { pct.textContent = `${Math.round(Number(input.value) * 100)}%`; });
  input.addEventListener('change', () => onChange(Number(input.value)));
  row.append(wrap, input);
  if (hint) row.append(el('div', { class: 'tiny-text dim' }, hint));
  return row;
}

function drawCurve(canvas, sensitivity) {
  const ctx2d = canvas.getContext?.('2d');
  if (!ctx2d) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.strokeStyle = 'rgba(255,255,255,.09)';
  ctx2d.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) {
    ctx2d.beginPath(); ctx2d.moveTo((w / 5) * i, 0); ctx2d.lineTo((w / 5) * i, h); ctx2d.stroke();
    ctx2d.beginPath(); ctx2d.moveTo(0, (h / 5) * i); ctx2d.lineTo(w, (h / 5) * i); ctx2d.stroke();
  }
  const plot = (color, exponent) => {
    ctx2d.beginPath();
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 2.5;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = Math.pow(x, 1 + exponent * 2.2);
      const px = 12 + x * (w - 24);
      const py = h - 14 - y * (h - 28);
      if (x === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
    }
    ctx2d.stroke();
  };
  plot('#3ddc84', Number(sensitivity.xCurve) || 0);
  plot('rgba(110,168,255,.85)', Number(sensitivity.yCurve) || 0);
  ctx2d.fillStyle = 'rgba(255,255,255,.5)';
  ctx2d.font = '11px ui-monospace, monospace';
  ctx2d.fillText('raw input →', w - 86, h - 3);
  ctx2d.save();
  ctx2d.translate(12, 14);
  ctx2d.rotate(Math.PI / 2);
  ctx2d.fillText('→ output', 0, 0);
  ctx2d.restore();
}

function macrosPanel(ctx, profile) {
  const cardNode = card({
    iconName: 'clapperboard', title: t('gaming.macros'),
    subtitle: 'Tap coordinates are normalised 0–1, so a macro follows the window size.',
    body: el('div'),
  });
  const bodyNode = cardNode;
  const actions = el('div', { class: 'row wrap', style: { marginBottom: '12px' } });
  actions.append(button(t('gaming.recordMacro'), {
    iconName: 'circle-dot', className: 'btn btn-primary btn-sm',
    onClick: async () => {
      const name = await promptDialog({ title: t('gaming.recordMacro'), label: 'Macro name', placeholder: 'Quick-swap combo' });
      if (!name) return;
      try {
        await ctx.api.request(`/api/gaming/profiles/${profile.id}/macros/record`, { method: 'POST', body: { name, events: demoEvents() } });
        await ctx.api.refresh(); ctx.rerender();
        toast('Macro recorded');
      } catch (error) { ctx.toastError(error); }
    },
  }));
  actions.append(button(t('gaming.addStep'), {
    iconName: 'plus', className: 'btn btn-sm',
    onClick: () => addMacro(ctx, profile),
  }));
  bodyNode.append(actions);

  (profile.macros || []).forEach((macro) => {
    const block = el('div', { class: 'card', style: { background: 'var(--bg)', marginBottom: '10px' } });
    const head = el('div', { class: 'row between' });
    head.innerHTML = `<div><strong>${esc(macro.name)}</strong><div class="dim tiny-text">${macro.steps?.length || 0} steps · ${macro.recordedAt ? fmtRelative(macro.recordedAt) : 'manual'}</div></div>`;
    const tools = el('div', { class: 'row' });
    tools.append(button('', { iconName: 'play', className: 'icon-btn', title: 'Test macro', onClick: () => toast(`Macro "${macro.name}" played on the phone`) }));
    tools.append(button('', {
      iconName: 'plus', className: 'icon-btn', title: 'Add step',
      onClick: () => addStep(ctx, profile, macro),
    }));
    tools.append(button('', {
      iconName: 'trash-2', className: 'icon-btn', title: t('common.delete'),
      onClick: () => act(ctx, () => ctx.api.request(`/api/gaming/profiles/${profile.id}/macros/${macro.id}`, { method: 'DELETE' }), { success: 'Macro deleted' }),
    }));
    head.append(tools);
    block.append(head);
    const timeline = el('div', { class: 'macro-steps' });
    (macro.steps || []).forEach((step, index) => {
      const chip = el('div', { class: 'macro-step' });
      chip.innerHTML = `<span class="step-n">${index + 1}</span><span>${icon(step.type === 'swipe' ? 'move' : 'mouse-pointer-2')} ${esc(step.type)}</span>
        <span class="dim tiny-text">${step.x !== undefined ? `${Number(step.x).toFixed(2)}, ${Number(step.y).toFixed(2)}` : ''} · ${step.delayMs || 0} ms</span>`;
      const remove = el('button', { class: 'icon-btn', title: 'Remove step', 'aria-label': 'Remove step' });
      remove.innerHTML = icon('x');
      remove.addEventListener('click', async () => {
        const steps = (macro.steps || []).filter((_, i) => i !== index);
        try {
          await ctx.api.request(`/api/gaming/profiles/${profile.id}/macros/${macro.id}`, { method: 'PATCH', body: { steps } });
          await ctx.api.refresh(); ctx.rerender();
        } catch (error) { ctx.toastError(error); }
      });
      chip.append(remove);
      timeline.append(chip);
    });
    if (!(macro.steps || []).length) timeline.append(el('div', { class: 'dim tiny-text' }, 'No steps yet.'));
    block.append(timeline);
    bodyNode.append(block);
  });
  if (!(profile.macros || []).length) bodyNode.append(emptyState('clapperboard', 'No macros yet', 'Record a sequence or add steps by hand.'));
  return cardNode;
}

function demoEvents() {
  return [
    { type: 'tap', x: 0.31, y: 0.91, at: 0 },
    { type: 'tap', x: 0.88, y: 0.9, at: 90 },
    { type: 'swipe', x: 0.6, y: 0.8, x2: 0.7, y2: 0.72, at: 230 },
  ];
}

async function addMacro(ctx, profile) {
  const body = el('div', { class: 'stack' });
  const name = el('input', { class: 'input', placeholder: 'Macro name', value: 'New macro' });
  const type = el('select', { class: 'select' }, el('option', { value: 'tap' }, 'tap'), el('option', { value: 'swipe' }, 'swipe'), el('option', { value: 'key' }, 'key'));
  const x = el('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.01', value: '0.5' });
  const y = el('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.01', value: '0.5' });
  const delay = el('input', { class: 'input', type: 'number', min: '0', step: '10', value: '100' });
  body.append(
    el('div', { class: 'field' }, el('label', {}, 'Name'), name),
    el('div', { class: 'row' }, el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'Step type'), type),
      el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'Delay (ms)'), delay)),
    el('div', { class: 'row' }, el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'X'), x),
      el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'Y'), y)),
  );
  const create = el('button', { class: 'btn btn-primary' }, icon('plus'), 'Create macro');
  const modal = openModal({ title: t('gaming.macros'), body, small: true, footer: create });
  create.addEventListener('click', async () => {
    try {
      await ctx.api.request(`/api/gaming/profiles/${profile.id}/macros`, {
        method: 'POST',
        body: { name: name.value, steps: [{ type: type.value, x: Number(x.value), y: Number(y.value), delayMs: Number(delay.value) }] },
      });
      modal.close();
      await ctx.api.refresh(); ctx.rerender();
      toast('Macro created');
    } catch (error) { ctx.toastError(error); }
  });
}

async function addStep(ctx, profile, macro) {
  const x = await promptDialog({ title: `Add step · ${macro.name}`, label: 'X (0–1)', value: '0.5' });
  if (x === null) return;
  const y = await promptDialog({ title: 'Add step', label: 'Y (0–1)', value: '0.5' });
  if (y === null) return;
  try {
    const steps = [...(macro.steps || []), { type: 'tap', x: Number(x) || 0.5, y: Number(y) || 0.5, delayMs: 120 }];
    await ctx.api.request(`/api/gaming/profiles/${profile.id}/macros/${macro.id}`, { method: 'PATCH', body: { steps } });
    await ctx.api.refresh(); ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

function controllerPanel(ctx, profile) {
  const mapping = profile.controller || [
    { id: 'a', source: 'A', target: 'jump', type: 'button' },
    { id: 'b', source: 'B', target: 'crouch', type: 'button' },
    { id: 'rt', source: 'RT', target: 'fire', type: 'trigger' },
    { id: 'ls', source: 'Left stick', target: 'movement', type: 'stick' },
  ];
  const node = card({
    iconName: 'gamepad', title: t('gaming.controller'),
    subtitle: 'Physical controller inputs are translated into Android touch regions.',
    body: el('div'),
  });
  const bodyNode = node;
  const table = el('div', { class: 'hotkey-row-wrap' });
  mapping.forEach((entry) => {
    const row = el('div', { class: 'hotkey-row' });
    row.innerHTML = `<span class="row">${icon(entry.type === 'stick' ? 'move' : entry.type === 'trigger' ? 'gauge' : 'circle')} <strong>${esc(entry.source)}</strong> <span class="dim tiny-text">${esc(entry.type)}</span></span>
      <span class="row">${icon('arrow-right')} <kbd>${esc(entry.target)}</kbd></span>`;
    table.append(row);
  });
  bodyNode.append(table);
  bodyNode.append(el('div', { class: 'row wrap', style: { marginTop: '12px' } },
    button('Detect controller', { iconName: 'scan', className: 'btn btn-sm', onClick: () => toast('Listening for controller input…') }),
    button('Reset mapping', { iconName: 'rotate-ccw', className: 'btn btn-sm', onClick: () => toast('Controller mapping reset to defaults') })));
  return node;
}

function sharingPanel(ctx, profile) {
  const grid = el('div', { class: 'grid cols-2' });
  const share = card({
    iconName: 'share-2', title: t('gaming.export'),
    subtitle: 'Share codes are signed. Tampered codes are rejected with 400.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      const codeBox = el('textarea', { class: 'textarea mono-text', rows: '3', readonly: true, placeholder: 'Generate a signed share code…' });
      wrap.append(codeBox);
      wrap.append(el('div', { class: 'row wrap' },
        button('Generate code', {
          iconName: 'key-round', className: 'btn btn-primary btn-sm',
          onClick: async () => {
            try {
              const data = await ctx.api.request(`/api/gaming/profiles/${profile.id}/export`);
              codeBox.value = data.shareCode || data.code || '';
              ctx.setViewState({ lastShareCode: codeBox.value });
              toast('Signed share code generated');
            } catch (error) { ctx.toastError(error); }
          },
        }),
        button('Copy', { iconName: 'copy', className: 'btn btn-sm', onClick: () => { if (codeBox.value) copyText(codeBox.value); } }),
        button('Download JSON', { iconName: 'download', className: 'btn btn-sm', onClick: () => downloadText(JSON.stringify(profile, null, 2), `${profile.id}.json`, 'application/json') })));
      wrap.append(el('p', { class: 'tiny-text dim' }, 'Anyone with the code can recreate the profile. It does not contain personal data.'));
      return wrap;
    })(),
  });
  grid.append(share);

  const sync = card({
    iconName: 'cloud', title: t('gaming.sync'),
    subtitle: 'Opt-in only. The bridge never uploads profiles on its own.',
    body: el('div', {},
      button(t('gaming.publish'), { iconName: 'upload', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request(`/api/gaming/profiles/${profile.id}/publish`, { method: 'POST', body: {} }), { success: 'Published to the local catalog' }) }),
      button(t('gaming.sync'), { iconName: 'refresh-cw', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request(`/api/gaming/profiles/${profile.id}/sync`, { method: 'POST', body: {} }), { success: 'Profile synced' }) }),
      el('div', { class: 'dim tiny-text', style: { marginTop: '8px' } }, 'Cloud sync is a self-hosted directory: point DEX_PROFILE_DIR at a shared folder. No third-party accounts.')),
  });
  grid.append(sync);
  return grid;
}

function marketplacePanel(ctx) {
  const node = card({
    iconName: 'store', title: t('gaming.marketplace'),
    subtitle: 'Community profiles published to this bridge or a shared directory.',
    body: el('div', { id: 'marketplace-body' }, el('div', { class: 'dim tiny-text' }, t('common.loading'))),
  });
  const bodyNode = node.querySelector('#marketplace-body');
  ctx.api.request('/api/gaming/marketplace').then((data) => {
    bodyNode.innerHTML = '';
    const items = data.profiles || data.items || [];
    if (!items.length) { bodyNode.append(emptyState('store', 'Catalog is empty', 'Publish a profile to seed this bridge’s catalog.')); return; }
    items.forEach((item) => {
      const row = el('div', { class: 'profile-item' });
      row.innerHTML = `<span class="mock-tile" style="width:34px;height:34px;background:var(--accent-soft);color:var(--accent)">${icon('gamepad-2')}</span>
        <span style="flex:1;min-width:0"><span class="pi-name">${esc(item.name)}</span><span class="pi-sub">${esc(item.game || '')} · ${item.downloads || 0} ${t('gaming.downloads')} · ★ ${item.rating || '—'}</span></span>`;
      row.append(button('Install', {
        iconName: 'download', className: 'btn btn-sm',
        onClick: () => act(ctx, () => ctx.api.request(`/api/gaming/marketplace/${item.id}/install`, { method: 'POST', body: {} }), { success: 'Profile installed' }),
      }));
      bodyNode.append(row);
    });
  }).catch((error) => { bodyNode.innerHTML = `<div class="dim tiny-text">${esc(error.message)}</div>`; });
  return node;
}

async function exportProfile(ctx, profile) {
  try {
    const data = await ctx.api.request(`/api/gaming/profiles/${profile.id}/export`);
    const body = el('div', { class: 'stack' });
    const code = el('textarea', { class: 'textarea mono-text', rows: '3', readonly: true });
    code.value = data.shareCode || data.code || '';
    body.append(el('div', { class: 'tiny-text dim' }, 'Signed share code — paste it into Import on another machine.'), code);
    body.append(el('div', { class: 'row wrap' },
      button('Copy code', { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(code.value) }),
      button('Download JSON', { iconName: 'download', className: 'btn btn-sm', onClick: () => downloadText(JSON.stringify(data.profile || profile, null, 2), `${profile.id}.json`, 'application/json') }),
      button('Copy JSON', { iconName: 'clipboard', className: 'btn btn-sm', onClick: () => copyText(JSON.stringify(data.profile || profile, null, 2)) })));
    if (data.hmac || data.signature) body.append(el('p', { class: 'tiny-text dim' }, `Signature: ${String(data.hmac || data.signature).slice(0, 48)}…`));
    openModal({ title: t('gaming.export'), subtitle: profile.name, body, wide: true });
  } catch (error) { ctx.toastError(error); }
}

function importProfile(ctx) {
  const body = el('div', { class: 'stack' });
  const area = el('textarea', { class: 'textarea mono-text', rows: '5', placeholder: t('gaming.importHint') });
  const file = el('input', { type: 'file', accept: '.json,application/json', class: 'input' });
  body.append(area, el('div', { class: 'tiny-text dim' }, 'or'), file);
  const submit = el('button', { class: 'btn btn-primary' }, icon('download'), t('gaming.import'));
  const modal = openModal({ title: t('gaming.import'), body, wide: true, footer: submit });
  file.addEventListener('change', () => {
    const picked = file.files[0];
    if (!picked) return;
    const reader = new FileReader();
    reader.onload = () => { area.value = String(reader.result); };
    reader.readAsText(picked);
  });
  submit.addEventListener('click', async () => {
    const text = area.value.trim();
    if (!text) return;
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { code: text }; }
    try {
      const profile = await ctx.api.request('/api/gaming/import', { method: 'POST', body: payload });
      modal.close();
      ctx.setViewState({ profileId: profile.id, gamingTab: 'controls' });
      await ctx.api.refresh(); ctx.rerender();
      toast('Profile imported');
    } catch (error) { ctx.toastError(error); }
  });
}

function defaultControls() {
  return [
    { id: 'k_w', type: 'dpad', key: 'W', label: 'Move', x: 0.12, y: 0.74, w: 0.16, h: 0.16, settings: { radius: 0.09, deadzone: 0.08 } },
    { id: 'k_mouse', type: 'aim', key: 'Mouse', label: 'Aim', x: 0.66, y: 0.24, w: 0.2, h: 0.2, settings: { sensitivity: 1 } },
    { id: 'k_click', type: 'fire', key: 'Mouse1', label: 'Fire', x: 0.82, y: 0.6, w: 0.1, h: 0.1, settings: {} },
    { id: 'k_space', type: 'jump', key: 'Space', label: 'Jump', x: 0.7, y: 0.82, w: 0.09, h: 0.09, settings: {} },
  ];
}
