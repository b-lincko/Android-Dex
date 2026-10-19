import { copyText, el, esc, fmtBytes, fmtRelative, hydrateIcons, icon, openModal, promptDialog, toast, toastError } from '../core.js';
import { t } from '../i18n.js';
import { act, button, card, emptyState, pageHead, refreshNote, triggerDownload } from './shared.js';

export function renderFiles(ctx) {
  const dir = ctx.viewState.filesDir || '';
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Shared storage',
    title: t('files.title'),
    subtitle: t('files.sub'),
    actions: [
      refreshNote(ctx),
      button(t('files.newFolder'), { iconName: 'folder-plus', className: 'btn btn-sm', onClick: () => createFolder(ctx) }),
      button(t('files.mount'), { iconName: 'hard-drive', className: 'btn btn-sm', onClick: () => mountDialog(ctx) }),
    ].filter(Boolean),
  }));

  const layout = el('div', { class: 'files-layout' });
  const main = card({ body: el('div') });
  const top = el('div', { class: 'row between', style: { marginBottom: '10px', gap: '10px' } });
  const crumbs = el('div', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  const actions = el('div', { class: 'row' });
  const uploadInput = el('input', { type: 'file', hidden: true, multiple: true });
  const uploadBtn = button(t('files.upload'), { iconName: 'upload', className: 'btn btn-primary btn-sm', onClick: () => uploadInput.click() });
  uploadInput.addEventListener('change', () => uploadFiles(ctx, [...uploadInput.files], dir));
  actions.append(uploadBtn, uploadInput);
  top.append(crumbs, actions);
  main.append(top);

  const drop = el('div', { class: 'dropzone', style: { marginBottom: '12px' } });
  drop.innerHTML = `${icon('upload-cloud')}<div>${t('files.drop')}</div><div class="dim tiny-text" style="margin-top:3px">${t('files.dropHint')}</div>`;
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); if (type === 'dragleave') drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (event) => {
    drop.classList.remove('is-over');
    uploadFiles(ctx, [...event.dataTransfer.files], dir);
  });
  main.append(drop);

  const tableWrap = el('div', { style: { overflowX: 'auto' } });
  tableWrap.append(el('div', { class: 'dim tiny-text' }, t('common.loading')));
  main.append(tableWrap);
  layout.append(main);

  const side = el('div', { class: 'stack' });
  const usage = card({ iconName: 'hard-drive', title: t('files.usage'), body: el('div', { id: 'files-usage' }) });
  usage.querySelector('#files-usage').innerHTML = `<div class="dim tiny-text">${t('common.loading')}</div>`;
  side.append(usage);
  const mountCard = card({
    iconName: 'monitor-smartphone', title: 'Mount as a drive',
    subtitle: 'Windows, macOS and Linux can mount the share over WebDAV.',
    body: el('div', { class: 'stack' },
      el('div', { class: 'pill' }, icon('server'), '/dav/'),
      button(t('files.mount'), { iconName: 'external-link', className: 'btn btn-sm', onClick: () => mountDialog(ctx) })),
  });
  side.append(mountCard);
  layout.append(side);
  page.append(layout);

  hydrateIcons(main);
  loadListing(ctx, dir, { crumbs, tableWrap, usage });
  return page;
}

