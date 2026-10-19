/**
 * Plugin / extension API.
 *
 * A plugin is a folder inside `server/plugins/` containing `manifest.json` and
 * an ES module `index.js` that exports `activate(api)`. Plugins are disabled by
 * default and can only use the permissions listed in their manifest:
 *
 *   events:read, clipboard:read, windows:read, settings:write, notifications:action
 *
 * The API is intentionally small; the same hook names are exposed to browser
 * extensions through `window.AndroidDex.registerPanel()`. See doc/PLUGINS.md.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { badRequest, notFound } from '../util.js';

const KNOWN_PERMISSIONS = ['events:read', 'clipboard:read', 'windows:read', 'settings:read', 'settings:write', 'notifications:action'];
const HOOKS = [
  'clipboard.changed', 'notification.received', 'notification.replied', 'window.focused', 'window.launched',
  'calls.incoming', 'calls.active', 'dnd.changed', 'telemetry', 'device.connected', 'media.changed',
];

export async function initPlugins(runtime, { pluginsDir }) {
  const { state } = runtime;
  const loaded = new Map(); // id -> { manifest, module, disposers }

  const discover = async () => {
    let entries = [];
    try { entries = await readdir(pluginsDir, { withFileTypes: true }); } catch { return []; }
    const found = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const manifest = JSON.parse(await readFile(path.join(pluginsDir, entry.name, 'manifest.json'), 'utf8'));
        found.push({ id: manifest.id || entry.name, dir: entry.name, manifest });
      } catch {
        runtime.logger.warn('plugins', `skipping ${entry.name}: missing or invalid manifest.json`);
      }
    }
    return found;
  };

  const mergeDiscovered = async () => {
    const found = await discover();
    for (const plugin of found) {
      const permissions = (plugin.manifest.permissions || []).filter((permission) => KNOWN_PERMISSIONS.includes(permission));
      const unknown = (plugin.manifest.permissions || []).filter((permission) => !KNOWN_PERMISSIONS.includes(permission));
      if (unknown.length) runtime.logger.warn('plugins', `${plugin.id} requests unknown permissions: ${unknown.join(', ')}`);
      const existing = state.plugins.find((item) => item.id === plugin.id);
      if (existing) {
        Object.assign(existing, {
          name: plugin.manifest.name || existing.name,
          version: plugin.manifest.version || existing.version,
          author: plugin.manifest.author || existing.author,
          description: plugin.manifest.description || existing.description,
          permissions,
          hooks: (plugin.manifest.permissions ? plugin.manifest.hooks : plugin.manifest.hooks) || existing.hooks,
          discovered: true,
        });
      } else {
        state.plugins.push({
          id: plugin.id, name: plugin.manifest.name || plugin.id,
          version: plugin.manifest.version || '0.0.0', author: plugin.manifest.author || 'unknown',
          description: plugin.manifest.description || '', enabled: false,
          permissions, hooks: plugin.manifest.hooks || [], discovered: true,
        });
      }
    }
    return found;
  };

  const activate = async (id) => {
    const plugin = state.plugins.find((item) => item.id === id);
    if (!plugin) throw notFound('plugin not found');
    if (loaded.has(id)) return loaded.get(id).manifest;
    const found = await discover();
    const source = found.find((item) => item.id === id);
    if (!source) throw badRequest('plugin files are not installed in the plugins directory');
    const dir = path.join(pluginsDir, source.dir);
    const module = await import(pathToFileURL(path.join(dir, 'index.js')).href + `?v=${Date.now()}`);
    if (typeof module.activate !== 'function') throw badRequest('plugin must export activate(api)');
    const disposers = [];
    const allowed = new Set(plugin.permissions);
    const api = {
      plugin: { id, manifest: source.manifest },
      version: '2.0.0',
      log: (message, meta) => runtime.logger.info(`plugin:${id}`, String(message), meta),
      settings: () => state.settings,
      clipboard: () => (allowed.has('clipboard:read') ? runtime.visibleClipboard() : Promise.reject(new Error('permission denied'))),
      windows: () => (allowed.has('windows:read') ? state.windows : Promise.reject(new Error('permission denied'))),
      patchSettings: (patch) => {
        if (!allowed.has('settings:write')) throw new Error('permission denied: settings:write');
        return runtime.patchSettings(patch);
      },
      on: (event, handler) => {
        if (!allowed.has('events:read')) throw new Error('permission denied: events:read');
        if (!HOOKS.includes(event)) throw new Error(`unknown hook "${event}"`);
        const off = runtime.bus.on(event, handler);
        disposers.push(off);
        return off;
      },
      notify: (payload) => {
        if (!allowed.has('notifications:action')) throw new Error('permission denied: notifications:action');
        return runtime.addNotification({ app: plugin.name, icon: 'puzzle', color: '#8b5cf6', title: plugin.name, body: String(payload?.body || payload || ''), actions: [] });
      },
      fetch: undefined, // intentionally unavailable — plugins are local-only
    };
    const result = await module.activate(api);
    loaded.set(id, { manifest: source.manifest, module, disposers, result });
    runtime.emit('plugins.activated', { id, permissions: [...allowed] });
    runtime.audit('plugins.activate', id);
    return source.manifest;
  };

  const deactivate = (id) => {
    const entry = loaded.get(id);
    if (!entry) return;
    for (const off of entry.disposers) off();
    try { entry.module.deactivate?.(); } catch (error) { runtime.logger.warn('plugins', `deactivate failed: ${error.message}`); }
    loaded.delete(id);
    runtime.emit('plugins.deactivated', { id });
  };

  await mergeDiscovered();

  return {
    hooks: HOOKS,
    permissions: KNOWN_PERMISSIONS,

    list() {
      return state.plugins.map((plugin) => ({ ...plugin, loaded: loaded.has(plugin.id) }));
    },

    async scan() {
      const found = await mergeDiscovered();
      runtime.emit('plugins.changed', { found: found.length });
      runtime.persist();
      return this.list();
    },

    async enable(id, enabled = true) {
      const plugin = state.plugins.find((item) => item.id === id);
      if (!plugin) throw notFound('plugin not found');
      if (enabled) {
        await activate(id);
        plugin.enabled = true;
      } else {
        deactivate(id);
        plugin.enabled = false;
      }
      runtime.persist();
      runtime.emit('plugins.changed', { id, enabled });
      return { ...plugin, loaded: loaded.has(id) };
    },

    async invoke(id, event, payload) {
      if (!loaded.has(id)) throw badRequest('plugin is not enabled');
      if (!HOOKS.includes(event)) throw badRequest(`unknown hook "${event}"`);
      runtime.bus.emit(`plugin.${id}.${event}`, payload);
      return { ok: true, id, event };
    },
  };
}
