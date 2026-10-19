/**
 * View registry. `shell.js` owns the desktop surface (window manager), so the
 * desktop entry here is only a defensive fallback; every other view is a panel.
 */
import { el, icon } from './core.js';
import { renderApps } from './views/apps.js';
import { renderPhone } from './views/phone.js';
import { renderFiles } from './views/files.js';
import { renderClipboard } from './views/clipboard.js';
import { renderNotifications } from './views/notifications.js';
import { renderMedia } from './views/media.js';
import { renderGaming } from './views/gaming.js';
import { renderDeveloper } from './views/developer.js';
import { renderSettings } from './views/settings.js';
import { button, card, pageHead } from './views/shared.js';

const VIEWS = {
  apps: renderApps,
  phone: renderPhone,
  files: renderFiles,
  clipboard: renderClipboard,
  notifications: renderNotifications,
  media: renderMedia,
  gaming: renderGaming,
  developer: renderDeveloper,
  settings: renderSettings,
};

export function renderPanel(view, ctx) {
  const renderer = VIEWS[view];
  if (!renderer) return renderDesktopFallback(view, ctx);
  try {
    return renderer(ctx);
  } catch (error) {
    console.error(`panel ${view} failed`, error);
    return errorPanel(view, error, ctx);
  }
}

function renderDesktopFallback(view, ctx) {
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Android DEX',
    title: view === 'desktop' ? 'Desktop' : 'Not found',
    subtitle: view === 'desktop'
      ? 'The desktop surface is rendered by the shell; reload if you can see this message.'
      : `No panel is registered for "${view}".`,
    actions: [
      button('Open desktop', { iconName: 'monitor', className: 'btn btn-primary', onClick: () => ctx.navigate('desktop') }),
      button('Open apps', { iconName: 'layout-grid', className: 'btn', onClick: () => ctx.navigate('apps') }),
    ],
  }));
  page.append(card({
    iconName: 'layout-dashboard',
    title: 'Everything is still reachable',
    body: el('div', { class: 'row wrap' },
      ...['apps', 'phone', 'files', 'clipboard', 'notifications', 'media', 'gaming', 'developer', 'settings'].map((id) => button(
        id[0].toUpperCase() + id.slice(1),
        { className: 'btn btn-sm', onClick: () => ctx.navigate(id) },
      ))),
  }));
  return page;
}

function errorPanel(view, error, ctx) {
  const page = el('div', { class: 'page' });
  const box = el('div', { class: 'empty' });
  box.innerHTML = `${icon('triangle-alert')}<h3>This panel hit an error</h3>
    <p class="mono-text tiny-text">${String(error?.message || error).replace(/[<>&]/g, '')}</p>`;
  const retry = el('button', { class: 'btn btn-primary' }, icon('refresh-cw'), 'Reload the console');
  retry.addEventListener('click', () => location.reload());
  box.append(retry);
  page.append(box);
  return page;
}