async function loadListing(ctx, dir, { crumbs, tableWrap, usage }) {
  let listing;
  try {
    listing = await ctx.api.request('/api/files', { query: { dir } });
  } catch (error) {
    tableWrap.innerHTML = '';
    tableWrap.append(emptyState('triangle-alert', 'Could not load the share', error.message));
    return;
  }
  const crumbRoot = el('button', { class: `crumb ${dir ? '' : 'is-last'}` }, 'Share');
  crumbRoot.addEventListener('click', () => { ctx.setViewState({ filesDir: '' }); ctx.rerender(); });
  crumbs.append(crumbRoot);
  listing.crumbs.forEach((crumb, index) => {
    crumbs.append(el('span', { class: 'dim' }, '/'));
    const node = el('button', { class: `crumb ${index === listing.crumbs.length - 1 ? 'is-last' : ''}` }, crumb.name);
    node.addEventListener('click', () => { ctx.setViewState({ filesDir: crumb.path }); ctx.rerender(); });
    crumbs.append(node);
  });

  const total = listing.items.reduce((sum, item) => sum + (item.size || 0), 0);
  const usageNode = usage.querySelector('#files-usage');
  usageNode.innerHTML = `<div class="row between"><strong style="font-size:.95rem">${esc(listing.share?.totalLabel || fmtBytes(total))}</strong><span class="pill">${listing.items.length} items</span></div>
    <div class="usage-bar" style="margin-top:8px"><span style="width:${Math.min(100, Math.max(3, total / (50 * 1024 * 1024) * 100))}%"></span></div>
    <div class="dim tiny-text" style="margin-top:6px">${esc(listing.share?.path || '')}</div>`;

  tableWrap.innerHTML = '';
  if (!listing.items.length) {
    tableWrap.append(emptyState('folder-open', t('files.empty'), 'Drop files above or create a folder.'));
    return;
  }
  const table = el('table', { class: 'file-table' });
  table.innerHTML = `<thead><tr><th>Name</th><th>Size</th><th>Modified</th><th style="text-align:right">Actions</th></tr></thead>`;
  const body = el('tbody');
  listing.items.forEach((item) => {
    const row = el('tr');
    const nameCell = el('td');
    const nameButton = el('button', { class: `file-name ${item.kind === 'folder' ? 'folder' : ''}` });
    nameButton.innerHTML = `${icon(item.kind === 'folder' ? 'folder' : fileIcon(item.mime))}<span>${esc(item.name)}</span>`;
    nameButton.addEventListener('click', () => {
      if (item.kind === 'folder') { ctx.setViewState({ filesDir: item.path }); ctx.rerender(); }
      else preview(ctx, item);
    });
    nameCell.append(nameButton);
    row.append(nameCell, el('td', { class: 'dim' }, item.kind === 'folder' ? '—' : fmtBytes(item.size)), el('td', { class: 'dim' }, fmtRelative(item.modified)));

    const actionsCell = el('td');
    const actionWrap = el('div', { class: 'file-actions' });
    if (item.kind === 'file') {
      actionWrap.append(iconButton('download', 'Download', () => triggerDownload(ctx.downloadUrl(item.path), item.name)));
      actionWrap.append(iconButton('smartphone', t('files.push'), async () => {
        try {
          await ctx.api.request('/api/files/push', { method: 'POST', body: { path: item.path } });
          toast(`${item.name} pushed to /sdcard/Download`);
        } catch (error) { ctx.toastError(error); }
      }));
    }
    actionWrap.append(iconButton('copy', 'Copy path', () => copyText(item.path)));
    actionWrap.append(iconButton('trash-2', t('common.delete'), async () => {
      if (!(await ctx.confirmDialog({ title: `Delete ${item.name}?`, message: 'This removes it from the shared folder. The phone copy is not affected.', confirmLabel: t('common.delete'), danger: true }))) return;
      try {
        await ctx.api.request('/api/files', { method: 'DELETE', query: { path: item.path } });
        toast(`${item.name} deleted`);
        ctx.rerender();
      } catch (error) { ctx.toastError(error); }
    }));
    actionsCell.append(actionWrap);
    row.append(actionsCell);
    body.append(row);
  });
  table.append(body);
  tableWrap.append(table);
}

function fileIcon(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'music';
  if (mime.includes('pdf')) return 'file-text';
  if (mime.includes('zip') || mime.includes('android')) return 'package';
  if (mime.startsWith('text/') || mime.includes('json')) return 'file-text';
  return 'file';
}

