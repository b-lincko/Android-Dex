# Console (`app/`)

A no-build, offline-first SPA served by the bridge. Plain ES modules, plain CSS,
no framework, no CDN.

## Boot path

```
index.html
  └─ js/boot.js        sprite → preferences → dynamic import
       └─ js/app.js    createApi() → startShell(api)
            ├─ js/api.js       LiveClient | DemoClient (probe /api/health)
            ├─ js/shell.js     chrome, router, window manager, palette, dialogs
            └─ js/panels.js    view registry → js/views/*.js
```

The demo path is first-class: if `/api/health` is unreachable, the console loads
`data/demo-state.json` (a real `/api/state` snapshot) and every screen still
works. That is also how the UI is developed without a device.

## Conventions

- `el(tag, attrs, ...children)` for DOM, `icon('name')` for sprite references.
  Any interpolated user data goes through `esc()`.
- `ctx` (from `shell.js`) is the only view-facing API: `navigate`, `rerender`,
  `refreshChrome`, `saveSettings`, `openModal`, `confirmDialog`, `promptDialog`,
  `toast`, `toastError`, `copyText`, `openPairing`, `openLock`, `openDeviceMenu`,
  `openShortcuts`, `openPalette`, `downloadUrl`, `mediaLatestUrl`, `mode`,
  `setViewState`.
- Views return a DOM node and must not keep state outside `ctx.viewState` or the
  bridge state.
- The desktop is rendered by `shell.js` (window manager), not by a view file.
- Icons live in `assets/icons.svg`; `npm run lint:app` fails if a used name is
  missing.
- The service worker (`sw.js`) caches the shell but **never** `/api/` or `/dav/`.

## Adding a view

1. Create `js/views/<name>.js` exporting `render<Name>(ctx)`.
2. Register it in `js/panels.js` and add a rail entry in `index.html` if needed.
3. Add i18n keys and test it with the demo snapshot.
4. Run `npm run lint:app`.

## Accessibility rules

- Icon-only buttons need `aria-label`.
- Dialogs must use `openModal` (focus trap + restore + Escape).
- New shortcuts must be registered so the cheat sheet lists them.
- Never encode meaning in colour alone; pair it with text or an icon.
