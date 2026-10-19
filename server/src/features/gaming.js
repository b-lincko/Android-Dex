/**
 * Gaming mode: control profiles, hotkey rebinding, import/export/share,
 * sensitivity curves, macro timeline recording, controller-to-touch mapping
 * and the fair-play / aim-assist disclosure gate.
 *
 * Profiles are portable JSON (schema `android-dex/profile@2`). Sharing is
 * opt-in; nothing is uploaded anywhere unless the user explicitly publishes to
 * a community catalog URL they configured themselves.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, hmac, HttpError, notFound, nowIso, uid } from '../util.js';

const PROFILE_SCHEMA = 'android-dex/profile@2';
const CONTROL_TYPES = ['tap', 'turbo', 'dpad', 'look', 'swipe', 'macro', 'key', 'trigger'];
const SHARE_SECRET = process.env.DEX_SHARE_SECRET || 'android-dex-local-profile-secret';

const validateProfile = (input = {}) => {
  if (typeof input.name !== 'string' || !input.name.trim()) throw badRequest('profile name is required');
  if (input.name.length > 80) throw badRequest('profile name is too long');
  if (input.controls && !Array.isArray(input.controls)) throw badRequest('controls must be an array');
  for (const [index, control] of (input.controls || []).entries()) {
    if (!CONTROL_TYPES.includes(control.type)) throw badRequest(`controls[${index}].type must be one of ${CONTROL_TYPES.join(', ')}`);
    for (const axis of ['x', 'y']) {
      const value = Number(control[axis]);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw badRequest(`controls[${index}].${axis} must be between 0 and 1`);
    }
    if (!control.key) throw badRequest(`controls[${index}].key is required`);
  }
  const sensitivity = input.sensitivity || {};
  for (const key of ['xCurve', 'yCurve', 'deadzone']) {
    if (sensitivity[key] !== undefined && (sensitivity[key] < 0 || sensitivity[key] > 1)) {
      throw badRequest(`sensitivity.${key} must be between 0 and 1`);
    }
  }
  return true;
};

export function initGaming(runtime, { dataDir, shareDir }) {
  const { state } = runtime;
  const syncDir = path.join(dataDir, 'sync', 'profiles');
  const catalogFile = path.join(dataDir, 'gaming-catalog.json');

  const profileFor = (id) => {
    const profile = state.gameProfiles.find((item) => item.id === id);
    if (!profile) throw notFound('game profile not found');
    return profile;
  };

  const requireFairPlay = () => {
    if (!state.settings.aimAssistDisclosureAck) {
      throw new HttpError(428, 'Aim-assist features require accepting the fair-play disclosure first.', 'fairplay_ack_required', {
        policy: 'doc/FAIR_PLAY.md',
        acceptEndpoint: '/api/gaming/fairplay/ack',
      });
    }
  };

  return {
    profiles() { return state.gameProfiles; },

    profile(id) { return profileFor(id); },

    create(payload) {
      validateProfile(payload);
      const profile = {
        id: uid('gp'), schema: PROFILE_SCHEMA, appId: payload.appId || 'custom',
        name: payload.name.trim(), game: payload.game || 'Custom game', package: payload.package || '',
        author: payload.author || 'you', version: 1, sharing: 'private', updatedAt: nowIso(),
        downloads: 0, rating: 0,
        sensitivity: normalizeSensitivity(payload.sensitivity),
        controls: (payload.controls || []).map((control) => ({ id: uid('k'), settings: {}, w: 0.07, h: 0.07, ...control })),
        macros: payload.macros || [],
        controllerMap: payload.controllerMap || {},
      };
      state.gameProfiles.push(profile);
      runtime.emit('gaming.profile-changed', { action: 'create', profile });
      runtime.persist();
      return profile;
    },

    update(id, patch) {
      const profile = profileFor(id);
      if (patch.controls) validateProfile({ ...profile, ...patch });
      if (patch.sensitivity?.aimAssist) requireFairPlay();
      Object.assign(profile, {
        ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 80) } : {}),
        ...(patch.game !== undefined ? { game: String(patch.game) } : {}),
        ...(patch.sensitivity ? { sensitivity: { ...profile.sensitivity, ...patch.sensitivity } } : {}),
        ...(patch.controls ? { controls: patch.controls } : {}),
        ...(patch.controllerMap ? { controllerMap: patch.controllerMap } : {}),
        ...(patch.sharing ? { sharing: patch.sharing } : {}),
        version: profile.version + 1,
        updatedAt: nowIso(),
      });
      runtime.emit('gaming.profile-changed', { action: 'update', profile });
      runtime.persist();
      return profile;
    },

    remove(id) {
      const profile = profileFor(id);
      state.gameProfiles = state.gameProfiles.filter((item) => item.id !== id);
      runtime.emit('gaming.profile-changed', { action: 'delete', id });
      runtime.persist();
      return profile;
    },

    /** Rebind one control to a keyboard key / mouse button. */
    bind(id, controlId, key) {
      const profile = profileFor(id);
      const control = profile.controls.find((item) => item.id === controlId);
      if (!control) throw notFound('control not found');
      if (typeof key !== 'string' || key.length > 32) throw badRequest('key must be a short string');
      const duplicate = profile.controls.find((item) => item.id !== controlId && item.key.toLowerCase() === key.toLowerCase());
      if (duplicate) throw conflict(`key ${key} is already bound to ${duplicate.label}`, 'key_in_use');
      control.key = key;
      profile.updatedAt = nowIso();
      runtime.emit('gaming.bound', { profileId: id, control, key });
      runtime.persist();
      return control;
    },

    setSensitivity(id, sensitivity) {
      const profile = profileFor(id);
      if (sensitivity?.aimAssist) requireFairPlay();
      profile.sensitivity = { ...profile.sensitivity, ...normalizeSensitivity(sensitivity, profile.sensitivity) };
      profile.updatedAt = nowIso();
      runtime.emit('gaming.sensitivity', { profileId: id, sensitivity: profile.sensitivity });
      runtime.persist();
      return profile.sensitivity;
    },

    addMacro(id, macro) {
      const profile = profileFor(id);
      const entry = {
        id: uid('macro'), name: macro?.name || 'New macro',
        steps: (macro?.steps || []).map((step) => ({
          type: ['tap', 'swipe', 'delay', 'key'].includes(step.type) ? step.type : 'tap',
          x: clamp01(step.x), y: clamp01(step.y), x2: clamp01(step.x2), y2: clamp01(step.y2),
          delayMs: Math.max(0, Math.min(10_000, Number(step.delayMs) || 0)),
          key: step.key || undefined,
        })),
      };
      profile.macros.push(entry);
      profile.updatedAt = nowIso();
      runtime.emit('gaming.macro', { action: 'add', profileId: id, macro: entry });
      runtime.persist();
      return entry;
    },

    updateMacro(id, macroId, patch) {
      const macro = profileFor(id).macros.find((item) => item.id === macroId);
      if (!macro) throw notFound('macro not found');
      if (patch.name !== undefined) macro.name = String(patch.name).slice(0, 80);
      if (patch.steps) {
        macro.steps = patch.steps.map((step) => ({
          type: ['tap', 'swipe', 'delay', 'key'].includes(step.type) ? step.type : 'tap',
          x: clamp01(step.x), y: clamp01(step.y), x2: clamp01(step.x2), y2: clamp01(step.y2),
          delayMs: Math.max(0, Math.min(10_000, Number(step.delayMs) || 0)),
          key: step.key || undefined,
        }));
      }
      profileFor(id).updatedAt = nowIso();
      runtime.emit('gaming.macro', { action: 'update', profileId: id, macro });
      runtime.persist();
      return macro;
    },

    removeMacro(id, macroId) {
      const profile = profileFor(id);
      const index = profile.macros.findIndex((item) => item.id === macroId);
      if (index === -1) throw notFound('macro not found');
      const [macro] = profile.macros.splice(index, 1);
      runtime.persist();
      return macro;
    },

    /**
     * Macro timeline recorder. The console posts raw input events; consecutive
     * events are converted into timeline steps with relative delays.
     */
    recordMacro(id, { name = 'Recorded macro', events = [] } = {}) {
      profileFor(id);
      if (!Array.isArray(events) || events.length === 0) throw badRequest('events[] is required');
      if (events.length > 500) throw badRequest('a macro may contain at most 500 events');
      let previous = Number(events[0].t) || 0;
      const steps = events.map((event) => {
        const delayMs = Math.max(0, Math.min(10_000, Number(event.t || 0) - previous));
        previous = Number(event.t) || previous;
        return {
          type: ['tap', 'swipe', 'delay', 'key'].includes(event.type) ? event.type : 'tap',
          x: clamp01(event.x), y: clamp01(event.y), x2: clamp01(event.x2), y2: clamp01(event.y2),
          delayMs, key: event.key || undefined,
        };
      });
      const macro = { id: uid('macro'), name: String(name).slice(0, 80), steps, recordedAt: nowIso() };
      profileFor(id).macros.push(macro);
      runtime.emit('gaming.macro', { action: 'recorded', profileId: id, macro });
      runtime.persist();
      return macro;
    },

    mapController(id, mapping) {
      const profile = profileFor(id);
      const allowed = ['buttonA', 'buttonB', 'buttonX', 'buttonY', 'leftStick', 'rightStick', 'triggerL2', 'triggerR2', 'buttonStart', 'buttonSelect'];
      for (const key of Object.keys(mapping || {})) {
        if (!allowed.includes(key)) throw badRequest(`unknown controller input "${key}"`);
      }
      profile.controllerMap = { ...profile.controllerMap, ...mapping };
      profile.updatedAt = nowIso();
      runtime.emit('gaming.controller-map', { profileId: id, controllerMap: profile.controllerMap });
      runtime.persist();
      return profile.controllerMap;
    },

    exportProfile(id) {
      const profile = profileFor(id);
      const payload = { schema: PROFILE_SCHEMA, exportedAt: nowIso(), profile };
      const json = JSON.stringify(payload);
      const checksum = hmac(SHARE_SECRET, json).slice(0, 12);
      return {
        json: payload,
        shareCode: `dexgame:${Buffer.from(json).toString('base64url')}.${checksum}`,
        filename: `${profile.name.replace(/[^\w-]+/g, '-').toLowerCase()}.dexprofile.json`,
      };
    },

    importProfile(payload) {
      let data = payload;
      if (typeof payload === 'string') {
        const code = payload.trim();
        const raw = code.startsWith('dexgame:') ? code.slice('dexgame:'.length) : code;
        const [encoded, checksum] = raw.split('.');
        let json;
        try { json = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { throw badRequest('share code is not valid base64url'); }
        if (checksum && hmac(SHARE_SECRET, json).slice(0, 12) !== checksum) {
          throw badRequest('share code checksum mismatch — the profile was modified or corrupted');
        }
        try { data = JSON.parse(json); } catch { throw badRequest('share code does not contain valid JSON'); }
      }
      const profile = data?.profile || data;
      if (!profile || typeof profile !== 'object') throw badRequest('profile payload missing');
      validateProfile(profile);
      const imported = {
        ...profile,
        id: uid('gp'),
        name: `${profile.name}${state.gameProfiles.some((item) => item.name === profile.name) ? ' (imported)' : ''}`,
        author: profile.author || 'imported',
        version: 1,
        sharing: 'private',
        imports: (profile.imports || 0) + 1,
        updatedAt: nowIso(),
      };
      imported.sensitivity = normalizeSensitivity(profile.sensitivity);
      state.gameProfiles.push(imported);
      runtime.emit('gaming.profile-changed', { action: 'import', profile: imported });
      runtime.persist();
      return imported;
    },

    async publish(id) {
      const profile = profileFor(id);
      profile.sharing = 'community';
      let catalog = [];
      try { catalog = JSON.parse(await readFile(catalogFile, 'utf8')); } catch { catalog = []; }
      const entry = {
        id: uid('catalog'), profileId: profile.id, name: profile.name, game: profile.game,
        author: profile.author, rating: profile.rating || 4.5, downloads: profile.downloads || 0, sharing: 'community',
        controls: profile.controls.length, updatedAt: nowIso(), schema: PROFILE_SCHEMA,
        shareCode: this.exportProfile(id).shareCode,
      };
      catalog = [entry, ...catalog.filter((item) => item.profileId !== id)];
      await mkdir(path.dirname(catalogFile), { recursive: true });
      await writeFile(catalogFile, JSON.stringify(catalog, null, 2));
      runtime.emit('gaming.published', entry);
      runtime.persist();
      return entry;
    },

    async marketplace() {
      let own = [];
      try { own = JSON.parse(await readFile(catalogFile, 'utf8')); } catch { own = []; }
      const curated = [
        { id: 'cat_cod', name: 'Season 4 — 4-finger claw', game: 'Call of Duty: Mobile', author: 'nova', rating: 4.8, downloads: 12840, controls: 9 },
        { id: 'cat_pubg', name: 'Gyro + claw hybrid', game: 'PUBG Mobile', author: 'kai', rating: 4.6, downloads: 8210, controls: 11 },
        { id: 'cat_minecraft', name: 'Builder desktop preset', game: 'Minecraft', author: 'pixelpanda', rating: 4.9, downloads: 5321, controls: 8 },
        { id: 'cat_genshin', name: 'Comfort controller mapping', game: 'Genshin Impact', author: 'lijo', rating: 4.4, downloads: 3002, controls: 6 },
      ];
      return { local: own, curated, publishUrl: '/api/gaming/marketplace', note: 'The catalog is served from your own bridge. No third-party service is contacted.' };
    },

    async installFromMarketplace(entryId, fallbackProfileId) {
      const catalog = await this.marketplace();
      const entry = catalog.local.find((item) => item.id === entryId);
      if (entry?.shareCode) return this.importProfile(entry.shareCode);
      const local = state.gameProfiles.find((item) => item.id === fallbackProfileId);
      if (local) {
        const clone = this.importProfile({ profile: { ...structuredClone(local), name: `${local.name} (catalog)` } });
        clone.downloads = (clone.downloads || 0) + 1;
        return clone;
      }
      throw notFound('catalog entry not found');
    },

    async sync(id) {
      if (!state.settings.gameProfileCloudSync) {
        throw new HttpError(409, 'Cloud sync is disabled. Enable it in Settings → Gaming.', 'sync_disabled');
      }
      const profile = profileFor(id);
      await mkdir(syncDir, { recursive: true });
      const file = path.join(syncDir, `${profile.id}.json`);
      await writeFile(file, JSON.stringify({ schema: PROFILE_SCHEMA, syncedAt: nowIso(), profile }, null, 2));
      profile.lastSyncedAt = nowIso();
      runtime.emit('gaming.synced', { profileId: id, file });
      runtime.persist();
      return { synced: true, profileId: id, location: 'local sync folder', syncedAt: profile.lastSyncedAt };
    },

    async syncStatus() {
      let files = [];
      try { files = await readdir(syncDir); } catch { files = []; }
      return { enabled: state.settings.gameProfileCloudSync, endpoint: '/api/gaming/sync', profiles: files.length, directory: syncDir };
    },

    fairPlay() {
      return {
        acknowledged: state.settings.aimAssistDisclosureAck,
        acknowledgedAt: state.settings.aimAssistAcknowledgedAt || null,
        policy: 'doc/FAIR_PLAY.md',
        rules: [
          'Android DEX never bypasses emulator detection, anti-cheat, or device integrity checks.',
          'Aim-assist and macros are off by default and must be disclosed before use.',
          'Profiles may not be shared for use in competitive modes that prohibit external input mapping.',
          'The bridge records no gameplay data; macro recordings never leave your device unless you export them.',
        ],
      };
    },

    acknowledgeFairPlay() {
      runtime.patchSettings({ aimAssistDisclosureAck: true, aimAssistAcknowledgedAt: nowIso() });
      runtime.emit('gaming.fairplay-ack', { acknowledgedAt: nowIso() });
      runtime.audit('gaming.fairplay-ack', 'aim-assist disclosure accepted');
      return this.fairPlay();
    },
  };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeSensitivity(sensitivity = {}, base = {}) {
  return {
    xCurve: clamp01(sensitivity.xCurve ?? base.xCurve ?? 0.5),
    yCurve: clamp01(sensitivity.yCurve ?? base.yCurve ?? 0.5),
    deadzone: clamp01(sensitivity.deadzone ?? base.deadzone ?? 0.08),
    gyroSens: Math.max(0, Math.min(100, Number(sensitivity.gyroSens ?? base.gyroSens ?? 0))),
    aimAssist: Boolean(sensitivity.aimAssist ?? base.aimAssist ?? false),
  };
}
