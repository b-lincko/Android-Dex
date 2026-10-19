#!/usr/bin/env node
/**
 * Android DEX bridge benchmark.
 *
 * Measures the control plane (REST + WebSocket round-trips) and the local
 * encode paths. This is deliberately honest: it does not measure the mirror
 * video pipeline, which depends on the device codec and transport. See
 * doc/BENCHMARKS.md for the full methodology and the scrcpy comparison.
 *
 *   node bench/bench.js --url http://127.0.0.1:8787 --token "$DEX_TOKEN"
 */
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const URL_BASE = (arg('url', process.env.DEX_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
const TOKEN = arg('token', process.env.DEX_TOKEN || '');
const ROUNDS = Number(arg('rounds', '200'));
const JSON_OUT = args.includes('--json');

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarise(samples, unit = 'ms') {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    n: sorted.length,
    min: Number(sorted[0].toFixed(3)),
    p50: Number(percentile(sorted, 50).toFixed(3)),
    p95: Number(percentile(sorted, 95).toFixed(3)),
    p99: Number(percentile(sorted, 99).toFixed(3)),
    max: Number(sorted.at(-1).toFixed(3)),
    mean: Number(mean.toFixed(3)),
    unit,
  };
}

async function timed(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function rest(name, fn, rounds = ROUNDS) {
  for (let i = 0; i < 10; i += 1) await fn(i);
  const samples = [];
  for (let i = 0; i < rounds; i += 1) samples.push(await timed(() => fn(i)));
  return { name, ...summarise(samples) };
}

async function wsPing(rounds = 50) {
  if (typeof WebSocket === 'undefined') return null;
  const wsUrl = `${URL_BASE.replace(/^http/, 'ws')}/ws${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''}`;
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 5000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
  });
  const samples = [];
  let id = 0;
  for (let i = 0; i < rounds; i += 1) {
    const messageId = `bench_${++id}`;
    const start = performance.now();
    await new Promise((resolve) => {
      const onMessage = (event) => {
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (frame.type !== 'result' || frame.id !== messageId) return;
        socket.removeEventListener('message', onMessage);
        resolve();
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ type: 'command', id: messageId, action: 'ping', payload: { i } }));
    });
    samples.push(performance.now() - start);
  }
  socket.close();
  return { name: 'WebSocket command ping', ...summarise(samples) };
}

async function main() {
  const health = await fetch(`${URL_BASE}/api/health`).then((response) => response.json()).catch((error) => {
    console.error(`Cannot reach ${URL_BASE}: ${error.message}`);
    process.exit(1);
  });

  const stateResponse = await fetch(`${URL_BASE}/api/state`, { headers }).then((response) => {
    if (!response.ok) throw new Error(`state HTTP ${response.status}`);
    return response.json();
  });

  const results = [];
  results.push(await rest('GET /api/health (no auth)', () => fetch(`${URL_BASE}/api/health`)));
  results.push(await rest('GET /api/state (full snapshot)', () => fetch(`${URL_BASE}/api/state`, { headers })));
  results.push(await rest('GET /api/search?q=ma', () => fetch(`${URL_BASE}/api/search?q=ma`, { headers })));
  results.push(await rest('GET /api/files', () => fetch(`${URL_BASE}/api/files`, { headers })));

  const clipboardSamples = [];
  for (let i = 0; i < Math.min(ROUNDS, 100); i += 1) {
    clipboardSamples.push(await timed(async () => {
      const response = await fetch(`${URL_BASE}/api/clipboard`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', text: `bench ${Date.now()} ${i}`, source: 'desktop' }),
      });
      if (!response.ok) throw new Error(`clipboard HTTP ${response.status}`);
    }));
  }
  results.push({ name: 'POST /api/clipboard', ...summarise(clipboardSamples) });

  const ws = await wsPing().catch((error) => ({ error: error.message }));
  if (ws && !ws.error) results.push(ws);

  const internal = await fetch(`${URL_BASE}/api/diagnostics/benchmark`, { method: 'POST', headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      bridge: { url: URL_BASE, version: health.version, features: health.features, authRequired: health.authRequired },
      snapshot: { apps: stateResponse.apps?.length, devices: stateResponse.devices?.length, windows: stateResponse.windows?.length },
      environment: { node: process.version, platform: `${process.platform}-${process.arch}`, cpu: internal?.environment?.cpu },
      controlPlane: results,
      internal,
    }, null, 2));
    return;
  }

  console.log(`Android DEX benchmark — ${new Date().toISOString()}`);
  console.log(`${URL_BASE} · bridge ${health.version} · node ${process.version} · ${process.platform}-${process.arch}`);
  console.log(`snapshot: ${stateResponse.apps?.length} apps, ${stateResponse.devices?.length} devices, ${stateResponse.windows?.length} windows`);
  console.log('');
  console.log('| Operation | n | min | p50 | p95 | p99 | max |');
  console.log('| :--- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of results) {
    console.log(`| ${row.name} | ${row.n} | ${row.min} | ${row.p50} | ${row.p95} | ${row.p99} | ${row.max} |`);
  }
  console.log('| _(milliseconds, loopback/LAN; see doc/BENCHMARKS.md)_ | | | | | | |');
  if (internal?.results) {
    console.log('');
    console.log('Internal encode path (from /api/diagnostics/benchmark):');
    for (const [key, value] of Object.entries(internal.results)) console.log(`  ${key}: ${value}`);
  }
  console.log('');
  console.log(internal?.disclaimer || 'Mirror latency is measured separately; see doc/BENCHMARKS.md.');
}

main().catch((error) => { console.error(error); process.exit(1); });
