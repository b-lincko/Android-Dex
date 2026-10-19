import { createApi } from './api.js';
import { startShell } from './shell.js';
import { toastError } from './core.js';

const api = await createApi();
await startShell(api);

// Expose a tiny debug handle; it contains no secrets beyond what the page already holds.
window.dex = { api, mode: api.mode, refresh: () => api.refresh() };

await api.refresh().catch(() => {});
window.dispatchEvent(new CustomEvent('dex:ready', { detail: { mode: api.mode, needsAuth: api.needsAuth } }));

if (api.needsAuth) {
  // The shell already opened the auth dialog via the auth.required event.
  console.info('Android DEX: bridge token required');
}

window.addEventListener('online', () => api.refresh().catch(() => {}));
window.addEventListener('offline', () => toastError({ message: 'Network lost — the console will keep the last state.' }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') api.refresh().catch(() => {});
});
