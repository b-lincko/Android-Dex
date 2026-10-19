/**
 * Auto-update channel handling.
 *
 * The bridge never phones home. A release manifest (signed alongside the
 * artifacts) is read from:
 *   - `DEX_UPDATE_MANIFEST` (local file or https URL, opt-in), or
 *   - `server/releases.json` shipped with the bridge.
 *
 * `apply()` verifies the SHA-256 of a locally staged artifact before reporting
 * success. GPG verification is delegated to scripts/verify-release.sh so the
 * trust root stays outside the Node process.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { badRequest, notFound, nowIso } from '../util.js';

const semver = (value) => String(value).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
const newer = (candidate, installed) => {
  const a = semver(candidate);
  const b = semver(installed);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
};

export function initUpdates(runtime, { dataDir }) {
  const { state } = runtime;
  const bundledManifest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../releases.json');
  const candidates = () => [
    process.env.DEX_UPDATE_MANIFEST,
    path.join(dataDir, 'releases.json'),
    bundledManifest,
  ].filter(Boolean);

  const loadManifest = async () => {
    for (const candidate of candidates()) {
      let raw;
      try { raw = await readFile(candidate, 'utf8'); } catch { continue; }
      try {
        const parsed = JSON.parse(raw);
        return { ...parsed, source: candidate, missing: false };
      } catch {
        throw badRequest(`update manifest ${candidate} is not valid JSON`);
      }
    }
    return { channels: {}, generatedAt: null, source: candidates().at(-1), missing: true };
  };

  return {
    async channels() {
      const manifest = await loadManifest();
      return Object.keys(manifest.channels || {}).map((channel) => ({
        channel,
        versions: (manifest.channels[channel] || []).map((release) => ({
          version: release.version, releasedAt: release.releasedAt, notes: release.notes,
          sha256: release.sha256, signature: release.signature ? 'present' : 'missing',
          url: release.downloadUrl, size: release.size,
        })),
      }));
    },

    async state() {
      return { ...state.updates, channel: state.settings.updateChannel, autoUpdate: state.settings.autoUpdate };
    },

    async check() {
      const manifest = await loadManifest();
      const channel = state.settings.updateChannel || 'stable';
      const releases = manifest.channels?.[channel] || [];
      const latest = releases
        .filter((release) => release.version && newer(release.version, state.updates.installed))
        .sort((a, b) => (newer(a.version, b.version) ? -1 : 1))[0];
      state.updates.checkedAt = nowIso();
      state.updates.channel = channel;
      if (!latest) {
        state.updates.available = false;
        state.updates.notes = manifest.missing
          ? 'No update manifest available. Point DEX_UPDATE_MANIFEST at a signed releases.json.'
          : 'You are on the latest signed release.';
        state.updates.latest = state.updates.installed;
      } else {
        state.updates.available = true;
        state.updates.latest = latest.version;
        state.updates.notes = latest.notes || 'Maintenance release.';
        state.updates.downloadUrl = latest.downloadUrl || state.updates.downloadUrl;
        state.updates.sha256 = latest.sha256 || '';
        state.updates.signature = latest.signature || '';
        state.updates.size = latest.size;
      }
      runtime.emit('updates.checked', state.updates);
      return this.state();
    },

    async apply() {
      if (!state.updates.available) throw badRequest('no update is available');
      const manifest = await loadManifest();
      const channel = state.settings.updateChannel || 'stable';
      const release = (manifest.channels?.[channel] || []).find((item) => item.version === state.updates.latest);
      if (!release) throw notFound('release disappeared from the manifest');
      const artifact = release.localPath || process.env.DEX_STAGED_ARTIFACT;
      let verification = { sha256: 'not-checked', local: false };
      if (artifact) {
        try {
          const info = await stat(artifact);
          if (!info.isFile()) throw new Error('not a file');
          const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
          if (release.sha256 && digest !== release.sha256) {
            throw badRequest('artifact checksum mismatch — refusing to apply', { expected: release.sha256, actual: digest });
          }
          verification = { sha256: digest, local: true, size: info.size };
        } catch (error) {
          if (error.status) throw error;
          verification = { sha256: 'artifact-missing', local: false };
        }
      }
      if (!release.signature) {
        runtime.logger.warn('updates', 'release manifest entry has no signature field');
      }
      runtime.audit('updates.apply', `${release.version} (${verification.sha256.slice(0, 12)})`, 'security');
      runtime.emit('updates.applied', { version: release.version, verification });
      return {
        ok: true, version: release.version, channel, verification,
        restartRequired: true,
        verifyCommand: 'scripts/verify-release.sh <artifact> SHA256SUMS SHA256SUMS.sig',
        note: 'The desktop client replaces binaries on next launch; the bridge itself only stages and verifies.',
      };
    },

    channel(channel) {
      if (!['stable', 'beta', 'nightly'].includes(channel)) throw badRequest('unknown channel');
      runtime.patchSettings({ updateChannel: channel });
      state.updates.channel = channel;
      return this.check();
    },

    autoUpdate(enabled) {
      runtime.patchSettings({ autoUpdate: Boolean(enabled) });
      return { autoUpdate: Boolean(enabled) };
    },
  };
}
