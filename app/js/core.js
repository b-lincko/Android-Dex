/**
 * Console core: DOM helpers, formatting, preferences, overlays and shortcuts.
 * No framework, no build step.
 */
import { getLocale, setLocale, t, translateDom } from './i18n.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const esc = (value = '') => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${esc(name)}"></use></svg>`;
}

/** Replace `<i data-icon="x">` placeholders with sprite <use> references. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((node) => {
    if (node.dataset.hydrated === '1') return;
    const name = node.dataset.icon;
    node.innerHTML = icon(name);
    node.dataset.hydrated = '1';
  });
}

export async function loadIconSprite() {
  try {
    const response = await fetch('assets/icons.svg');
    if (!response.ok) throw new Error(`sprite HTTP ${response.status}`);
    $('#icon-sprite').innerHTML = await response.text();
  } catch (error) {
    console.warn('icon sprite unavailable', error);
  }
}

// ── Formatting ─────────────────────────────────────────────────────────
export function fmtBytes(bytes, digits = 1) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let index = -1;
  let current = value;
  do { current /= 1024; index += 1; } while (current >= 1024 && index < units.length - 1);
  return `${current.toFixed(digits)} ${units[index]}`;
}

export function fmtNumber(value) {
  return new Intl.NumberFormat(getLocale()).format(Number(value) || 0);
}

export function fmtTime(iso, { seconds = false } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(getLocale(), { day: '2-digit', month: 'short' });
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const abs = Math.abs(diff);
  const format = (value, unit) => {
    try {
      return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(Math.round(value), unit);
    } catch { return `${Math.round(value)} ${unit}`; }
  };
  if (abs < 45_000) return format(-Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return format(-Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return format(-Math.round(diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return format(-Math.round(diff / 86_400_000), 'day');
  return fmtDate(iso);
}

export function fmtDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function colorFrom(value = '') {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) hash = (hash * 31 + String(value).charCodeAt(i)) % 360;
  return `hsl(${hash} 62% 58%)`;
}

export const debounce = (fn, delay = 180) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export const uid = (prefix = 'x') => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

// ── Storage ────────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'dex.';
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* quota */ }
  },
  remove(key) {
    try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* ignore */ }
  },
};

// ── Event bus ──────────────────────────────────────────────────────────
export class Bus {
  constructor() { this.handlers = new Map(); }
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) { this.handlers.get(event)?.delete(handler); }
  emit(event, payload) {
    for (const handler of this.handlers.get(event) || []) {
      try { handler(payload); } catch (error) { console.error(`handler for ${event}`, error); }
    }
  }
}
export const bus = new Bus();

// ── Application preferences ────────────────────────────────────────────
export function applyPreferences(settings = {}) {
  const root = document.documentElement;
  const theme = settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : settings.theme || 'dark';
  root.dataset.theme = theme;
  root.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  root.dataset.dyslexia = settings.dyslexiaFont ? 'on' : 'off';
  root.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
  root.style.setProperty('--scale', String(clamp(settings.uiScale || 100, 80, 150) / 100));
  root.dataset.density = settings.density || 'comfortable';
  const locale = setLocale(settings.locale || 'en');
  if (settings.rtl && locale !== 'ar') root.dir = 'rtl';
  translateDom();
  const a11yBadge = $('#status-a11y');
  if (a11yBadge) a11yBadge.hidden = !settings.highContrast;
  const themeIcon = $('#theme-toggle use');
  if (themeIcon) themeIcon.setAttribute('href', theme === 'light' ? '#i-moon' : '#i-sun');
  return { theme, locale };
}

export function themeIcon(name) {
  const node = $('#theme-toggle');
  if (node) node.innerHTML = icon(name);
}

// ── Overlays ───────────────────────────────────────────────────────────
let modalStack = [];

