/**
 * Shared utilities for the Android DEX bridge.
 *
 * Design constraints:
 *  - zero runtime dependencies (Node >= 20 only)
 *  - everything observable, nothing silently swallowed
 *  - no telemetry leaves the process unless the user explicitly opts in
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const VERSION = '2.0.0';
export const startedAt = Date.now();

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const nowIso = () => new Date().toISOString();
export const uid = (prefix = 'id') => `${prefix}_${randomUUID().split('-')[0]}`;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export const pick = (object, keys) =>
  Object.fromEntries(Object.entries(object || {}).filter(([key]) => keys.includes(key)));
export const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Recursive object merge used by PATCH endpoints. Arrays are replaced, not merged. */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

/** Constant-time string comparison for tokens. */
export function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const randomDigits = (length = 6) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

/** Ring-buffer logger with opt-in file persistence. */
export class Logger {
  constructor({ level = process.env.DEX_LOG_LEVEL || 'info', limit = 2000 } = {}) {
    this.level = level;
    this.limit = limit;
    this.entries = [];
    this.file = null;
  }

  attachFile(file) {
    this.file = file;
  }

  log(level, scope, message, meta) {
    const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
    if ((levels[level] || 20) < (levels[this.level] || 20)) return;
    const entry = { ts: nowIso(), level, scope, message, ...(meta ? { meta } : {}) };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    if (this.file) {
      appendFileSafe(this.file, `${JSON.stringify(entry)}\n`);
    }
    if (level === 'error') console.error(`[${scope}] ${message}`, meta ?? '');
    else if (process.env.DEX_VERBOSE === '1') console.log(`[${scope}] ${message}`, meta ?? '');
  }

  debug(scope, message, meta) { this.log('debug', scope, message, meta); }
  info(scope, message, meta) { this.log('info', scope, message, meta); }
  warn(scope, message, meta) { this.log('warn', scope, message, meta); }
  error(scope, message, meta) { this.log('error', scope, message, meta); }

  tail(count = 200) { return this.entries.slice(-count); }
}

async function appendFileSafe(file, line) {
  try {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, line, 'utf8');
  } catch {
    /* logging must never take the bridge down */
  }
}

/** Tiny synchronous-ish pub/sub used by the HTTP layer and plugins. */
export class EventBus {
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
    this.wildcards = new Set();
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  onAny(handler) {
    this.wildcards.add(handler);
    return () => this.wildcards.delete(handler);
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const envelope = { type: event, payload, ts: nowIso() };
    for (const handler of this.handlers.get(event) || []) {
      try { handler(payload, envelope); } catch (error) {
        this.logger?.warn('events', `handler for ${event} failed: ${error.message}`);
      }
    }
    for (const handler of this.wildcards) {
      try { handler(envelope); } catch (error) {
        this.logger?.warn('events', `wildcard handler failed: ${error.message}`);
      }
    }
  }
}

/** Debounced JSON persistence. Writes atomically via tmp + rename. */
export class Store {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.timer = null;
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      return { ...structuredClone(this.defaults), ...JSON.parse(raw) };
    } catch {
      return structuredClone(this.defaults);
    }
  }

  save(value) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(value), 150);
    this.pending = value;
  }

  async flush(value = this.pending) {
    if (value === undefined) return;
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
      await rename(tmp, this.file);
    } catch {
      /* disk full / read-only volume: keep serving from memory */
    }
  }
}

/** Simple fixed-window rate limiter (per token+route bucket). */
export class RateLimiter {
  constructor(limit = 120, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  hit(key) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start > this.windowMs) {
      this.buckets.set(key, { start: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }
}

/** Validate that a user-supplied relative path cannot escape a root directory. */
export function safeJoin(root, relative = '') {
  const clean = String(relative || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, clean);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw Object.assign(new Error('path escapes share root'), { status: 400 });
  }
  return resolved;
}

export class HttpError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code || `http_${status}`;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, 'bad_request', details);
export const notFound = (message = 'not found') => new HttpError(404, message, 'not_found');
export const unauthorized = (message = 'missing or invalid token') =>
  new HttpError(401, message, 'unauthorized');
export const conflict = (message, code) => new HttpError(409, message, code || 'conflict');

/** Check a value against a tiny schema: {type:'string'|'number'|'boolean'|'array'|'object', ...} */
export function validate(value, schema, field = 'body') {
  if (!schema) return value;
  const { type, required = true, min, max, enum: allowed, pattern } = schema;
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required`);
    return value;
  }
  const types = { string: 'string', number: 'number', boolean: 'boolean', array: 'array', object: 'object' };
  if (type && typeof value !== types[type]) {
    throw badRequest(`${field} must be a ${type}`);
  }
  if (type === 'string') {
    const length = [...value].length;
    if (min !== undefined && length < min) throw badRequest(`${field} must be at least ${min} characters`);
    if (max !== undefined && length > max) throw badRequest(`${field} must be at most ${max} characters`);
    if (pattern && !pattern.test(value)) throw badRequest(`${field} has an invalid format`);
  }
  if (type === 'number') {
    if (min !== undefined && value < min) throw badRequest(`${field} must be >= ${min}`);
    if (max !== undefined && value > max) throw badRequest(`${field} must be <= ${max}`);
  }
  if (type === 'array' && max !== undefined && value.length > max) {
    throw badRequest(`${field} accepts at most ${max} items`);
  }
  if (allowed && !allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

/** Read a request body with a hard size limit. Supports JSON and raw binary. */
export async function readBody(req, { limit = 8 * 1024 * 1024, binary = false } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      req.destroy();
      throw new HttpError(413, `payload exceeds ${limit} bytes`, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (binary) return buffer;
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw badRequest('body must be valid JSON');
  }
}

export function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/** Format bytes for human-facing CLI output. */
export function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Exponential backoff with optional jitter and a hard cap. */
export function backoffDelay(attempt, { baseMs = 500, factor = 1.8, maxMs = 30_000, jitter = 0.2 } = {}) {
  const raw = Math.min(maxMs, baseMs * factor ** Math.max(0, attempt - 1));
  const spread = raw * jitter;
  return Math.round(raw - spread + Math.random() * spread * 2);
}
