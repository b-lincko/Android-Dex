import { el, esc, fmtNumber, icon, openModal, toast, downloadText } from '../core.js';
import { t } from '../i18n.js';
import { act, button, card, pageHead, platformLauncher, refreshNote } from './shared.js';

export function renderApps(ctx) {
  const state = ctx.state;
  const filters = ['All', ...new Set(state.apps.map((app) => app.category))];
  const active = ctx.viewState.appCategory || 'All';
  const query = ctx.viewState.appQuery || '';
  const page = el('div', { class: 'page' });
  const launchDemo = el('button', { class: 'btn btn-primary', onclick: () => ctx.navigate('desktop') }, icon('monitor'), 'Show desktop');
  page.append(pageHead({
    kicker: 'Launcher',
    title: t('apps.title'),
    subtitle: t('apps.sub'),
    actions: [refreshNote(ctx), launchDemo].filter(Boolean),
  }));

  const running = state.windows.length;
  const stats = el('div', { class: 'row wrap', style: { marginBottom: '14px' } });
  stats.innerHTML = `<span class="pill accent">${icon('layout-grid')} ${state.apps.length} installed</span>
    <span class="pill ok">${icon('app-window')} ${running} running</span>
    <span class="pill">${icon('gamepad-2')} ${state.apps.filter((app) => app.category === 'Games').length} games</span>
    <span class="pill">${icon('shield-check')} Fair-play controls</span>`;
  page.append(stats);

  const search = el('input', { class: 'input', placeholder: t('apps.search'), value: query, style: { maxWidth: '320px' }, 'aria-label': t('apps.search') });
  const cats = el('div', { class: 'cat-tabs' });
  filters.forEach((filter) => {
    const chip = el('button', { class: `cat-tab ${filter === active ? 'is-active' : ''}` }, filter);
    chip.addEventListener('click', () => { ctx.setViewState({ appCategory: filter }); ctx.rerender(); });
    cats.append(chip);
  });
  const tools = el('div', { class: 'row wrap', style: { marginBottom: '14px' } }, search, cats);
  page.append(tools);

  const grid = el('div', { class: 'app-grid' });
  const draw = () => {
    grid.innerHTML = '';
    const q = (ctx.viewState.appQuery || '').toLowerCase();
    const category = ctx.viewState.appCategory || 'All';
    const filtered = state.apps.filter((app) => (category === 'All' || app.category === category) && `${app.name} ${app.package}`.toLowerCase().includes(q));
    if (!filtered.length) grid.append(el('div', { class: 'empty' }, icon('search'), el('h3', {}, t('apps.empty'))));
    filtered.forEach((app) => {
      const win = state.windows.find((item) => item.appId === app.id);
      const node = el('div', { class: 'app-card', tabindex: '0', role: 'group', 'aria-label': app.name });
      node.innerHTML = `<span class="app-icon" style="background:${app.color}">${icon(app.icon)}</span>
        <span class="app-meta">
          <span class="app-name">${esc(app.name)} ${win ? `<span class="app-running">${t('apps.running')}</span>` : ''}</span>
          <span class="app-pkg">${esc(app.package)}</span>
        </span>
        <span class="app-actions">
          <button class="icon-btn" data-launcher title="${t('apps.launcher')}" aria-label="${t('apps.launcher')}">${icon('external-link')}</button>
        </span>`;
      node.addEventListener('click', (event) => {
        if (event.target.closest('[data-launcher]')) return;
        launch(ctx, app);
      });
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); launch(ctx, app); } });
      node.querySelector('[data-launcher]').addEventListener('click', (event) => {
        event.stopPropagation();
        createLauncher(ctx, app);
      });
      grid.append(node);
    });
  };
  search.addEventListener('input', () => { ctx.setViewState({ appQuery: search.value }); draw(); });
  draw();
  page.append(grid);

  const footer = card({
    iconName: 'info',
    title: 'Every window is a real Android app',
    subtitle: 'Android DEX runs the app on your phone and streams its window. Input, audio and notifications stay local to your network.',
    body: el('div', { class: 'row wrap' }, ...[
      button('Pair a device', { iconName: 'qr-code', className: 'btn btn-sm', onClick: () => ctx.openPairing() }),
      button('Open phone tools', { iconName: 'phone', className: 'btn btn-sm', onClick: () => ctx.navigate('phone') }),
      button('Mount shared drive', { iconName: 'hard-drive', className: 'btn btn-sm', onClick: () => ctx.navigate('files') }),
    ]),
  });
  page.append(el('div', { style: { marginTop: '18px' } }, footer));
  return page;
}

async function launch(ctx, app) {
  try {
    await ctx.api.request('/api/windows', { method: 'POST', body: { appId: app.id } });
    toast(t('toast.launched'), { title: app.name });
    await ctx.api.refresh().catch(() => {});
    ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

async function createLauncher(ctx, app) {
  try {
    const platform = platformLauncher();
    const entry = await ctx.api.request(`/api/apps/${app.id}/launcher`, { query: { platform } });
    openModal({
      title: `${app.name} · host launcher`,
      subtitle: 'Add this file to your OS launcher so the app opens with one click.',
      body: el('div', { class: 'stack' },
        el('div', { class: 'pill' }, entry.filename),
        el('pre', { class: 'code', textContent: entry.content }),
        el('p', { class: 'dim tiny-text' }, platform === 'windows'
          ? 'Run the downloaded PowerShell script once. It creates a Start-menu shortcut.'
          : platform === 'macos'
            ? 'chmod +x the file and move it to ~/Applications.'
            : 'Save to ~/.local/share/applications/ and make it executable.')),
      footer: button('Download', { iconName: 'download', className: 'btn btn-primary', onClick: () => downloadText(entry.content, entry.filename) }),
    });
  } catch (error) { ctx.toastError(error); }
}
