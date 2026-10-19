import { copyText, el, esc, fmtRelative, icon, openModal, settingRow, switchControl, toast, toastError } from '../core.js';
import { t } from '../i18n.js';
import { button, card, emptyState, pageHead, refreshNote } from './shared.js';

export function renderClipboard(ctx) {
  const state = ctx.state;
  const items = [...state.clipboard].sort((a, b) => (a.pinned === b.pinned ? b.ts.localeCompare(a.ts) : a.pinned ? -1 : 1));
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Universal clipboard',
    title: t('clipboard.title'),
    subtitle: t('clipboard.sub'),
    actions: [
      refreshNote(ctx),
      button(t('clipboard.clear'), {
        iconName: 'trash-2', className: 'btn btn-sm',
        onClick: async () => {
          if (!(await ctx.confirmDialog({ title: t('clipboard.clear'), message: 'Pinned items are kept.', confirmLabel: t('common.clear'), danger: true }))) return;
          try { await ctx.api.request('/api/clipboard/clear', { method: 'POST', body: { keepPinned: true } }); await ctx.api.refresh(); ctx.rerender(); toast('History cleared'); } catch (error) { toastError(error); }
        },
      }),
    ].filter(Boolean),
  }));

  const addCard = card({ body: el('div') });
  const form = el('div', { class: 'clip-form' });
  const input = el('input', { class: 'input', placeholder: t('clipboard.placeholder'), 'aria-label': t('clipboard.new') });
  const send = button(t('clipboard.new'), { iconName: 'plus', className: 'btn btn-primary' });
  const imageBtn = button('Image', { iconName: 'image', className: 'btn btn-sm' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  form.append(input, send, imageBtn, fileInput);
  addCard.append(form);

  const addText = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await ctx.api.request('/api/clipboard', { method: 'POST', body: { kind: 'text', text, source: 'desktop' } });
      input.value = '';
      await ctx.api.refresh().catch(() => {});
      ctx.rerender();
      toast(t('toast.clipSynced'));
    } catch (error) { toastError(error); }
  };
  send.addEventListener('click', addText);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') addText(); });
  imageBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) { toast('Images must be under 4.5 MB', { type: 'warn' }); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await ctx.api.request('/api/clipboard', { method: 'POST', body: { kind: 'image', text: file.name, dataUrl: reader.result, size: file.size } });
        await ctx.api.refresh().catch(() => {});
        ctx.rerender();
        toast('Image added to the synced clipboard');
      } catch (error) { toastError(error); }
    };
    reader.readAsDataURL(file);
  });

  input.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files || [])][0];
    if (file?.type.startsWith('image/')) {
      event.preventDefault();
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await ctx.api.request('/api/clipboard', { method: 'POST', body: { kind: 'image', text: file.name || 'Pasted image', dataUrl: reader.result, size: file.size } });
          await ctx.api.refresh().catch(() => {});
          ctx.rerender();
          toast('Pasted image synced');
        } catch (error) { toastError(error); }
      };
      reader.readAsDataURL(file);
    }
  });
  page.append(addCard);

  const filters = el('div', { class: 'row wrap', style: { margin: '6px 0 14px' } });
  ['all', 'text', 'image', 'pinned'].forEach((filter) => {
    const active = (ctx.viewState.clipFilter || 'all') === filter;
    filters.append(el('button', {
      class: `cat-tab ${active ? 'is-active' : ''}`,
      onclick: () => { ctx.setViewState({ clipFilter: filter }); ctx.rerender(); },
    }, filter[0].toUpperCase() + filter.slice(1)));
  });
  page.append(filters);

  const filter = ctx.viewState.clipFilter || 'all';
  const visible = items.filter((item) => filter === 'all' ? true : filter === 'pinned' ? item.pinned : item.kind === filter);
  const grid = el('div', { class: 'clip-grid' });
  if (!visible.length) grid.append(emptyState('clipboard', t('clipboard.empty'), 'Anything you copy on the phone or desktop appears here.'));
  visible.forEach((item) => grid.append(renderClip(ctx, item)));
  page.append(grid);

  const options = card({
    iconName: 'settings',
    title: t('settings.sync'),
    body: el('div', {},
      settingRow({
        title: t('settings.clipboard'),
        description: t('settings.clipboardDesc'),
        control: switchControl(state.settings.clipboardSync, (value) => ctx.saveSettings({ clipboardSync: value })),
      }),
      settingRow({
        title: t('clipboard.images'),
        description: 'Sync images in both directions (max 4.5 MB per item).',
        control: switchControl(state.settings.clipboardImages, (value) => ctx.saveSettings({ clipboardImages: value })),
      }),
      settingRow({
        title: t('clipboard.retention'),
        description: 'Pinned items never expire.',
        control: (() => {
          const select = el('select', { class: 'select' });
          [[60, '1 hour'], [480, '8 hours'], [1440, '1 day'], [10080, '1 week']].forEach(([value, label]) => {
            const option = el('option', { value }, label);
            if (Number(state.settings.clipboardRetentionMinutes) === value) option.selected = true;
            select.append(option);
          });
          select.addEventListener('change', () => ctx.saveSettings({ clipboardRetentionMinutes: Number(select.value) }));
          return select;
        })(),
      })),
  });
  page.append(el('div', { style: { marginTop: '18px' } }, options));
  return page;
}