export function openModal({ title, subtitle, body, footer, wide = false, small = false, onClose, labelledBy = 'modal-title' } = {}) {
  const backdrop = el('div', { class: 'modal-backdrop', role: 'presentation' });
  const previousFocus = document.activeElement;
  const modal = el('div', {
    class: `modal${wide ? ' wide' : ''}${small ? ' small' : ''}`,
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy,
  });
  const head = el('div', { class: 'modal-head' });
  const heading = el('div');
  heading.append(el('h2', { id: labelledBy }, title || ''));
  if (subtitle) heading.append(el('p', {}, subtitle));
  head.append(heading);
  const closeBtn = el('button', { class: 'icon-btn', 'aria-label': t('common.close'), html: icon('x') });
  head.append(closeBtn);
  modal.append(head);

  if (body !== undefined) {
    const bodyNode = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyNode.innerHTML = body;
    else if (body) bodyNode.append(body);
    modal.append(bodyNode);
  }
  if (footer) {
    const foot = el('div', { class: 'modal-foot' });
    if (typeof footer === 'string') foot.innerHTML = footer;
    else foot.append(footer);
    modal.append(foot);
  }
  backdrop.append(modal);
  $('#modal-root').append(backdrop);
  hydrateIcons(modal);

  const close = (reason = 'dismiss') => {
    const index = modalStack.indexOf(backdrop);
    if (index === -1) return;
    modalStack.splice(index, 1);
    backdrop.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    onClose?.(reason);
  };
  closeBtn.addEventListener('click', () => close('close'));
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close('backdrop'); });
  const entry = { backdrop, modal, close, previousFocus };
  modalStack.push(entry);

  setTimeout(() => {
    const focusable = modal.querySelector('input:not([type=hidden]), textarea, select, button.btn-primary, button');
    focusable?.focus();
  }, 30);

  const onKey = (event) => {
    if (modalStack.at(-1)?.backdrop !== backdrop) return;
    if (event.key === 'Escape') { event.preventDefault(); close('escape'); }
    if (event.key === 'Tab') {
      const focusables = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop._removeKeyHandler = () => document.removeEventListener('keydown', onKey);
  return entry;
}

export function closeModal(entry = modalStack.at(-1)) {
  if (!entry) return;
  entry.backdrop._removeKeyHandler?.();
  entry.backdrop.remove();
  modalStack = modalStack.filter((item) => item !== entry);
  entry.previousFocus?.focus?.();
}

export function closeAllModals() {
  for (const entry of [...modalStack]) closeModal(entry);
}

export function confirmDialog({ title, message, confirmLabel = t('common.confirm'), danger = false, cancelLabel = t('common.cancel') } = {}) {
  return new Promise((resolve) => {
    const body = el('p', { class: 'muted', style: { fontSize: '.82rem', lineHeight: '1.6' } }, message || '');
    const foot = el('div', { class: 'row', style: { gap: '8px' } });
    const cancel = el('button', { class: 'btn btn-ghost' }, cancelLabel);
    const confirm = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirmLabel);
    foot.append(cancel, confirm);
    const modal = openModal({ title, body, footer: foot, small: true, onClose: () => resolve(false) });
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      modal.backdrop._removeKeyHandler?.();
      closeModal(modal);
    };
    cancel.addEventListener('click', () => settle(false));
    confirm.addEventListener('click', () => settle(true));
    modal.backdrop.querySelector('.icon-btn')?.addEventListener('click', () => settle(false));
    setTimeout(() => confirm.focus(), 40);
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = t('common.save') } = {}) {
  return new Promise((resolve) => {
    const input = el(multiline ? 'textarea' : 'input', { class: multiline ? 'textarea' : 'input', placeholder, value });
    if (!multiline) input.value = value;
    const body = el('div', { class: 'field' });
    if (label) body.append(el('label', {}, label));
    body.append(input);
    const foot = el('div', { class: 'row', style: { gap: '8px' } });
    const cancel = el('button', { class: 'btn btn-ghost' }, t('common.cancel'));
    const confirm = el('button', { class: 'btn btn-primary' }, confirmLabel);
    foot.append(cancel, confirm);
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      modal.backdrop._removeKeyHandler?.();
      closeModal(modal);
    };
    const modal = openModal({ title, body, footer: foot, small: true, onClose: () => settle(null) });
    cancel.addEventListener('click', () => settle(null));
    confirm.addEventListener('click', () => settle(input.value.trim() || null));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !multiline && !event.isComposing) { event.preventDefault(); settle(input.value.trim() || null); }
    });
    setTimeout(() => { input.focus(); input.select?.(); }, 40);
  });
}

export function toast(message, { title = '', type = 'success', timeout = 3600 } = {}) {
  const icons = { success: 'circle-check', error: 'circle-x', warn: 'triangle-alert', info: 'info' };
  const node = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' });
  node.innerHTML = `${icon(icons[type] || 'info')}
    <div style="min-width:0;flex:1">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
      <div class="toast-body">${esc(message)}</div>
    </div>
    <button class="toast-close" aria-label="${esc(t('common.close'))}">${icon('x')}</button>`;
  $('#toast-root').append(node);
  const remove = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.toast-close').addEventListener('click', remove);
  if (timeout) setTimeout(remove, timeout);
  return node;
}

export function toastError(error) {
  const message = error?.message || String(error);
  toast(message, { type: 'error', title: t('common.error') });
}

