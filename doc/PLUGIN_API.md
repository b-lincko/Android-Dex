# Plugin API

Plugins extend the bridge with local JavaScript. They are ES modules discovered
in `server/plugins/` (override with `DEX_PLUGINS_DIR`), disabled by default, and
limited to the permissions declared in their manifest. There is no network
access, no `child_process`, no token access and no filesystem API in the sandbox.

## Layout

```
server/plugins/
  my-plugin/
    manifest.json
    index.js
```

## Manifest

```json
{
  "id": "speaker-notes",
  "name": "Speaker Notes",
  "version": "1.0.0",
  "author": "Android DEX SDK",
  "description": "Pins the newest clipboard text as an overlay when a deck is focused.",
  "permissions": ["events:read", "clipboard:read", "windows:read", "notifications:action"],
  "hooks": ["clipboard.changed", "window.focused"],
  "entry": "index.js"
}
```

| Field | Required | Notes |
| :--- | :--- | :--- |
| `id` | yes | Stable, lowercase, unique. Used by the API and audit log. |
| `name`, `version`, `author`, `description` | recommended | Shown in **Developer → Plugins**. |
| `permissions` | yes | Unknown permissions are dropped and logged. |
| `hooks` | recommended | Declarative list; `api.on()` rejects hooks not in this list **and** not in the global hook table. |
| `entry` | no | Defaults to `index.js`. |

### Permissions

| Permission | Grants |
| :--- | :--- |
| `events:read` | `api.on(hook, fn)` for the hook table below |
| `clipboard:read` | `api.clipboard()` |
| `windows:read` | `api.windows()` |
| `settings:read` | `api.settings()` (always readable; declared for transparency) |
| `settings:write` | `api.patchSettings(patch)` |
| `notifications:action` | `api.notify({ body })` |

Not grantable: process execution, network, raw files, the bridge token, adb.

### Hooks

```
clipboard.changed        notification.received     notification.replied
window.focused           window.launched           calls.incoming
calls.active             dnd.changed               telemetry
device.connected         media.changed
```

## Module contract

```js
export async function activate(api) {
  api.log('activated');
  const off = api.on('clipboard.changed', (item) => {
    if (item.kind === 'text') api.notify({ body: `Copied: ${item.text.slice(0, 80)}` });
  });
  return { dispose: off };       // optional; called on deactivate
}

export function deactivate() {
  // release timers, write nothing to disk
}
```

`activate(api)` receives:

| Member | Description |
| :--- | :--- |
| `api.plugin` | `{ id, manifest }` |
| `api.version` | Bridge API version (`2.0.0`) |
| `api.log(message, meta?)` | Structured log line (`plugin:<id>`) |
| `api.settings()` | Read-only settings snapshot |
| `api.clipboard()` | Clipboard items if `clipboard:read` |
| `api.windows()` | Window list if `windows:read` |
| `api.patchSettings(patch)` | Requires `settings:write`; validated like `PATCH /api/settings` |
| `api.on(hook, handler)` | Requires `events:read`; returns an unsubscribe function |
| `api.notify({ body })` | Requires `notifications:action`; adds a bridge notification |
| `api.fetch` | `undefined` on purpose |

Handlers run synchronously on the event bus. Do not block: offload long work to
`setImmediate` and keep state in module scope. There is no `setInterval`
restriction, but deactivate must clear it.

## Lifecycle

1. The bridge scans `server/plugins/` on boot and on `POST /api/plugins/scan`.
2. Manifests are merged into `state.plugins` with `discovered: true`.
3. Enable with `PATCH /api/plugins/:id { "enabled": true }` (or the Developer
   view). This imports `index.js` with a cache-busting query, validates the
   export, builds the permission-scoped API and calls `activate`.
4. Disable calls the stored disposers, `deactivate?.()`, and emits
   `plugins.deactivated`.
5. A crashing handler is caught by the event bus and logged; it does not take
   the bridge down. Repeated failures leave the plugin enabled but noisy — check
   **Developer → Diagnostics → Log tail**.

## Example: speaker notes

The repository ships a complete example at
[`server/plugins/speaker-notes`](../server/plugins/speaker-notes). It listens
for clipboard changes and window focus, and raises a notification when a slide
deck is focused. It declares exactly four permissions and no network.

```bash
android-dex plugins list
android-dex plugins enable speaker-notes
android-dex api POST /api/plugins/speaker-notes/hooks/clipboard.changed \
  '{"text":"Q3 numbers are up 12%"}'
```

## Distribution & trust

- Plugins are code, not data: enable only plugins you have read.
- The manager shows requested permissions, hooks and the discovered path.
- There is no marketplace and no auto-update for plugins. Ship them with your
  own fork, or point `DEX_PLUGINS_DIR` at a read-only directory.
- `npm run sbom` does not include third-party plugins; if you redistribute a
  build with plugins, generate your own SBOM and license review.

## API stability

`2.x` keeps the members above. New hooks and permissions are additive; removing
or renaming one requires a major version. The `api.version` field lets a plugin
fail closed on an unexpected host.
