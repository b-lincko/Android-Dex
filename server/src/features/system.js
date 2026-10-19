/**
 * System control surface: quick-settings tiles, lock/unlock with biometric
 * forwarding, battery/charging controls and idle prevention.
 */
import { badRequest, clamp, notFound, nowIso, uid } from '../util.js';

export function initSystem(runtime) {
  const { state } = runtime;

  const tile = (id) => {
    const entry = state.quickTiles.find((item) => item.id === id);
    if (!entry) throw notFound(`unknown quick setting "${id}"`);
    return entry;
  };

  const setDetail = (id, detail) => {
    const entry = tile(id);
    entry.detail = detail;
    return entry;
  };

  const emitTile = (entry) => runtime.emit('system.tile', { tile: entry });

  return {
    tiles() {
      return state.quickTiles.map((item) => ({ ...item }));
    },

    toggleTile(id, explicit) {
      const entry = tile(id);
      const next = explicit === undefined ? !entry.enabled : Boolean(explicit);
      entry.enabled = next;
      switch (id) {
        case 'dnd':
          runtime.patchSettings({ dnd: next });
          break;
        case 'airplane':
          entry.detail = next ? 'On' : 'Off';
          if (next) {
            setDetail('wifi', 'Off (airplane)').enabled = false;
            setDetail('cellular', 'Off (airplane)').enabled = false;
            setDetail('bluetooth', 'Off (airplane)').enabled = false;
            setDetail('hotspot', 'Off (airplane)').enabled = false;
          } else {
            setDetail('wifi', 'HomeNet-5G').enabled = true;
            setDetail('cellular', '5G · 12 GB left').enabled = true;
          }
          break;
        case 'wifi':
          entry.detail = next ? 'HomeNet-5G' : 'Off';
          if (next) setDetail('airplane', 'Off').enabled = false;
          break;
        case 'bluetooth':
          entry.detail = next ? 'Buds Pro' : 'Off';
          break;
        case 'hotspot':
          entry.detail = next ? '2 devices connected' : 'Off';
          break;
        case 'cellular':
          entry.detail = next ? '5G · 12 GB left' : 'Off';
          if (next) setDetail('airplane', 'Off').enabled = false;
          break;
        case 'flashlight':
          entry.detail = next ? 'On' : 'Off';
          break;
        case 'rotation':
          entry.detail = next ? 'On' : 'Locked portrait';
          break;
        default:
          entry.detail = next ? 'On' : 'Off';
      }
      runtime.emit('system.tile', entry);
      runtime.audit('system.tile', `${id}=${next ? 'on' : 'off'}`);
      return entry;
    },

    setHotspot({ enabled, ssid, password, band = '5GHz' }) {
      const entry = tile('hotspot');
      entry.enabled = Boolean(enabled);
      entry.detail = enabled ? `${ssid || 'AndroidDEX'} · ${band}` : 'Off';
      runtime.emit('system.tile', entry);
      runtime.audit('system.hotspot', enabled ? `enabled ${ssid || 'AndroidDEX'}` : 'disabled');
      return { ...entry, ssid, band, passwordRotation: password ? 'accepted' : 'unchanged' };
    },

    setCellular({ dataEnabled, roaming = false, limitGb = 12 }) {
      const entry = tile('cellular');
      entry.enabled = Boolean(dataEnabled);
      entry.detail = dataEnabled ? `5G · ${limitGb} GB limit${roaming ? ' · roaming' : ''}` : 'Off';
      runtime.emit('system.tile', entry);
      return entry;
    },

    lock({ reason = 'user requested', requireBiometric = true } = {}) {
      const device = runtime.activeDevice();
      if (!device) throw badRequest('no active device');
      const challenge = {
        id: uid('bio'),
        prompt: 'Confirm it is you to unlock the phone',
        reason,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        method: 'fingerprint',
        forwarded: Boolean(state.settings.biometricForwarding),
      };
      state.security.biometric = challenge;
      device.locked = true;
      runtime.emit('system.locked', { deviceId: device.id, challenge });
      runtime.audit('system.locked', reason);
      return { locked: true, challenge: requireBiometric ? challenge : null };
    },

    biometric(challengeId, { success = true, method = 'fingerprint' } = {}) {
      const challenge = state.security.biometric;
      if (!challenge || challenge.id !== challengeId) throw badRequest('biometric challenge not found or expired');
      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        state.security.biometric = null;
        throw badRequest('biometric challenge expired');
      }
      if (!success) {
        state.security.biometric = null;
        state.security.rejectedAttempts = (state.security.rejectedAttempts || 0) + 1;
        runtime.emit('system.biometric-failed', { challengeId });
        return { unlocked: false };
      }
      const device = runtime.activeDevice();
      device.locked = false;
      state.security.biometric = null;
      runtime.emit('system.unlocked', { deviceId: device?.id, method });
      runtime.audit('system.unlocked', method);
      return { unlocked: true, deviceId: device?.id };
    },

    state() {
      const device = runtime.activeDevice();
      return {
        locked: Boolean(device?.locked),
        battery: device?.battery || null,
        charging: device?.battery?.charging || false,
        idlePrevention: state.settings.idlePrevention,
        chargeLimit: state.settings.chargeLimit,
        chargeThrottle: state.settings.chargeThrottle,
        biometric: state.security.biometric || null,
      };
    },

    keepAwake(enabled) {
      runtime.patchSettings({ idlePrevention: Boolean(enabled) });
      runtime.emit('system.keep-awake', { enabled: Boolean(enabled) });
      return { idlePrevention: Boolean(enabled) };
    },

    chargeThrottle({ enabled, limit = state.settings.chargeLimit }) {
      const value = clamp(limit, 40, 100);
      runtime.patchSettings({ chargeThrottle: Boolean(enabled), chargeLimit: value });
      const device = runtime.activeDevice();
      if (device) device.battery.charging = Boolean(enabled) && device.battery.level < value;
      runtime.emit('system.charge-throttle', { enabled: Boolean(enabled), limit: value });
      runtime.audit('system.charge-throttle', `${enabled ? 'on' : 'off'} @ ${value}%`);
      return { enabled: Boolean(enabled), limit: value, battery: device?.battery };
    },

    /** Wake-on-connect hook used by the USB/Wi-Fi watcher and the CLI. */
    wake({ transport = 'usb', deviceId } = {}) {
      const device = deviceId ? state.devices.find((item) => item.id === deviceId) : runtime.activeDevice();
      if (!device) throw badRequest('unknown device');
      device.status = 'connected';
      device.transport = transport;
      device.lastSeen = nowIso();
      runtime.emit('device.wake', { deviceId: device.id, transport });
      if (state.settings.wakeOnConnect) {
        runtime.emit('system.wake-display', { deviceId: device.id });
      }
      return { device };
    },
  };
}
