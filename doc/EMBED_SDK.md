# Embed SDK and headless mode

The console is a client of the REST/WebSocket API. You can build your own shell,
kiosk, CI job or Electron/Tauri app on the same API. The dependency-free client
is [`sdk/dex-client.js`](../sdk/dex-client.js).

## Install / import

The SDK is a single ES module. Copy it into your project, or use the local path
in this repository:

```js
import { DexClient } from './sdk/dex-client.js';
```

Published package metadata is in `sdk/package.json` (`@android-dex/sdk`, Node 18+,
browser-compatible). There are no transitive dependencies.

## Connect

```js
const dex = new DexClient({
  url: 'http://192.168.1.10:8787',
  token: process.env.DEX_TOKEN,
});

await dex.connect();                 // GET /api/state + opens the WebSocket
console.log(dex.state.devices);      // snapshot
```

Options:

| Option | Default | Notes |
| :--- | :--- | :--- |
| `url` | `http://127.0.0.1:8787` | No trailing slash required. |
| `token` | `''` | Sent as `Authorization: Bearer` and as `?token=` on the WS URL. |
| `fetchImpl` | global `fetch` | Useful for Node < 18 or instrumented fetch. |
| `WebSocketImpl` | global `WebSocket` | In Node 22 it is global; older Node can pass `ws`. |
| `reconnect` | `true` | Exponential backoff, 600 ms × 1.8, capped at 30 s. |

## Events

```js
dex.on('state', (state) => render(state));
dex.on('telemetry', (t) => console.log(t.quality.fps, t.quality.latencyMs));
dex.on('notification.received', (n) => toast(n.title, n.body));
dex.on('socket', ({ state }) => console.log('ws', state));
dex.on('reconnect', ({ attempt, delayMs }) => console.log(attempt, delayMs));
dex.on('*', ({ event, payload }) => log(event, payload));   // all events
```

The socket reconnects automatically; `dex.close()` stops it. Server frames are
documented in [API.md](API.md#websocket).

## Commands and helpers

```js
await dex.launch('messages');            // opens/focuses a window
await dex.snap(win.id, 'right-half');
await dex.layout('2x2');

await dex.clipboard({ kind: 'text', text: 'from my app', source: 'desktop' });
await dex.sendSms('+4915123456789', 'on my way');
await dex.reply(notificationId, 'thanks!');
await dex.dnd(true);

await dex.upload('deck.pdf', pdfBytes, { dir: 'decks' });
await dex.screenshot();
await dex.startRecording(); /* … */ await dex.stopRecording();

await dex.command('ping');               // WS command with id + timeout
```

Full helper list: `launch`, `snap`, `closeWindow`, `layout`, `clipboard`,
`clipboardHistory`, `copyItem`, `conversations`, `sendSms`, `call`, `hangup`,
`notifications`, `reply`, `dnd`, `files`, `upload`, `downloadUrl`, `screenshot`,
`startRecording`, `stopRecording`, `search`, `settings`, `devices`, `pairStart`,
`pairStatus`, `profiles`, `plugins`, `diagnostics`, `health`.

## Errors

```js
import { DexError } from './sdk/dex-client.js';

try {
  await dex.settings({ theme: 'neon' });
} catch (error) {
  if (error instanceof DexError) {
    console.error(error.status, error.code, error.message, error.path);
  }
}
```

`fairplay_ack_required` arrives as status `428`; accept the disclosure in the
console (or `POST /api/gaming/fairplay/ack`) before retrying.

## Headless bridge

```bash
DEX_TOKEN=$(openssl rand -hex 24) \
DEX_DATA_DIR=/srv/dex/data \
DEX_SHARE_DIR=/srv/dex/share \
node server/src/index.js serve --host 127.0.0.1 --port 8787
```

- `--no-app` disables static console serving.
- The bridge logs to `<dataDir>/logs/bridge.log` and stdout.
- Use a reverse proxy for TLS; the bridge speaks HTTP/WS locally. Keep it on
  loopback when a proxy terminates TLS.
- `DEX_ALLOWED_ORIGINS` adds browser origins for embedded clients.

## Kiosk example (Node)

```js
import { DexClient } from './sdk/dex-client.js';

const dex = new DexClient({ url: process.env.DEX_URL, token: process.env.DEX_TOKEN });
await dex.connect();

dex.on('calls.incoming', async (call) => {
  console.log(`Incoming call from ${call.name || call.number}`);
  // light a lamp, show an overlay, page the on-call engineer…
});

setInterval(() => {
  const battery = dex.state.devices[0]?.battery?.level ?? 0;
  if (battery < 20) console.warn('low battery', battery);
}, 60_000);
```

## Webhooks

Instead of polling, forward selected events to an HTTP endpoint on your LAN:

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"webhookUrl":"http://192.168.1.10:9000/dex"}' \
  http://127.0.0.1:8787/api/settings
```

Deliveries are best-effort with a short timeout; they are not retried
indefinitely. Do not point a webhook at a public endpoint — the bridge is
LAN-scoped by design.

## Browser embedding

```html
<iframe src="http://bridge:8787/?token=…&view=phone" title="Android DEX"></iframe>
```

`?view=` opens a specific panel (`apps`, `phone`, `files`, `clipboard`,
`notifications`, `media`, `gaming`, `developer`, `settings`). `?demo=1` forces
the offline snapshot. The console sets `X-Frame-Options`-compatible defaults for
same-origin use; if you embed cross-origin, serve the console behind your own
proxy and allow it explicitly.

## Tests

`sdk/test/client.test.js` runs against a live bridge:

```bash
DEX_TEST_URL=http://127.0.0.1:8790 DEX_TEST_TOKEN=smoke node --test sdk/test/*.test.js
```

CI starts a bridge for this suite; locally use `npm start` in another terminal.
