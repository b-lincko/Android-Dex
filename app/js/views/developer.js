import {
  copyText, downloadText, el, esc, fmtBytes, fmtDuration, fmtRelative, icon, openModal, toast,
} from '../core.js';
import { t } from '../i18n.js';
import { act, button, card, codeBox, emptyState, pageHead, refreshNote, tabs } from './shared.js';

export function renderDeveloper(ctx) {
  const tab = ctx.viewState.devTab || 'api';
  const page = el('div', { class: 'page' });
  page.append(pageHead({
    kicker: 'Developer tools',
    title: t('developer.title'),
    subtitle: t('developer.sub'),
    actions: [
      refreshNote(ctx),
      button(t('developer.openapi'), {
        iconName: 'file-json', className: 'btn btn-sm',
        onClick: async () => {
          try {
            const spec = await (await fetch(new URL('api/openapi.json', ctx.api.baseUrl || location.href).href)).json();
            openModal({ title: 'OpenAPI 3.1', subtitle: `${Object.keys(spec.paths || {}).length} paths · generated from the live router`, body: codeBox(JSON.stringify(spec, null, 2)), wide: true, footer: button('Download', { iconName: 'download', className: 'btn btn-primary', onClick: () => downloadText(JSON.stringify(spec, null, 2), 'android-dex-openapi.json', 'application/json') }) });
          } catch (error) { ctx.toastError(error); }
        },
      }),
    ].filter(Boolean),
  }));

  page.append(tabs([
    ['api', t('developer.api')],
    ['ws', t('developer.ws')],
    ['plugins', t('developer.plugins')],
    ['diagnostics', t('developer.diagnostics')],
    ['bench', t('developer.benchmark')],
    ['sdk', t('developer.sdk')],
  ], tab, (next) => { ctx.setViewState({ devTab: next }); ctx.rerender(); }));

  if (tab === 'api') page.append(apiPanel(ctx));
  else if (tab === 'ws') page.append(wsPanel(ctx));
  else if (tab === 'plugins') page.append(pluginsPanel(ctx));
  else if (tab === 'diagnostics') page.append(diagnosticsPanel(ctx));
  else if (tab === 'bench') page.append(benchPanel(ctx));
  else page.append(sdkPanel(ctx));
  return page;
}