function renderClip(ctx, item) {
  const node = el('div', { class: `clip ${item.pinned ? 'pinned' : ''}` });
  const head = el('div', { class: 'clip-head' });
  head.innerHTML = `${icon(item.kind === 'image' ? 'image' : 'clipboard')}
    <span class="src">${item.source === 'android' ? t('clipboard.fromPhone') : t('clipboard.fromDesktop')}</span>
    <span>·</span><span>${fmtRelative(item.ts)}</span>
    ${item.pinned ? `<span class="pill" style="margin-left:auto;height:18px;font-size:.55rem">${icon('pin')} pinned</span>` : ''}`;
  node.append(head);
  if (item.kind === 'image') {
    const image = el('div', { class: 'clip-img' });
    if (item.dataUrl?.startsWith('data:') || item.dataUrl?.startsWith('http')) {
      image.style.backgroundImage = `url("${item.dataUrl}")`;
      image.style.backgroundSize = 'cover';
      image.style.backgroundPosition = 'center';
    }
    image.title = item.text;
    node.append(image);
    if (item.width) node.append(el('div', { class: 'dim tiny-text' }, `${item.width}×${item.height} · ${item.size ? (item.size / 1024).toFixed(0) + ' KB' : 'image'}`));
  } else {
    node.append(el('div', { class: 'clip-text' }, item.text));
  }
  const actions = el('div', { class: 'clip-actions' });
  actions.append(button(t('clipboard.copyHost'), {
    iconName: 'monitor', className: 'btn btn-sm',
    onClick: async () => {
      try {
        if (item.kind === 'image' && item.dataUrl) {
          if (navigator.clipboard?.write && window.ClipboardItem) {
            const blob = await (await fetch(item.dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            toast('Image copied to the desktop clipboard');
          } else {
            toast('Image clipboard is not supported by this browser', { type: 'warn' });
          }
        } else {
          await copyText(item.text);
        }
        await ctx.api.request(`/api/clipboard/${item.id}/copy`, { method: 'POST', body: { target: 'host' } }).catch(() => {});
      } catch (error) { toastError(error); }
    },
  }));
  actions.append(button(t('clipboard.sendToPhone'), {
    iconName: 'smartphone', className: 'btn btn-sm',
    onClick: async () => {
      try {
        await ctx.api.request(`/api/clipboard/${item.id}/copy`, { method: 'POST', body: { target: 'device' } });
        toast('Sent to the phone clipboard');
      } catch (error) { toastError(error); }
    },
  }));
  actions.append(button('', {
    iconName: 'pin', className: `icon-btn ${item.pinned ? 'is-on' : ''}`, title: item.pinned ? 'Unpin' : 'Pin',
    onClick: async () => {
      try { await ctx.api.request(`/api/clipboard/${item.id}`, { method: 'PATCH', body: {} }); await ctx.api.refresh(); ctx.rerender(); } catch (error) { toastError(error); }
    },
  }));
  actions.append(button('', {
    iconName: 'trash-2', className: 'icon-btn', title: t('common.delete'),
    onClick: async () => {
      try { await ctx.api.request(`/api/clipboard/${item.id}`, { method: 'DELETE' }); await ctx.api.refresh(); ctx.rerender(); } catch (error) { toastError(error); }
    },
  }));
  node.append(actions);
  return node;
}
