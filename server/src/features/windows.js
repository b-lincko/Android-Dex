/**
 * Window manager: floating app windows, snap layouts, always-on-top, PiP,
 * orientation/DPI overrides, multi-monitor routing and Android widgets.
 */
import { badRequest, clamp, notFound, uid } from '../util.js';

const SNAP_ZONES = ['left-half', 'right-half', 'top-half', 'bottom-half', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'maximize'];
const LAYOUTS = ['2-columns', '3-columns', '2x2', 'main-side', 'focus'];
const ORIENTATIONS = ['portrait', 'landscape', 'sensor', 'locked-portrait', 'locked-landscape'];

const TASKBAR = 72;

export function initWindows(runtime) {
  const { state } = runtime;

  const monitor = (id) => {
    const entry = state.monitors.find((item) => item.id === id) || state.monitors.find((item) => item.primary);
    if (!entry) throw badRequest('no monitor configured');
    return entry;
  };

  const windowFor = (id) => {
    const entry = state.windows.find((item) => item.id === id);
    if (!entry) throw notFound('window not found');
    return entry;
  };

  const workArea = (monitorId) => {
    const mon = monitor(monitorId);
    return { x: mon.x, y: mon.y, w: mon.width, h: mon.height - TASKBAR };
  };

  const geometryForZone = (zone, monitorId) => {
    const area = workArea(monitorId);
    const halfW = Math.round(area.w / 2);
    const halfH = Math.round(area.h / 2);
    switch (zone) {
      case 'left-half': return { x: area.x, y: area.y, w: halfW, h: area.h };
      case 'right-half': return { x: area.x + halfW, y: area.y, w: area.w - halfW, h: area.h };
      case 'top-half': return { x: area.x, y: area.y, w: area.w, h: halfH };
      case 'bottom-half': return { x: area.x, y: area.y + halfH, w: area.w, h: area.h - halfH };
      case 'top-left': return { x: area.x, y: area.y, w: halfW, h: halfH };
      case 'top-right': return { x: area.x + halfW, y: area.y, w: area.w - halfW, h: halfH };
      case 'bottom-left': return { x: area.x, y: area.y + halfH, w: halfW, h: area.h - halfH };
      case 'bottom-right': return { x: area.x + halfW, y: area.y + halfH, w: area.w - halfW, h: area.h - halfH };
      case 'maximize': return { x: area.x, y: area.y, w: area.w, h: area.h };
      default: throw badRequest(`unknown snap zone "${zone}"`);
    }
  };

  const emitWindows = (action, extra = {}) => runtime.emit('windows.changed', { action, windows: state.windows, ...extra });

  return {
    SNAP_ZONES,
    LAYOUTS,

    list() { return state.windows; },

    monitors() { return state.monitors; },

    updateMonitor(id, patch) {
      const mon = state.monitors.find((item) => item.id === id);
      if (!mon) throw notFound('monitor not found');
      if (patch.width !== undefined) mon.width = clamp(patch.width, 800, 15360);
      if (patch.height !== undefined) mon.height = clamp(patch.height, 600, 8640);
      if (patch.scale !== undefined) mon.scale = clamp(patch.scale, 50, 300);
      if (patch.primary) {
        state.monitors.forEach((item) => { item.primary = item.id === id; });
      }
      runtime.emit('monitors.changed', state.monitors);
      runtime.persist();
      return mon;
    },

    launch(appId, options = {}) {
      const app = state.apps.find((item) => item.id === appId);
      if (!app) throw notFound('app not found');
      const existing = state.windows.find((item) => item.appId === appId);
      if (existing) {
        existing.minimized = false;
        existing.z = Math.max(...state.windows.map((w) => w.z), 0) + 1;
        runtime.emit('windows.focused', existing);
        emitWindows('focus', { window: existing });
        return existing;
      }
      const mon = monitor(options.monitorId || state.monitors.find((item) => item.primary)?.id);
      const offset = (state.windows.length % 6) * 28;
      const win = {
        id: uid('win'), appId, title: app.name, package: app.package, icon: app.icon, color: app.color,
        monitorId: mon.id, x: mon.x + 80 + offset, y: mon.y + 64 + offset,
        w: options.w || 480, h: options.h || 820, z: Math.max(0, ...state.windows.map((item) => item.z)) + 1,
        minimized: false, maximized: false, alwaysOnTop: false, pip: false,
        orientation: app.category === 'Games' ? 'landscape' : 'portrait',
        dpi: 320, scale: 100, snapped: null, audio: true, state: 'running',
      };
      state.windows.push(win);
      runtime.emit('windows.launched', win);
      emitWindows('launch', { window: win });
      runtime.audit('windows.launch', `${app.name} on ${mon.name}`);
      runtime.persist();
      return win;
    },

    close(id) {
      const win = windowFor(id);
      state.windows = state.windows.filter((item) => item.id !== id);
      runtime.emit('windows.closed', { id });
      emitWindows('close', { id });
      runtime.persist();
      return { ok: true, id };
    },

    patch(id, patch) {
      const win = windowFor(id);
      const allowed = ['title', 'x', 'y', 'w', 'h', 'monitorId', 'alwaysOnTop', 'pip', 'orientation',
        'dpi', 'scale', 'minimized', 'maximized', 'audio', 'z', 'snapped'];
      for (const key of allowed) {
        if (patch[key] === undefined) continue;
        if (key === 'orientation' && !ORIENTATIONS.includes(patch[key])) throw badRequest(`invalid orientation`);
        if (key === 'monitorId') {
          const mon = monitor(patch[key]);
          if (mon.id !== win.monitorId) {
            win.x = mon.x + 70;
            win.y = mon.y + 60;
            runtime.emit('windows.routed', { windowId: id, monitorId: mon.id, monitorName: mon.name });
          }
          win.monitorId = mon.id;
          continue;
        }
        if (['x', 'y', 'w', 'h', 'dpi', 'z'].includes(key)) win[key] = Math.round(Number(patch[key])) || 0;
        else if (key === 'scale') win.scale = clamp(patch[key], 50, 250);
        else win[key] = patch[key];
      }
      if (win.pip) {
        win.w = Math.max(280, Math.round(win.w * 0.45));
        win.h = Math.max(160, Math.round(win.h * 0.45));
        win.alwaysOnTop = true;
        win.snapped = 'bottom-right';
      }
      win.z = win.z || 1;
      runtime.emit('windows.updated', win);
      emitWindows('update', { window: win });
      runtime.persist();
      return win;
    },

    focus(id) {
      const win = windowFor(id);
      win.z = Math.max(...state.windows.map((item) => item.z), 0) + 1;
      win.minimized = false;
      runtime.emit('windows.focused', win);
      emitWindows('focus', { window: win });
      runtime.persist();
      return win;
    },

    snapshot(id) {
      const win = windowFor(id);
      win.snapped = win.snapped ? null : 'maximize';
      Object.assign(win, win.snapped ? geometryForZone(win.snapped, win.monitorId) : {});
      emitWindows('snap', { window: win });
      return win;
    },

    snap(id, zone) {
      if (!SNAP_ZONES.includes(zone)) throw badRequest(`unknown snap zone "${zone}"`);
      const win = windowFor(id);
      if (zone === 'maximize') {
        win.maximized = true;
      } else {
        win.maximized = false;
      }
      Object.assign(win, geometryForZone(zone, win.monitorId));
      win.snapped = zone;
      win.pip = false;
      runtime.emit('windows.snapped', { window: win, zone });
      emitWindows('snap', { window: win, zone });
      runtime.persist();
      return win;
    },

    /** Apply a tiling preset across the windows on one monitor. */
    applyLayout(preset, monitorId) {
      if (!LAYOUTS.includes(preset)) throw badRequest(`unknown layout "${preset}"`);
      const targetMonitor = monitorId || state.monitors.find((item) => item.primary)?.id;
      const list = state.windows.filter((item) => item.monitorId === targetMonitor && !item.minimized);
      if (!list.length) throw badRequest('no open windows on that monitor');
      const area = workArea(targetMonitor);
      const assign = (win, geo) => {
        Object.assign(win, geo);
        win.maximized = false;
        win.pip = false;
      };
      const third = Math.round(area.w / 3);
      const half = Math.round(area.w / 2);
      const halfH = Math.round(area.h / 2);

      list.forEach((win, index) => {
        if (preset === '2-columns') {
          assign(win, { x: area.x + index * half, y: area.y, w: half, h: area.h });
          win.snapped = index % 2 === 0 ? 'left-half' : 'right-half';
        } else if (preset === '3-columns') {
          const col = index % 3;
          assign(win, { x: area.x + col * third, y: area.y, w: third, h: area.h });
        } else if (preset === '2x2') {
          const col = index % 2;
          const row = Math.floor(index / 2) % 2;
          assign(win, { x: area.x + col * half, y: area.y + row * halfH, w: half, h: halfH });
        } else if (preset === 'main-side') {
          if (index === 0) assign(win, { x: area.x, y: area.y, w: Math.round(area.w * 0.62), h: area.h });
          else {
            const col = index % 2;
            const row = Math.floor((index - 1) / 2);
            assign(win, {
              x: area.x + Math.round(area.w * 0.62), y: area.y + row * Math.round(area.h / 2),
              w: area.w - Math.round(area.w * 0.62), h: Math.round(area.h / 2),
            });
            win.snapped = col ? 'right-half' : 'left-half';
          }
        } else if (preset === 'focus') {
          if (index === 0) assign(win, { x: area.x + 40, y: area.y + 30, w: area.w - 80, h: area.h - 60 });
          else assign(win, { x: area.x + 80 + index * 24, y: area.y + 90 + index * 24, w: 420, h: 300 });
        }
      });
      runtime.emit('windows.layout', { preset, monitorId: targetMonitor });
      emitWindows('layout', { preset });
      runtime.persist();
      return { preset, monitorId: targetMonitor, windows: list };
    },

    /** Per-app hotkey bindings (also used by gaming profiles). */
    hotkeys() {
      return state.settings.hotkeys || DEFAULT_HOTKEYS;
    },

    setHotkey(action, accelerator) {
      if (!/^([A-Za-z0-9]+\+)*[A-Za-z0-9]+$/.test(accelerator)) throw badRequest('accelerator must look like Ctrl+Shift+V');
      const hotkeys = { ...(state.settings.hotkeys || DEFAULT_HOTKEYS) };
      const duplicate = Object.entries(hotkeys).find(([key, value]) => key !== action && value === accelerator);
      if (duplicate) throw badRequest(`accelerator already bound to ${duplicate[0]}`);
      hotkeys[action] = accelerator;
      runtime.patchSettings({ hotkeys });
      runtime.emit('hotkeys.changed', hotkeys);
      return hotkeys;
    },

    triggerHotkey(action) {
      const win = [...state.windows].sort((a, b) => b.z - a.z)[0];
      switch (action) {
        case 'screenshot': runtime.emit('capture.screenshot.request', {}); break;
        case 'record': runtime.emit('capture.record.toggle', {}); break;
        case 'clipboard': runtime.emit('clipboard.open.request', {}); break;
        case 'search': runtime.emit('search.open.request', {}); break;
        case 'lock': runtime.emit('system.lock.request', {}); break;
        case 'pip': if (win) return this.patch(win.id, { pip: !win.pip }); break;
        case 'alwaysOnTop': if (win) return this.patch(win.id, { alwaysOnTop: !win.alwaysOnTop }); break;
        default: runtime.emit('hotkey.pressed', { action });
      }
      runtime.emit('hotkey.pressed', { action });
      return { ok: true, action };
    },

    /** Generate a host launcher entry for an Android app. */
    launcherEntry(appId, platform = 'linux') {
      const app = state.apps.find((item) => item.id === appId);
      if (!app) throw notFound('app not found');
      const command = `android-dex launch ${app.package}`;
      let content;
      let extension;
      if (platform === 'windows') {
        extension = '.lnk.ps1';
        content = `# Create a Start-menu shortcut for ${app.name}\n$ws = New-Object -ComObject WScript.Shell\n$s = $ws.CreateShortcut("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Android DEX\\${app.name}.lnk")\n$s.TargetPath = "${command}"\n$s.Save()\n`;
      } else if (platform === 'macos') {
        extension = '.command';
        content = `#!/bin/sh\n# Add to ~/Applications after chmod +x\n${command}\n`;
      } else {
        extension = '.desktop';
        content = `[Desktop Entry]\nType=Application\nName=${app.name}\nComment=Android DEX · ${app.package}\nExec=${command}\nIcon=android-dex\nCategories=Utility;\nTerminal=false\nStartupWMClass=android-dex\n`;
      }
      runtime.audit('windows.launcher-entry', `${app.name} (${platform})`);
      return { app: app.name, platform, filename: `${app.name.replace(/\s+/g, '-').toLowerCase()}${extension}`, content, command };
    },

    apps() { return state.apps; },

    widgets() { return state.widgets; },

    addWidget({ type = 'clock', monitorId, x = 40, y = 120, w = 240, h = 160 } = {}) {
      const mon = monitor(monitorId);
      const widget = { id: uid('w'), type, monitorId: mon.id, x, y, w, h, z: 1, config: defaultWidgetConfig(type) };
      state.widgets.push(widget);
      runtime.emit('widgets.changed', { action: 'add', widget });
      runtime.persist();
      return widget;
    },

    patchWidget(id, patch) {
      const widget = state.widgets.find((item) => item.id === id);
      if (!widget) throw notFound('widget not found');
      for (const key of ['x', 'y', 'w', 'h', 'monitorId', 'z']) {
        if (patch[key] !== undefined) widget[key] = Number(patch[key]);
      }
      if (patch.config) widget.config = { ...widget.config, ...patch.config };
      runtime.emit('widgets.changed', { action: 'update', widget });
      runtime.persist();
      return widget;
    },

    removeWidget(id) {
      const index = state.widgets.findIndex((item) => item.id === id);
      if (index === -1) throw notFound('widget not found');
      const [widget] = state.widgets.splice(index, 1);
      runtime.emit('widgets.changed', { action: 'remove', widget });
      runtime.persist();
      return widget;
    },
  };
}

export const DEFAULT_HOTKEYS = {
  toggleUi: 'Ctrl+Alt+Down',
  deviceSwitcher: 'Ctrl+Alt+Right',
  screenshot: 'Ctrl+Alt+P',
  record: 'Ctrl+Alt+R',
  clipboard: 'Ctrl+Shift+V',
  search: 'Ctrl+K',
  lock: 'Ctrl+Shift+L',
  pip: 'Ctrl+Shift+P',
  alwaysOnTop: 'Ctrl+Shift+T',
  fullscreen: 'Ctrl+F',
};

function defaultWidgetConfig(type) {
  switch (type) {
    case 'clock': return { timezone: 'local', format24h: true };
    case 'weather': return { city: 'Doha' };
    case 'notes': return { text: 'New note — click to edit.' };
    case 'battery': return { showTemperature: true };
    case 'media': return { compact: true };
    default: return {};
  }
}
