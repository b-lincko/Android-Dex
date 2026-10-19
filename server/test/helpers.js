import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBridge } from '../src/index.js';

export const TOKEN = 'test-token-123';

export async function startBridge(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dex-test-'));
  const bridge = await createBridge({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    dataDir: path.join(dir, 'data'),
    shareDir: path.join(dir, 'share'),
    appDir: options.appDir ?? null,
    logLevel: 'silent',
    ...options,
  });
  await bridge.start({ telemetry: false });

  const request = async (pathname, { method = 'GET', body, headers = {}, token = TOKEN } = {}) => {
    const response = await fetch(`${bridge.url}${pathname}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: response.status, headers: response.headers, json, text, response };
  };

  const raw = (pathname, { method = 'GET', headers = {}, body = undefined, token = TOKEN } = {}) =>
    fetch(`${bridge.url}${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body,
    });

  return {
    bridge,
    dir,
    request,
    raw,
    async stop() {
      await bridge.stop();
      // Windows keeps handles open briefly after a server closes; retry instead of
      // failing the suite with EPERM/EBUSY.
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