function iconButton(iconName, label, onClick) {
  const node = el('button', { class: 'icon-btn', title: label, 'aria-label': label });
  node.innerHTML = icon(iconName);
  node.addEventListener('click', onClick);
  return node;
}

async function uploadFiles(ctx, files, dir) {
  if (!files.length) return;
  let uploaded = 0;
  for (const file of files) {
    try {
      await ctx.api.uploadFile(file, dir);
      uploaded += 1;
    } catch (error) { toastError(error); }
  }
  if (uploaded) {
    toast(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded to ${dir || 'the share'}`);
    await ctx.api.refresh().catch(() => {});
    ctx.rerender();
  }
}

async function createFolder(ctx) {
  const name = await promptDialog({ title: t('files.newFolder'), label: t('files.createFolder'), placeholder: 'New folder' });
  if (!name) return;
  const path = ctx.viewState.filesDir ? `${ctx.viewState.filesDir}/${name}` : name;
  try {
    await ctx.api.request('/api/files/mkdir', { method: 'POST', body: { path } });
    toast('Folder created');
    ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

function preview(ctx, item) {
  const url = ctx.downloadUrl(item.path);
  const body = el('div');
  if (item.mime?.startsWith('image/')) {
    body.append(el('img', { src: url, alt: item.name, style: { width: '100%', borderRadius: '10px' } }));
  } else if (item.mime?.startsWith('video/')) {
    body.append(el('video', { src: url, controls: true, style: { width: '100%', borderRadius: '10px' } }));
  } else if (item.mime?.startsWith('text/') || item.mime?.includes('json')) {
    fetch(url).then((response) => response.text()).then((text) => {
      body.innerHTML = `<pre class="code" style="max-height:46vh;overflow:auto">${esc(text.slice(0, 20000))}</pre>`;
    }).catch(() => { body.innerHTML = '<p class="dim">Preview unavailable in demo mode.</p>'; });
  } else {
    body.innerHTML = `<div class="empty">${icon('file')}<h3>${esc(item.name)}</h3><p>${esc(item.mime)} · ${fmtBytes(item.size)}</p></div>`;
  }
  openModal({
    title: item.name, subtitle: `${item.path} · ${fmtBytes(item.size)}`, body, wide: true,
    footer: button(t('common.download'), { iconName: 'download', className: 'btn btn-primary', onClick: () => triggerDownload(url, item.name) }),
  });
}

function mountDialog(ctx) {
  ctx.api.request('/api/mount').then((data) => {
    const body = el('div', { class: 'stack' });
    body.append(el('div', { class: 'field' }, el('label', {}, t('files.webdav')), el('input', { class: 'input mono-text', readonly: true, value: data.webdav?.url || `${location.origin}/dav/` })));
    body.append(button('Copy WebDAV URL', { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(data.webdav?.url || '') }));
    const instructions = el('div', { class: 'stack' });
    const rows = [
      ['Windows', [...(data.instructions?.windows || []), 'net use Z: ' + (data.webdav?.url || 'http://bridge:8787/dav')]],
      ['macOS', data.instructions?.macos || ['Finder → Go → Connect to Server']],
      ['Linux', data.instructions?.linux || ['sudo mount -t davfs http://bridge:8787/dav /mnt/dex']],
    ];
    rows.forEach(([label, lines]) => {
      const block = el('div');
      block.innerHTML = `<div class="tiny-text dim" style="margin-bottom:4px">${label}</div><pre class="code">${esc(lines.join('\n'))}</pre>`;
      instructions.append(block);
    });
    body.append(instructions);
    body.append(el('p', { class: 'dim tiny-text' }, `Auth: ${data.webdav?.auth || 'none'} · Host folder: ${data.shareDir || '—'}`));
    openModal({ title: t('files.mountTitle'), subtitle: t('files.mountSub'), body, wide: true });
  }).catch(toastError);
}
