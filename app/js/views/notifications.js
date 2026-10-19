import { el, esc, fmtRelative, icon, openModal, toast } from '../core.js';
import { t } from '../i18n.js';
import { act, avatar, button, card, emptyState, pageHead, refreshNote, settingLine, toggleRow } from './shared.js';

export function renderNotifications(ctx) {
  const state = ctx.state;
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Notification center',
    title: t('notifications.title'),
    subtitle: t('notifications.sub'),
    actions: [
      refreshNote(ctx),
      button(t('notifications.test'), {
        iconName: 'bell-ring', className: 'btn btn-sm',
        onClick: async () => {
          try {
            await ctx.api.request('/api/notifications/test', { method: 'POST', body: { app: 'Messages', title: 'Priya Nair', body: 'The build finished — artifacts are attached.', icon: 'message-square', color: '#3ddc84' } });
            await ctx.api.refresh(); ctx.rerender();
            toast('Test notification delivered');
          } catch (error) { ctx.toastError(error); }
        },
      }),
      button(t('notifications.readAll'), {
        iconName: 'check-check', className: 'btn btn-sm',
        onClick: () => act(ctx, () => ctx.api.request('/api/notifications/read-all', { method: 'POST', body: {} }), { success: 'All caught up' }),
      }),
      button(t('notifications.clearAll'), {
        iconName: 'trash-2', className: 'btn btn-sm',
        onClick: async () => {
          if (!(await ctx.confirmDialog({ title: t('notifications.clearAll'), message: 'Dismiss every notification on the desktop. The phone is not affected.', confirmLabel: t('common.clear'), danger: true }))) return;
          act(ctx, () => ctx.api.request('/api/notifications', { method: 'DELETE' }), { success: 'Notifications cleared' });
        },
      }),
    ].filter(Boolean),
  }));

  const layout = el('div', { class: 'notif-layout' });
  const feed = card({ body: el('div') });
  const feedHead = el('div', { class: 'row between', style: { marginBottom: '10px' } });
  feedHead.innerHTML = `<div class="card-title">${icon('bell')}<span>${state.notifications.filter((item) => !item.read).length} unread</span></div>`;
  const search = el('input', { class: 'input', placeholder: 'Filter alerts', value: ctx.viewState.notifQuery || '', style: { maxWidth: '190px' } });
  feedHead.append(search);
  feed.append(feedHead);
  const list = el('div');
  feed.append(list);

  const draw = () => {
    list.innerHTML = '';
    const query = (ctx.viewState.notifQuery || '').toLowerCase();
    const items = state.notifications.filter((item) => `${item.app} ${item.title} ${item.body}`.toLowerCase().includes(query));
    if (!items.length) list.append(emptyState('bell-off', t('notifications.empty'), 'Alerts from the phone appear here the moment they arrive.'));
    items.forEach((note) => list.append(renderNotification(ctx, note, draw)));
    const unread = state.notifications.filter((item) => !item.read).length;
    feedHead.querySelector('.card-title span').textContent = `${unread} unread`;
  };
  search.addEventListener('input', () => { ctx.setViewState({ notifQuery: search.value }); draw(); });
  draw();
  layout.append(feed);

  const rail = el('div', { class: 'stack' });
  const dnd = card({
    iconName: 'moon', title: t('notifications.dnd'),
    subtitle: 'Synced both ways with the phone.',
    body: (() => {
      const body = el('div');
      const stateLine = el('div', { class: 'row between', style: { marginBottom: '8px' } });
      stateLine.innerHTML = `<span class="pill ${state.settings.dnd ? 'warn' : 'ok'}">${state.settings.dnd ? 'Do not disturb is on' : 'Notifications allowed'}</span>`;
      body.append(stateLine);
      body.append(toggleRow(
        t('notifications.dnd'),
        state.settings.dnd ? 'Calls and messages go straight to the phone.' : 'Alerts mirror to the desktop notification center.',
        state.settings.dnd,
        (value) => act(ctx, () => ctx.api.request('/api/notifications/dnd', { method: 'POST', body: { enabled: value } }), { success: value ? 'DND enabled' : 'DND disabled' }),
      ));
      return body;
    })(),
  });
  rail.append(dnd);

  const mirror = card({
    iconName: 'monitor', title: 'Desktop integration',
    body: el('div', {},
      toggleRow(t('notifications.mirror'), 'Uses the host notification centre where supported.', state.settings.mirrorToOsNotificationCenter, (value) => ctx.saveSettings({ mirrorToOsNotificationCenter: value })),
      toggleRow(t('settings.inlineReply'), 'Reply to SMS/RCS without opening the phone view.', state.settings.replyFromNotifications, (value) => ctx.saveSettings({ replyFromNotifications: value })),
      toggleRow('Play a sound', 'Honour the phone ringer mode.', state.settings.notificationSound !== false, (value) => ctx.saveSettings({ notificationSound: value })),
    ),
  });
  rail.append(mirror);

  rail.append(renderControlCenter(ctx));
  layout.append(rail);
  page.append(layout);
  return page;
}

