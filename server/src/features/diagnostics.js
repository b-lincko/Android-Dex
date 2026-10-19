/**
 * Diagnostics: local logs, opt-in crash bundles, SBOM lookup, device
 * compatibility matrix and a dependency-free micro-benchmark.
 *
 * Zero telemetry: nothing here ever performs a network request. Crash bundles
 * are written to the local data directory and only leave the machine when the
 * user explicitly exports them.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodePng } from '../png.js';
import { nowIso, uid } from '../util.js';

export function initDiagnostics(runtime, { dataDir, rootDir }) {
  const { state } = runtime;
  const crashDir = path.join(dataDir, 'crashes');
  const sbomFile = path.join(rootDir, 'sbom', `android-dex-${state.updates.installed}.spdx.json`);
  const compatFile = path.join(rootDir, 'server', 'data', 'compatibility.json');

  const crashBundles = async () => {
    try {
      const files = (await readdir(crashDir)).filter((name) => name.endsWith('.json'));
      return files.sort().reverse().slice(0, 50);
    } catch { return []; }
  };

  return {
    summary() {
      return {
        version: state.updates.installed,
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        uptimeSec: Math.round((Date.now() - runtime.startedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        cpu: os.cpus()[0]?.model?.trim() || 'unknown',
        device: runtime.activeDevice()?.model || null,
        reconnect: state.reconnect,
        metrics: state.diagnostics.metrics,
        logs: runtime.logger.tail(20),
        crashReporting: state.diagnostics.crashReports,
      };
    },

    logs(count = 200, level = null) {
      const entries = runtime.logger.tail(Math.min(Number(count) || 200, 2000));
      return level ? entries.filter((entry) => entry.level === level) : entries;
    },

    async setCrashReporting(enabled) {
      state.diagnostics.crashReports = Boolean(enabled);
      runtime.patchSettings({ crashReporting: Boolean(enabled), diagnosticsLocalOnly: true });
      runtime.audit('diagnostics.crash-reporting', enabled ? 'enabled (local only)' : 'disabled', 'privacy');
      return { crashReporting: state.diagnostics.crashReports, upload: false, storage: 'local data directory only' };
    },

    async reportCrash({ message, stack, context } = {}) {
      if (!state.diagnostics.crashReports) {
        return { accepted: false, reason: 'crash reporting is disabled (opt-in, local only)' };
      }
      const bundle = {
        id: uid('crash'), ts: nowIso(), message: String(message || 'unknown error').slice(0, 2000),
        stack: String(stack || '').slice(0, 20_000), context: context || {},
        platform: `${os.platform()} ${os.release()} ${os.arch()}`, version: state.updates.installed,
        diagnosticPreview: true,
      };
      await mkdir(crashDir, { recursive: true });
      const file = path.join(crashDir, `${bundle.ts.replace(/[:.]/g, '-')}-${bundle.id}.json`);
      await writeFile(file, JSON.stringify(bundle, null, 2));
      state.diagnostics.lastCrash = { id: bundle.id, ts: bundle.ts, message: bundle.message.slice(0, 200), file };
      runtime.emit('diagnostics.crash-stored', { id: bundle.id, file });
      return { accepted: true, storedLocally: true, file, note: 'Nothing was uploaded.' };
    },

    async crashes() {
      const files = await crashBundles();
      const entries = [];
      for (const name of files) {
        try {
          const data = JSON.parse(await readFile(path.join(crashDir, name), 'utf8'));
          entries.push({ id: data.id, ts: data.ts, message: data.message, platform: data.platform });
        } catch { /* ignore corrupt bundle */ }
      }
      return { enabled: state.diagnostics.crashReports, entries };
    },

    async purgeCrashes() {
      await rm(crashDir, { recursive: true, force: true });
      state.diagnostics.lastCrash = null;
      return { ok: true };
    },

    async sbom() {
      try {
        const data = JSON.parse(await readFile(sbomFile, 'utf8'));
        const info = await stat(sbomFile);
        return { available: true, path: sbomFile, generatedAt: info.mtime.toISOString(), sbom: data };
      } catch {
        return {
          available: false, path: sbomFile,
          hint: 'Generate it with `npm run sbom` (scripts/generate-sbom.mjs). Includes the bundled scrcpy/adb versions and licenses.',
        };
      }
    },

    async compatibility() {
      try {
        return JSON.parse(await readFile(compatFile, 'utf8'));
      } catch {
        return { devices: [], note: 'compatibility matrix not installed' };
      }
    },

    async benchmark() {
      const rounds = 20_000;
      const startJson = performance.now();
      for (let i = 0; i < rounds; i += 1) {
        JSON.stringify({ id: i, type: 'input.touch', x: i % 1000, y: i % 800, pressure: 0.5 });
      }
      const jsonMs = performance.now() - startJson;

      const startPng = performance.now();
      encodePng(640, 360, (x, y) => [x % 255, y % 255, (x + y) % 255]);
      const pngMs = performance.now() - startPng;

      const startHmac = performance.now();
      const { hmac } = await import('../util.js');
      for (let i = 0; i < 2000; i += 1) hmac('bench', `payload-${i}`);
      const hmacMs = performance.now() - startHmac;

      const samples = [];
      for (let i = 0; i < 50; i += 1) {
        const t0 = performance.now();
        runtime.bus.emit('bench.ping', { i });
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);

      return {
        ts: nowIso(),
        environment: { node: process.version, platform: `${os.platform()}-${os.arch()}`, cpu: os.cpus()[0]?.model?.trim() },
        results: {
          jsonStringifyPerOpUs: Number(((jsonMs / rounds) * 1000).toFixed(3)),
          pngEncode640x360Ms: Number(pngMs.toFixed(2)),
          hmacPerOpUs: Number(((hmacMs / 2000) * 1000).toFixed(2)),
          eventBusP50Us: Number((samples[25] * 1000).toFixed(2)),
          eventBusP95Us: Number((samples[47] * 1000).toFixed(2)),
        },
        disclaimer: 'Micro-benchmark of the bridge process only. Mirror latency depends on transport, codec and device; see doc/BENCHMARKS.md for the full harness.',
      };
    },
  };
}
