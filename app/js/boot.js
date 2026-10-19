/**
 * Boot sequence: sprite → preferences → module graph → shell.
 * Kept separate from app.js so a failure here can still show a readable error.
 */
import { hydrateIcons, loadIconSprite } from './core.js';
import { setLocale, translateDom } from './i18n.js';

const splash = document.getElementById('boot-splash');
const bar = document.getElementById('boot-bar');
const status = document.getElementById('boot-status');

let finished = false;

function progress(value, label) {
  if (bar) bar.style.width = `${Math.max(4, Math.min(100, value))}%`;
  if (status && label) status.textContent = label;
}

function finish() {
  if (finished) return;
  finished = true;
  progress(100, 'Ready');
  const app = document.getElementById('app');
  if (app) app.hidden = false;
  splash?.classList.add('leaving');
  setTimeout(() => splash?.remove(), 420);
  window.dispatchEvent(new CustomEvent('dex:booted'));
}

function bootError(error) {
  console.error('Android DEX failed to boot', error);
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.innerHTML = `<strong>The console could not start.</strong>
    <div class="mono-text tiny-text">${String(error?.message || error).replace(/[<>&]/g, '')}</div>
    <div class="tiny-text">The bridge API may still be running. Reload, or open the console with <code>?demo=1</code>.</div>`;
  const retry = document.createElement('button');
  retry.className = 'btn btn-sm btn-primary';
  retry.textContent = 'Reload';
  retry.addEventListener('click', () => location.reload());
  box.append(retry);
  splash?.append(box);
  progress(100, 'Startup failed');
}

function initialPreferences() {
  try {
    const saved = localStorage.getItem('dex.settings');
    if (!saved) return;
    const settings = JSON.parse(saved);
    if (settings.locale) setLocale(settings.locale);
    if (settings.theme) document.documentElement.dataset.theme = settings.theme;
    if (settings.highContrast) document.documentElement.dataset.contrast = 'high';
    if (settings.dyslexiaFont) document.documentElement.dataset.dyslexia = 'on';
    if (settings.reducedMotion) document.documentElement.dataset.motion = 'reduced';
  } catch { /* corrupt localStorage must not block boot */ }
}

async function main() {
  initialPreferences();
  progress(12, 'Loading icon sprite…');
  await loadIconSprite();
  hydrateIcons();
  translateDom();
  progress(30, 'Loading views…');
  // Attach before the import so a fast demo boot cannot race the event.
  window.addEventListener('dex:ready', finish, { once: true });
  try {
    await import('./app.js');
    progress(78, 'Connecting…');
  } catch (error) {
    bootError(error);
    return;
  }

  // Fall back after 12s so a slow LAN never traps the user behind the splash.
  setTimeout(() => {
    if (!finished && document.querySelector('#view')?.children.length) finish();
  }, 12000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  }
}

window.addEventListener('error', (event) => {
  if (!document.getElementById('app')?.hidden) return;
  bootError(event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('unhandled rejection', event.reason);
});

main();
