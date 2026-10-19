import { $, el, emptyState, esc, hydrateIcons, icon, toast } from '../core.js';
import { t } from '../i18n.js';

export { emptyState };

export function pageHead({ kicker, title, subtitle, actions = [] } = {}) {
  const head = el('div', { class: 'page-head' });
  const body = el('div');
  if (kicker) body.append(el('div', { class: 'page-kicker' }, kicker));
  body.append(el('h1', { class: 'page-title' }, title));
  if (subtitle) body.append(el('p', { class: 'page-sub' }, subtitle));
  head.append(body);
  if (actions.length) {
    const wrap = el('div', { class: 'page-head-actions' });
    actions.forEach((action) => wrap.append(action));
    head.append(wrap);
  }
  return head;
}

export function card({ title, subtitle, iconName, actions = [], body, id } = {}) {
  const node = el('div', { class: 'card', id });
  if (title || actions.length) {
    const head = el('div', { class: 'row between', style: { marginBottom: '12px' } });
    const titleWrap = el('div');
    const heading = el('div', { class: 'card-title' });
    if (iconName) heading.innerHTML = icon(iconName);
    heading.append(el('span', {}, title || ''));
    titleWrap.append(heading);
    if (subtitle) titleWrap.append(el('div', { class: 'card-sub' }, subtitle));
    head.append(titleWrap);
    if (actions.length) {
      const actionWrap = el('div', { class: 'row' });
      actions.forEach((action) => actionWrap.append(action));
      head.append(actionWrap);
    }
    node.append(head);
  }
  if (body instanceof Node) node.append(body);
  else if (typeof body === 'string') node.insertAdjacentHTML('beforeend', body);
  return node;
}

export function button(label, { iconName, className = 'btn', onClick, title } = {}) {
  const node = el('button', { class: className, title });
  if (iconName) node.innerHTML = icon(iconName);
  if (label) node.append(document.createTextNode(label));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function tabs(items, active, onSelect) {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  items.forEach(([id, label]) => {
    const button = el('button', {
      class: `tab ${id === active ? 'is-active' : ''}`, role: 'tab', 'aria-selected': String(id === active),
    }, label);
    button.addEventListener('click', () => onSelect(id));
    bar.append(button);
  });
  return bar;
}

export function toggleRow(title, description, checked, onChange) {
  const row = el('div', { class: 'switch-row' });
  const body = el('div', { class: 'sr-body' });
  body.append(el('div', { class: 'sr-title' }, title));
  if (description) body.append(el('div', { class: 'sr-desc' }, description));
  const toggle = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(checked)), 'aria-label': title });
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  row.append(body, toggle);
  return row;
}

export async function act(ctx, fn, { success = '', type = 'success', quiet = false } = {}) {
  try {
    const result = await fn();
    if (!quiet && success) toast(success, { type });
    await ctx.api.refresh().catch(() => {});
    ctx.rerender();
    return result;
  } catch (error) {
    if (error.code === 'fairplay_ack_required') {
      ctx.toast('Accept the fair-play disclosure to enable assistance features.', { type: 'warn' });
      ctx.navigate('gaming');
      return null;
    }
    ctx.toastError(error);
    return null;
  }
}

export function statPill(label, value, iconName) {
  const node = el('span', { class: 'pill' });
  if (iconName) node.innerHTML = icon(iconName);
  node.append(document.createTextNode(`${label}${value !== undefined ? ' · ' + value : ''}`));
  return node;
}

export function codeBox(text) {
  const pre = el('pre', { class: 'code' });
  pre.textContent = text;
  return pre;
}

export function noteBox(iconName, text) {
  const node = el('div', { class: 'fairplay' });
  node.innerHTML = `${icon(iconName)}<div>${text}</div>`;
  return node;
}

export function triggerDownload(url, filename) {
  const anchor = el('a', { href: url, download: filename || '', target: url.startsWith('data:') ? '_self' : '_blank', rel: 'noopener' });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function platformLauncher() {
  if (navigator.userAgent.includes('Win')) return 'windows';
  if (navigator.userAgent.includes('Mac')) return 'macos';
  return 'linux';
}

export function avatar(name, color, size = 34) {
  const node = el('span', { class: 'avatar-c', style: { background: color || 'var(--accent)', width: `${size}px`, height: `${size}px` } });
  const parts = String(name).trim().split(/\s+/);
  node.textContent = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  return node;
}

export function sectionHeading(label) {
  return el('div', { class: 'section-title' }, label);
}

export function settingLine(title, description, control) {
  const row = el('div', { class: 'setting-line' });
  const body = el('div', { class: 'sl-body' });
  body.append(el('div', { class: 'sl-title' }, title));
  if (description) body.append(el('div', { class: 'sl-desc' }, description));
  const wrap = el('div', { class: 'sl-control' });
  if (control instanceof Node) wrap.append(control);
  row.append(body, wrap);
  return row;
}

export function refreshNote(ctx) {
  if (ctx.api.mode === 'live') return null;
  const node = el('div', { class: 'pill warn', title: 'Start the bridge to control hardware' });
  node.innerHTML = `${icon('info')} Demo data`;
  return node;
}

export function hydrate(node) { hydrateIcons(node); return node; }
