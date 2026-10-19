#!/usr/bin/env node
/**
 * Render doc/API.md from the live OpenAPI document.
 *   node scripts/generate-api-doc.mjs --url http://127.0.0.1:8787 --token "$DEX_TOKEN"
 * The reference section is generated; the prose around it is preserved.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const base = (arg('url', process.env.DEX_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
const token = arg('token', process.env.DEX_TOKEN || '');

const spec = await fetch(`${base}/api/openapi.json`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); });

const byTag = new Map();
for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const tags = operation.tags?.length ? operation.tags : ['other'];
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ route, method, operation });
    }
  }
}

const header = `# REST & WebSocket API

The bridge exposes a local REST control plane plus a WebSocket event stream.
Everything the console does is available here; the JS SDK in \`sdk/dex-client.js\`
wraps the same routes.

- **Base URL:** \`http://<host>:8787\` (default bind \`0.0.0.0\`, console on \`/\`).
- **Auth:** \`Authorization: Bearer <token>\` or \`?token=<token>\`. Health and
  \`POST /api/pair/confirm\` are public. If the bridge has no token configured and
  is bound to loopback, auth is disabled.
- **Errors:** non-2xx responses are \`{ "error": { "code", "message", "details?" } }\`.
  Common codes: \`unauthorized\`, \`forbidden\`, \`not_found\`, \`bad_request\`,
  \`fairplay_ack_required\` (HTTP 428), \`rate_limited\`.
- **Content types:** JSON unless noted. File uploads take a raw body;
  recordings accept \`video/webm\`; the virtual camera emits \`multipart/x-mixed-replace\`.
- **CORS:** same-origin plus explicitly allowed origins (\`DEX_ALLOWED_ORIGINS\`).

\`\`\`bash
TOKEN=...            # from the bridge startup output or DEX_TOKEN
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/state
\`\`\`

## Endpoints

Generated from \`${base}/api/openapi.json\` — ${Object.keys(spec.paths).length} paths.

`;

const sections = [];
for (const [tag, operations] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rows = operations
    .sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))
    .map(({ route, method, operation }) => `| \`${method.toUpperCase()}\` | \`${route}\` | ${(operation.summary || '').replace(/\|/g, '\\|')} |`)
    .join('\n');
  sections.push(`### ${tag}\n\n| Method | Path | Summary |\n| :--- | :--- | :--- |\n${rows}\n`);
}

const websocket = `## WebSocket

\`\`\`
ws://<host>:8787/ws?token=<token>
\`\`\`

Server frames:

| Type | Payload | When |
| :--- | :--- | :--- |
| \`hello\` | \`{ version, commands[], state }\` | on connect |
| \`events\` | \`{ events: [...] }\` | batched domain events |
| \`pong\` | \`{ ts }\` | reply to \`ping\` |
| \`result\` | \`{ id, ok, payload } / { id, ok:false, error:{code,message} }\` | command result |
| \`error\` | \`{ code, message }\` | malformed frame |

Client frame:

\`\`\`json
{ "type": "command", "id": "cmd_1", "action": "window.snap",
  "payload": { "id": "win_messages", "zone": "left-half" } }
\`\`\`

Commands: \`launch\`, \`media.control\`, \`clipboard.add\`, \`sms.send\`, \`call.start\`,
\`window.snap\`, \`settings.patch\`, \`search\`, \`ping\`.

Forwarded events include \`telemetry\`, \`notification.*\`, \`clipboard.*\`,
\`telephony.*\`, \`calls.*\`, \`windows.*\`, \`widgets.changed\`, \`monitors.changed\`,
\`media.*\`, \`capture.*\`, \`reconnect.*\`, \`system.*\`, \`device.*\`, \`pairing.*\`,
\`gaming.*\`, \`updates.*\`, \`plugins.*\`, \`settings.changed\`, \`input.*\`,
\`files.changed\`, \`transfer.*\`, and \`diagnostics.*\`.

### Telemetry frame

\`\`\`json
{ "type": "telemetry", "payload": {
  "battery": { "level": 76, "charging": true, "temperature": 31.2 },
  "signal": { "rssi": -48, "transport": "wifi" },
  "quality": { "fps": 60, "bitrateMbps": 16, "latencyMs": 38, "drops": 0 },
  "reconnect": { "state": "connected", "attempt": 0 } } }
\`\`\`

## Examples

\`\`\`bash
# launch and snap a window
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"appId":"messages"}' http://127.0.0.1:8787/api/windows
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"zone":"left-half"}' http://127.0.0.1:8787/api/windows/win_messages/snap

# upload a file
curl -X POST -H "Authorization: Bearer $TOKEN" \\
  --data-binary @deck.pdf 'http://127.0.0.1:8787/api/files/upload?name=deck.pdf&dir=decks'

# send an SMS
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"number":"+4915123456789","text":"on my way"}' \\
  http://127.0.0.1:8787/api/telephony/messages
\`\`\`

## OpenAPI

\`GET /api/openapi.json\` returns the machine-readable document (public). The
generated block above is refreshed with \`node scripts/generate-api-doc.mjs\`.
`;

const out = `${header}${sections.join('\n')}\n${websocket}`;
writeFileSync(path.join(root, 'doc/API.md'), out);
console.log(`✓ doc/API.md (${Object.keys(spec.paths).length} paths, ${sections.length} tags)`);