function renderNotification(ctx, note, onChange) {
  const node = el('div', { class: `note ${note.read ? '' : 'unread'}` });
  const iconWrap = el('span', { class: 'note-icon', style: { background: note.color || '#3ddc84' } });
  iconWrap.innerHTML = icon(note.icon || 'bell');
  node.append(iconWrap);
  const main = el('div', { class: 'note-main' });
  main.innerHTML = `<div class="note-title">${esc(note.title)} <span class="pill" style="height:17px;font-size:.53rem">${esc(note.app)}</span></div>
    <div class="note-body">${esc(note.body)}</div>
    <div class="note-meta">${fmtRelative(note.ts)}</div>`;
  node.append(main);

  const actions = el('div', { class: 'note-actions' });
  (note.actions || []).forEach((action) => {
    if (action.reply) {
      actions.append(button(action.label || t('notifications.reply'), {
        iconName: 'reply', className: 'btn btn-sm',
        onClick: () => inlineReply(ctx, note, onChange),
      }));
    } else {
      actions.append(button(action.label || action.id, {
        iconName: action.icon || 'zap', className: 'btn btn-sm',
        onClick: async () => {
          try {
            await ctx.api.request(`/api/notifications/${note.id}/action`, { method: 'POST', body: { actionId: action.id } });
            toast(`Action "${action.label}" sent`);
            await ctx.api.refresh(); ctx.rerender();
          } catch (error) { ctx.toastError(error); }
        },
      }));
    }
  });
  if (!note.read) {
    actions.append(button(t('notifications.markRead'), {
      iconName: 'check', className: 'btn btn-sm',
      onClick: async () => {
        try { await ctx.api.request(`/api/notifications/${note.id}/read`, { method: 'POST', body: {} }); await ctx.api.refresh(); ctx.rerender(); } catch (error) { ctx.toastError(error); }
      },
    }));
  }
  actions.append(button('', {
    iconName: 'x', className: 'icon-btn', title: t('common.dismiss'),
    onClick: async () => {
      try { await ctx.api.request(`/api/notifications/${note.id}`, { method: 'DELETE' }); await ctx.api.refresh(); ctx.rerender(); } catch (error) { ctx.toastError(error); }
    },
  }));
  node.append(actions);
  return node;
}

function inlineReply(ctx, note, onChange) {
  const body = el('div', { class: 'stack' });
  const meta = el('div', { class: 'row' });
  meta.append(avatar(note.title, note.color, 34));
  meta.append(el('div', { class: 'dim tiny-text' }, `${note.app} · ${fmtRelative(note.ts)}`));
  const input = el('textarea', { class: 'textarea', placeholder: t('notifications.replyPlaceholder'), rows: '3' });
  body.append(meta, input);
  const send = button(t('phone.send'), {
    iconName: 'send', className: 'btn btn-primary',
    onClick: async () => {
      if (!input.value.trim()) return;
      const action = (note.actions || []).find((item) => item.reply);
      try {
        await ctx.api.request(`/api/notifications/${note.id}/action`, {
          method: 'POST',
          body: { actionId: action?.id || 'reply', payload: { text: input.value.trim() } },
        });
        modal.close();
        await ctx.api.refresh(); ctx.rerender();
        toast(t('notifications.sent'));
      } catch (error) { ctx.toastError(error); }
    },
  });
  const modal = openModal({ title: `Reply to ${note.title}`, subtitle: note.body, body, small: true, footer: send });
}

function renderControlCenter(ctx) {
  const state = ctx.state;
  const system = state.system || {};
  const node = card({
    iconName: 'sliders-horizontal', title: t('notifications.controlCenter'),
    subtitle: 'Android quick settings, mirrored.',
    body: el('div'),
  });
  const body = node;
  const tileGrid = el('div', { class: 'tile-grid' });
  (state.quickTiles || []).forEach((tile) => {
    const buttonNode = el('button', {
      class: `tile ${tile.enabled ? 'on' : ''}`, 'aria-pressed': String(tile.enabled),
      'aria-label': `${tile.label}: ${tile.enabled ? 'on' : 'off'}`,
    });
    buttonNode.innerHTML = `${icon(tile.icon)}<span class="tile-label">${esc(tile.label)}</span><span class="tile-detail">${esc(tile.detail || (tile.enabled ? 'On' : 'Off'))}</span>`;
    buttonNode.addEventListener('click', async () => {
      try {
        await ctx.api.request(`/api/system/tiles/${tile.id}/toggle`, { method: 'POST', body: { enabled: !tile.enabled } });
        await ctx.api.refresh(); ctx.rerender();
      } catch (error) { ctx.toastError(error); }
    });
    tileGrid.append(buttonNode);
  });
  body.append(tileGrid);

  const extras = el('div', { style: { marginTop: '6px' } });
  extras.append(settingLine('Hotspot', system.hotspot?.enabled ? `On · ${system.hotspot.ssid || 'AndroidAP'}` : 'Off · share the phone connection', (() => {
    const toggle = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(system.hotspot?.enabled)), 'aria-label': 'Hotspot' });
    toggle.addEventListener('click', async () => {
      try {
        await ctx.api.request('/api/system/hotspot', { method: 'POST', body: { enabled: !system.hotspot?.enabled } });
        await ctx.api.refresh(); ctx.rerender();
        toast(system.hotspot?.enabled ? 'Hotspot disabled' : 'Hotspot enabled');
      } catch (error) { ctx.toastError(error); }
    });
    return toggle;
  })()));
  extras.append(settingLine('Cellular data', system.cellular?.enabled ? `On · ${system.cellular.carrier || 'Mobile data'}` : 'Off · Wi-Fi only', (() => {
    const toggle = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(system.cellular?.enabled)), 'aria-label': 'Cellular data' });
    toggle.addEventListener('click', async () => {
      try {
        await ctx.api.request('/api/system/cellular', { method: 'POST', body: { enabled: !system.cellular?.enabled } });
        await ctx.api.refresh(); ctx.rerender();
      } catch (error) { ctx.toastError(error); }
    });
    return toggle;
  })()));
  body.append(extras);
  return node;
}