// ── Clipboard ──────────────────────────────────────────────────────────
export async function copyText(text, { quiet = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    area.value = text;
    document.body.append(area);
    area.select();
    try { document.execCommand('copy'); } finally { area.remove(); }
  }
  if (!quiet) toast(t('toast.copied'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

// ── Small controls ─────────────────────────────────────────────────────
export function switchControl(checked, onChange, label = '') {
  const node = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(Boolean(checked)),
    'aria-label': label || 'Toggle', type: 'button',
  });
  node.addEventListener('click', () => {
    const next = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return node;
}

export function settingRow({ title, description, control, id }) {
  const row = el('div', { class: 'setting-line' });
  if (id) row.id = id;
  const body = el('div', { class: 'sl-body' });
  body.append(el('div', { class: 'sl-title' }, title));
  if (description) body.append(el('div', { class: 'sl-desc' }, description));
  const wrap = el('div', { class: 'sl-control' });
  if (control instanceof Node) wrap.append(control);
  row.append(body, wrap);
  return row;
}

export function selectControl(options, value, onChange) {
  const select = el('select', { class: 'select' });
  for (const option of options) {
    const node = el('option', { value: option.value }, option.label);
    if (String(option.value) === String(value)) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function emptyState(iconName, title, text = '') {
  const wrap = el('div', { class: 'empty' });
  wrap.innerHTML = `${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}`;
  return wrap;
}

export function tagPill(label, cls = '') {
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

export const timeAgo = fmtRelative;

// ── Keyboard shortcuts ─────────────────────────────────────────────────
const shortcutHandlers = new Map();
let shortcutMap = {};

const NAMED_KEYS = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

export function acceleratorFromEvent(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (!key || key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null;
  key = NAMED_KEYS[key] || (key.length === 1 ? key.toUpperCase() : key);
  parts.push(key);
  return parts.join('+');
}

export function normalizeAccelerator(value = '') {
  return String(value).split('+').map((part, index, all) => {
    const clean = part.trim().toLowerCase();
    if (clean === 'ctrl' || clean === 'cmd' || clean === 'meta') return 'Ctrl';
    if (clean === 'alt' || clean === 'option') return 'Alt';
    if (clean === 'shift') return 'Shift';
    if (index === all.length - 1) return part.trim().length === 1 ? part.trim().toUpperCase() : ({ esc: 'Esc', space: 'Space' }[clean] || part.trim());
    return part.trim();
  }).join('+');
}

export function registerShortcut(action, handler) {
  shortcutHandlers.set(action, handler);
}

export function setShortcutMap(hotkeys = {}) {
  shortcutMap = Object.fromEntries(Object.entries(hotkeys).map(([action, value]) => [normalizeAccelerator(value), action]));
}

export function shortcutMapFor(action) {
  return Object.entries(shortcutMap).find(([, value]) => value === action)?.[0] || '';
}

export function initShortcuts() {
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (event.key === 'Escape') {
      if ($('.palette-backdrop')) { closeAllModals(); $('.palette-backdrop')?.remove(); }
      return;
    }
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return;
    if (accelerator === 'Ctrl+K') {
      event.preventDefault();
      bus.emit('palette:open');
      return;
    }
    if (accelerator === 'Ctrl+/' || (event.shiftKey && event.key === '?' && !typing)) {
      event.preventDefault();
      bus.emit('shortcuts:open');
      return;
    }
    const action = shortcutMap[accelerator];
    if (!action || !shortcutHandlers.has(action)) return;
    if (typing && !['screenshot', 'record', 'lock', 'search', 'clipboard'].includes(action)) return;
    event.preventDefault();
    shortcutHandlers.get(action)?.();
  });
}

// ── Misc ───────────────────────────────────────────────────────────────
export function applyDensity(density) {
  document.documentElement.dataset.density = density || 'comfortable';
}

export function activeViewFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const allowed = ['desktop', 'apps', 'phone', 'files', 'clipboard', 'notifications', 'media', 'gaming', 'settings', 'developer'];
  return allowed.includes(hash) ? hash : 'desktop';
}

export function setViewHash(view) {
  if (location.hash !== `#/${view}`) history.replaceState(null, '', `#/${view}`);
}

export function makeSvgPlaceholder(width = 640, height = 360, label = 'Android DEX') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1520"/><stop offset=".5" stop-color="#12303a"/><stop offset="1" stop-color="#1b1526"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <g fill="none" stroke="rgba(255,255,255,.14)"><rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8"/></g>
    <text x="50%" y="50%" fill="rgba(255,255,255,.55)" font-family="Inter,sans-serif" font-size="${Math.round(width / 28)}" text-anchor="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function relativeClock(now = new Date()) {
  return now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}