function apiPanel(ctx) {
  const grid = el('div', { class: 'dev-grid' });
  const quick = card({
    iconName: 'terminal', title: t('developer.api'),
    subtitle: 'Every console action is a documented REST call.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      wrap.append(codeBox(`curl -H "Authorization: Bearer $DEX_TOKEN" \\
  ${ctx.api.baseUrl || 'http://127.0.0.1:8787'}/api/state`));
      wrap.append(el('div', { class: 'row wrap' },
        button('Copy', { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(`curl -H "Authorization: Bearer $DEX_TOKEN" ${ctx.api.baseUrl || 'http://127.0.0.1:8787'}/api/state`) }),
        button('OpenAPI JSON', { iconName: 'external-link', className: 'btn btn-sm', onClick: () => window.open(new URL('api/openapi.json', ctx.api.baseUrl || location.href).href, '_blank', 'noopener') }),
        button('Health', { iconName: 'activity', className: 'btn btn-sm', onClick: () => showHealth(ctx) })));
      return wrap;
    })(),
  });
  grid.append(quick);

  const groups = [
    ['State & settings', ['GET /api/state', 'PATCH /api/settings', 'GET /api/search?q=']],
    ['Devices & pairing', ['POST /api/devices/connect', 'POST /api/pair/start', 'GET /api/pair/status']],
    ['Windows', ['POST /api/windows', 'POST /api/windows/:id/snap', 'POST /api/windows/layout']],
    ['Phone', ['POST /api/telephony/messages', 'POST /api/telephony/calls', 'POST /api/notifications/:id/action']],
    ['Files & clipboard', ['POST /api/files/upload', 'GET /api/clipboard', 'GET /api/mount']],
    ['Media & input', ['POST /api/media/route', 'POST /api/media/webcam', 'POST /api/input/stylus']],
    ['Gaming', ['GET /api/gaming/profiles', 'POST /api/gaming/import', 'POST /api/gaming/fairplay/ack']],
    ['Ops', ['GET /api/diagnostics', 'POST /api/updates/check', 'GET /api/plugins']],
  ];
  const endpointBody = el('div');
  const endpoints = card({ iconName: 'list', title: 'Endpoint map', body: endpointBody });
  const body = endpointBody;
  groups.forEach(([label, routes]) => {
    const group = el('div', { style: { marginBottom: '10px' } });
    group.innerHTML = `<div class="section-title">${label}</div>`;
    routes.forEach((route) => {
      const [method, path] = route.split(' ');
      const row = el('div', { class: 'log-line' });
      row.innerHTML = `<span class="pill ${method === 'POST' ? 'accent' : method === 'PATCH' ? 'warn' : 'ok'}" style="min-width:48px;justify-content:center">${method}</span>
        <code class="mono-text">${esc(path)}</code>`;
      row.style.cursor = 'pointer';
      row.title = 'Copy as curl';
      row.addEventListener('click', () => {
        copyText(`curl -X ${method} -H "Authorization: Bearer $DEX_TOKEN" -H "Content-Type: application/json" ${ctx.api.baseUrl || 'http://127.0.0.1:8787'}${path.split('?')[0]}`);
      });
      group.append(row);
    });
    body.append(group);
  });
  grid.append(endpoints);

  const wsCard = card({
    iconName: 'radio', title: t('developer.ws'),
    subtitle: 'Bidirectional commands and event fan-out.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      wrap.append(codeBox(`const ws = new WebSocket('ws://127.0.0.1:8787/ws?token=' + token);
ws.onmessage = (event) => console.log(JSON.parse(event.data));
ws.send(JSON.stringify({ type: 'command', id: 1, action: 'window.snap',
  payload: { id: 'win_messages', zone: 'left-half' } }));`));
      wrap.append(el('div', { class: 'tiny-text dim' }, 'Actions: launch, media.control, clipboard.add, sms.send, call.start, window.snap, settings.patch, search, ping.'));
      return wrap;
    })(),
  });
  grid.append(wsCard);

  const cliCard = card({
    iconName: 'square-terminal', title: t('developer.cli'),
    subtitle: 'The CLI is a thin client over this API, so it works over SSH too.',
    body: codeBox(`android-dex serve --port 8787
android-dex devices
android-dex launch com.google.android.apps.messaging
android-dex clipboard set "reviewed build 2.0.0"
android-dex sms send --to "+4915123456789" --text "on my way"
android-dex screenshot --label before-fix
android-dex profiles export gp_delta
android-dex bench`),
  });
  grid.append(cliCard);
  return grid;
}

async function showHealth(ctx) {
  try {
    const health = await ctx.api.request('/api/health').catch(() => null);
    const diag = await ctx.api.request('/api/diagnostics').catch(() => null);
    const body = el('div', { class: 'stack' });
    body.append(codeBox(JSON.stringify({ health: health || 'unavailable (demo)', diagnostics: diag }, null, 2)));
    openModal({ title: 'Health & diagnostics', body, wide: true });
  } catch (error) { ctx.toastError(error); }
}

function wsPanel(ctx) {
  const body = el('div');
  const node = card({
    iconName: 'activity', title: t('developer.ws'),
    subtitle: 'Live frames from the bridge (state changes, telemetry, plugin hooks).',
    body,
  });
  const view = el('div', { class: 'log-view', role: 'log', 'aria-live': 'polite' });
  const status = el('div', { class: 'row between', style: { marginBottom: '8px' } });
  const socketState = ctx.api.socketState || (ctx.mode() === 'demo' ? 'demo' : 'connecting');
  status.innerHTML = `<span class="pill ${socketState === 'open' ? 'ok' : ''}">${icon('radio')} ${esc(socketState)}</span>
    <span class="pill">${ctx.api.metrics?.reconnectAttempt || 0} reconnects</span>`;
  body.append(status, view);
  const append = (entry) => {
    if (!view.isConnected) return;
    const line = el('div', { class: 'log-line' });
    line.innerHTML = `<span class="dim tiny-text">${new Date().toLocaleTimeString()}</span> <span class="pill ${entry.type?.includes('error') ? 'danger' : 'accent'}">${esc(entry.type || 'event')}</span> <span class="mono-text tiny-text">${esc(JSON.stringify(entry.payload ?? entry).slice(0, 400))}</span>`;
    view.append(line);
    while (view.children.length > 120) view.firstChild.remove();
    view.scrollTop = view.scrollHeight;
  };
  append({ type: 'socket', payload: { state: socketState, baseUrl: ctx.api.baseUrl || 'demo' } });
  const handler = (message) => append(message);
  ctx.api.on('event', handler);
  const timer = setInterval(() => {
    if (!view.isConnected) { ctx.api.off?.('event', handler); clearInterval(timer); }
  }, 4000);
  const actions = el('div', { class: 'row wrap', style: { marginTop: '10px' } });
  actions.append(button('Ping bridge', {
    iconName: 'zap', className: 'btn btn-sm',
    onClick: () => {
      ctx.api.request('/api/health').then((data) => append({ type: 'pong', payload: data })).catch((error) => append({ type: 'error', payload: { message: error.message } }));
    },
  }));
  actions.append(button('Clear log', { iconName: 'trash-2', className: 'btn btn-sm', onClick: () => { view.innerHTML = ''; } }));
  actions.append(button('Resync state', {
    iconName: 'refresh-cw', className: 'btn btn-sm',
    onClick: () => ctx.api.refresh().then(() => append({ type: 'state', payload: { resynced: true } })).catch((error) => ctx.toastError(error)),
  }));
  body.append(actions);
  return node;
}

function pluginsPanel(ctx) {
  const data = ctx.plugins || { plugins: ctx.state.plugins || [], permissions: [], hooks: [] };
  const pluginBody = el('div');
  const node = card({
    iconName: 'puzzle', title: t('developer.plugins'),
    subtitle: 'Plugins are sandboxed Node modules with an explicit permission model.',
    body: pluginBody,
  });
  const body = pluginBody;
  const head = el('div', { class: 'row wrap', style: { marginBottom: '10px' } });
  head.append(button('Rescan directory', {
    iconName: 'refresh-cw', className: 'btn btn-sm',
    onClick: () => act(ctx, () => ctx.api.request('/api/plugins/scan', { method: 'POST', body: {} }), { success: 'Plugins rescanned' }),
  }));
  head.append(el('span', { class: 'pill' }, `${(data.plugins || []).length} installed`));
  body.append(head);

  (data.plugins || []).forEach((plugin) => {
    const row = el('div', { class: 'plugin-row' });
    const info = el('div', { style: { flex: '1', minWidth: '0' } });
    info.innerHTML = `<div class="row"><strong>${esc(plugin.name)}</strong><span class="pill">v${esc(plugin.version)}</span>${plugin.enabled ? '<span class="pill ok">enabled</span>' : '<span class="pill">disabled</span>'}${plugin.error ? `<span class="pill danger">${esc(plugin.error)}</span>` : ''}</div>
      <div class="tiny-text dim">${esc(plugin.description || '')}</div>
      <div class="row wrap" style="margin-top:4px">${(plugin.permissions || []).map((permission) => `<span class="tag mono-text">${esc(permission)}</span>`).join('')}</div>`;
    row.append(info);
    const tools = el('div', { class: 'row' });
    if ((plugin.hooks || []).length) {
      tools.append(button('Invoke', {
        iconName: 'play', className: 'btn btn-sm',
        onClick: () => invokePlugin(ctx, plugin),
      }));
    }
    const toggle = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(Boolean(plugin.enabled)), 'aria-label': `Enable ${plugin.name}` });
    toggle.addEventListener('click', async () => {
      try {
        await ctx.api.request(`/api/plugins/${plugin.id}`, { method: 'PATCH', body: { enabled: !plugin.enabled } });
        await refreshPlugins(ctx);
        toast(`${plugin.name} ${plugin.enabled ? 'disabled' : 'enabled'}`);
      } catch (error) { ctx.toastError(error); }
    });
    tools.append(toggle);
    row.append(tools);
    body.append(row);
  });
  if (!(data.plugins || []).length) body.append(emptyState('puzzle', 'No plugins installed', 'Drop a folder into server/plugins and rescan.'));

  body.append(el('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Permission model'));
  const permissions = el('div', { class: 'row wrap' });
  (data.permissions || ['events:read', 'clipboard:read', 'clipboard:write', 'notifications:action', 'files:read', 'files:write', 'windows:read', 'windows:control', 'shell:none']).forEach((permission) => permissions.append(el('span', { class: 'tag mono-text' }, permission)));
  body.append(permissions);
  body.append(el('div', { class: 'tiny-text dim', style: { marginTop: '6px' } }, '`shell:none` is not grantable. Plugins cannot spawn processes, read the token, or reach the network unless the manifest declares it and you approve it.'));
  body.append(el('div', { class: 'row wrap', style: { marginTop: '10px' } },
    button('Plugin API docs', { iconName: 'book-open', className: 'btn btn-sm', onClick: () => window.open('https://github.com/Shrey113/Android-Dex/blob/main/doc/PLUGIN_API.md', '_blank', 'noopener') }),
    button('Export plugin list', { iconName: 'download', className: 'btn btn-sm', onClick: () => downloadText(JSON.stringify(data, null, 2), 'plugins.json', 'application/json') })));
  return node;
}

async function refreshPlugins(ctx) {
  try {
    ctx.plugins = await ctx.api.request('/api/plugins');
  } catch { /* demo */ }
  await ctx.api.refresh().catch(() => {});
  ctx.rerender();
}

function invokePlugin(ctx, plugin) {
  const hook = (plugin.hooks || [])[0];
  const body = el('div', { class: 'stack' });
  const payload = el('textarea', { class: 'textarea mono-text', rows: '5' });
  payload.value = JSON.stringify({ reason: 'manual invocation from developer view' }, null, 2);
  body.append(el('div', { class: 'tiny-text dim' }, `Hook: ${hook}`), payload);
  const run = el('button', { class: 'btn btn-primary' }, icon('play'), 'Invoke hook');
  const modal = openModal({ title: plugin.name, subtitle: 'Manual hook invocation', body, footer: run });
  run.addEventListener('click', async () => {
    try {
      const result = await ctx.api.request(`/api/plugins/${plugin.id}/hooks/${hook}`, { method: 'POST', body: JSON.parse(payload.value || '{}') });
      openModal({ title: `${hook} result`, body: codeBox(JSON.stringify(result, null, 2)), wide: true });
    } catch (error) { ctx.toastError(error); }
  });
}

function diagnosticsPanel(ctx) {
  const diag = ctx.state.diagnostics || {};
  const wrap = el('div');
  const metrics = card({
    iconName: 'gauge', title: t('developer.diagnostics'),
    subtitle: 'Process-local counters; nothing is uploaded.',
    body: (() => {
      const grid = el('div', { class: 'grid cols-4' });
      [['HTTP requests', diag.metrics?.httpRequests], ['WS clients', diag.metrics?.wsClients], ['Clipboard items', diag.metrics?.clipboardItems], ['Events emitted', diag.metrics?.eventsEmitted], ['Boots', diag.bootCount], ['Dropped frames', diag.droppedFrames], ['Crash bundles', diag.crashReports ? 'on' : 'off'], ['Last crash', diag.lastCrash ? fmtRelative(diag.lastCrash.ts || diag.lastCrash) : 'never']].forEach(([label, value]) => {
        const item = el('div', { class: 'metric-pill' });
        item.innerHTML = `<span class="dim tiny-text">${label}</span><strong>${value ?? '—'}</strong>`;
        grid.append(item);
      });
      return grid;
    })(),
  });
  wrap.append(metrics);

  const logBody = el('div');
  const logCard = card({
    iconName: 'scroll-text', title: 'Log tail',
    subtitle: 'Ring buffer of the last 200 lines; the full log is in the data directory.',
    body: logBody,
  });
  const body = logBody;
  const view = el('div', { class: 'log-view' });
  body.append(view);
  const load = async (level = '') => {
    view.innerHTML = `<div class="dim tiny-text">${t('common.loading')}</div>`;
    try {
      const data = await ctx.api.request('/api/diagnostics/logs', { query: { count: 200, ...(level ? { level } : {}) } });
      view.innerHTML = '';
      (data.entries || []).slice().reverse().forEach((entry) => {
        const line = el('div', { class: 'log-line' });
        line.innerHTML = `<span class="dim tiny-text">${esc(entry.ts)}</span> <span class="pill ${entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warn' : ''}">${esc(entry.level)}</span> <span class="tiny-text">${esc(entry.scope || '')}</span> <span class="mono-text tiny-text">${esc(entry.message || '')}</span>`;
        view.append(line);
      });
      if (!(data.entries || []).length) view.append(el('div', { class: 'dim tiny-text' }, 'No log entries yet.'));
    } catch (error) { view.innerHTML = `<div class="dim tiny-text">${esc(error.message)}</div>`; }
  };
  const filters = el('div', { class: 'row wrap', style: { marginBottom: '8px' } });
  ['', 'info', 'warn', 'error'].forEach((level) => {
    filters.append(button(level || 'all', { className: 'btn btn-sm', onClick: () => load(level) }));
  });
  body.prepend(filters);
  load();

  const crashes = card({
    iconName: 'bug', title: 'Crash reports',
    subtitle: 'Opt-in, local-only bundles that you can inspect and purge.',
    body: el('div', {},
      el('div', { class: 'row wrap' },
        button('Purge bundles', { iconName: 'trash-2', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/diagnostics/crashes', { method: 'DELETE' }), { success: 'Crash bundles purged' }) }),
        button('Toggle opt-in', { iconName: 'toggle-left', className: 'btn btn-sm', onClick: () => act(ctx, () => ctx.api.request('/api/diagnostics/crash-reports', { method: 'POST', body: { enabled: !ctx.state.settings.crashReporting } }), { success: 'Crash reporting preference updated' }) }))),
  });
  wrap.append(el('div', { class: 'grid cols-2' }, logCard, crashes));
  return wrap;
}

function benchPanel(ctx) {
  const wrap = el('div');
  const benchBody = el('div');
  const benchCard = card({
    iconName: 'timer', title: t('developer.benchmark'),
    subtitle: 'Bridge micro-benchmark: JSON, PNG encode, HMAC and event fan-out.',
    body: benchBody,
  });
  const body = benchBody;
  const results = el('div', { id: 'bench-results' });
  body.append(results);
  const run = button(t('developer.benchmark'), {
    iconName: 'play', className: 'btn btn-primary',
    onClick: async () => {
      results.innerHTML = `<div class="dim tiny-text">${t('common.loading')}</div>`;
      try {
        const data = await ctx.api.request('/api/diagnostics/benchmark', { method: 'POST', body: {} });
        results.innerHTML = `<div class="grid cols-3">${Object.entries(data.results || {}).map(([key, value]) => `<div class="metric-pill"><span class="dim tiny-text">${esc(key)}</span><strong>${value}</strong></div>`).join('')}</div>
          <div class="tiny-text dim" style="margin-top:8px">${esc(data.disclaimer || '')}</div>
          <div class="tiny-text dim">${esc(data.environment?.node || '')} · ${esc(data.environment?.platform || '')} · ${esc(data.environment?.cpu || '')}</div>`;
      } catch (error) { results.innerHTML = `<div class="dim tiny-text">${esc(error.message)}</div>`; }
    },
  });
  body.append(el('div', { class: 'row wrap', style: { marginTop: '10px' } }, run, button('Copy results', { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(results.innerText) })));
  wrap.append(benchCard);

  const sbomBody = el('div');
  const sbomCard = card({
    iconName: 'package', title: t('developer.sbom'),
    subtitle: 'CycloneDX inventory of bundled binaries and licences.',
    body: sbomBody,
  });
  sbomBody.innerHTML = `<div class="dim tiny-text">${t('common.loading')}</div>`;
  ctx.api.request('/api/diagnostics/sbom').then((data) => {
    sbomBody.innerHTML = '';
    if (!data.available) {
      sbomBody.innerHTML = `<p class="tiny-text dim">${esc(data.hint || 'SBOM not generated yet.')}</p>`;
      sbomBody.append(button('How to generate', { iconName: 'terminal', className: 'btn btn-sm', onClick: () => { copyText('npm run sbom'); toast('Copied: npm run sbom'); } }));
      return;
    }
    sbomBody.innerHTML = `<div class="row wrap" style="margin-bottom:8px"><span class="pill ok">available</span><span class="pill">${esc(data.generatedAt || '')}</span></div>
      <pre class="code" style="max-height:220px;overflow:auto">${esc(JSON.stringify(data.sbom, null, 2).slice(0, 4000))}</pre>`;
    sbomBody.append(button('Download SBOM', { iconName: 'download', className: 'btn btn-sm', onClick: () => downloadText(JSON.stringify(data.sbom, null, 2), 'sbom.json', 'application/json') }));
  }).catch((error) => { sbomBody.innerHTML = `<div class="dim tiny-text">${esc(error.message)}</div>`; });
  wrap.append(sbomCard);

  const compat = card({
    iconName: 'smartphone', title: t('developer.compat'),
    subtitle: 'Supported device tiers from the compatibility matrix.',
    body: el('div', { id: 'compat-body' }, el('div', { class: 'dim tiny-text' }, t('common.loading'))),
  });
  const compatBody = compat.querySelector('#compat-body');
  ctx.api.request('/api/diagnostics/compatibility').then((data) => {
    compatBody.innerHTML = '';
    (data.tiers || []).forEach((tier) => {
      const block = el('div', { style: { marginBottom: '10px' } });
      block.innerHTML = `<div class="section-title">${esc(tier.tier)}</div>
        <div class="tiny-text">${(tier.devices || []).map((device) => `<span class="tag">${esc(device)}</span>`).join(' ')}</div>
        <div class="dim tiny-text" style="margin-top:4px">${esc(tier.notes || '')}</div>`;
      compatBody.append(block);
    });
    if (!(data.tiers || []).length) compatBody.innerHTML = '<div class="dim tiny-text">Compatibility matrix not installed.</div>';
  }).catch((error) => { compatBody.innerHTML = `<div class="dim tiny-text">${esc(error.message)}</div>`; });
  wrap.append(compat);
  return wrap;
}

function sdkPanel(ctx) {
  const base = ctx.api.baseUrl || 'http://127.0.0.1:8787';
  const grid = el('div', { class: 'grid cols-2' });
  grid.append(card({
    iconName: 'code-2', title: t('developer.sdk'),
    subtitle: 'Embed mirroring, input and notifications in any web or Electron app.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      wrap.append(codeBox(`import { DexClient } from '@android-dex/sdk';

const dex = new DexClient({ url: '${base}', token: process.env.DEX_TOKEN });

dex.on('telemetry', (t) => console.log(t.fps, t.latencyMs));
await dex.launch('com.google.android.apps.messaging');
await dex.snap('win_messages', 'right-half');`));
      wrap.append(el('div', { class: 'row wrap' },
        button('Copy snippet', { iconName: 'copy', className: 'btn btn-sm', onClick: () => copyText(wrap.querySelector('pre').textContent) }),
        button('SDK docs', { iconName: 'book-open', className: 'btn btn-sm', onClick: () => window.open('https://github.com/Shrey113/Android-Dex/blob/main/doc/EMBED_SDK.md', '_blank', 'noopener') })));
      return wrap;
    })(),
  }));
  grid.append(card({
    iconName: 'server', title: 'Headless mode',
    subtitle: 'Run without a console; drive everything from CI or a kiosk.',
    body: codeBox(`DEX_HEADLESS=1 android-dex serve --port 8787 \\
  --token "$DEX_TOKEN" --share-dir /srv/dex

curl -X POST -H "Authorization: Bearer $DEX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"appId":"messages"}' \\
  ${base}/api/windows`),
  }));
  grid.append(card({
    iconName: 'webhook', title: 'Webhooks & events',
    subtitle: 'Forward selected events to an HTTP endpoint on your LAN.',
    body: codeBox(`POST /api/settings
{ "webhookUrl": "http://192.168.1.10:9000/dex",
  "webhookEvents": ["notification.posted", "clipboard.changed",
                    "device.disconnected", "reconnect.scheduled"] }`),
  }));
  grid.append(card({
    iconName: 'book-open', title: 'Protocol & docs',
    subtitle: 'The companion Kotlin protocol is documented and versioned.',
    body: (() => {
      const wrap = el('div', { class: 'stack' });
      [
        ['Architecture', 'doc/ARCHITECTURE.md'],
        ['REST & WebSocket', 'doc/API.md'],
        ['Plugin API', 'doc/PLUGIN_API.md'],
        ['Embed SDK', 'doc/EMBED_SDK.md'],
        ['Companion protocol', 'doc/COMPANION_PROTOCOL.md'],
      ].forEach(([label, path]) => {
        const row = el('a', { class: 'log-line', href: `https://github.com/Shrey113/Android-Dex/blob/main/${path}`, target: '_blank', rel: 'noopener' });
        row.innerHTML = `${icon('file-text')} <span>${label}</span><span class="dim tiny-text" style="margin-left:auto">${path}</span>`;
        wrap.append(row);
      });
      return wrap;
    })(),
  }));
  return grid;
}
