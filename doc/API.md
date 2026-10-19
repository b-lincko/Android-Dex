# REST & WebSocket API

The bridge exposes a local REST control plane plus a WebSocket event stream.
Everything the console does is available here; the JS SDK in `sdk/dex-client.js`
wraps the same routes.

- **Base URL:** `http://<host>:8787` (default bind `0.0.0.0`, console on `/`).
- **Auth:** `Authorization: Bearer <token>` or `?token=<token>`. Health and
  `POST /api/pair/confirm` are public. If the bridge has no token configured and
  is bound to loopback, auth is disabled.
- **Errors:** non-2xx responses are `{ "error": { "code", "message", "details?" } }`.
  Common codes: `unauthorized`, `forbidden`, `not_found`, `bad_request`,
  `fairplay_ack_required` (HTTP 428), `rate_limited`.
- **Content types:** JSON unless noted. File uploads take a raw body;
  recordings accept `video/webm`; the virtual camera emits `multipart/x-mixed-replace`.
- **CORS:** same-origin plus explicitly allowed origins (`DEX_ALLOWED_ORIGINS`).

```bash
TOKEN=...            # from the bridge startup output or DEX_TOKEN
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/state
```

## Endpoints

Generated from `http://127.0.0.1:8790/api/openapi.json` — 119 paths.

### capture

| Method | Path | Summary |
| :--- | :--- | :--- |
| `POST` | `/api/capture/record/start` | Start screen recording |
| `POST` | `/api/capture/record/stop` | Stop recording (optionally upload WebM body) |
| `GET` | `/api/capture/records` | Recording gallery |
| `POST` | `/api/capture/screenshot` | Take a screenshot (saved to the share) |
| `GET` | `/api/capture/shots` | Screenshot gallery |

### clipboard

| Method | Path | Summary |
| :--- | :--- | :--- |
| `POST` | `/api/clipboard` | Push text or an image into the shared clipboard |
| `DELETE` | `/api/clipboard/{id}` | Delete a clipboard item |
| `POST` | `/api/clipboard/{id}/copy` | Copy an item to host or device |
| `POST` | `/api/clipboard/clear` | Clear clipboard history |

### devices

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/devices` | List devices |
| `PATCH` | `/api/devices/{id}` | Rename a device or change stream quality |
| `POST` | `/api/devices/{id}/charge` | Charge limit / throttling |
| `POST` | `/api/devices/{id}/keepawake` | Prevent phone sleep |
| `POST` | `/api/devices/{id}/wake` | Wake-on-connect |
| `POST` | `/api/devices/connect` | Connect a device (USB or Wi-Fi) |
| `POST` | `/api/devices/disconnect` | Disconnect the active device |
| `POST` | `/api/devices/drop` | Simulate a transport drop (testing) |
| `POST` | `/api/devices/reconnect` | Force an immediate reconnect |
| `GET` | `/api/devices/reconnect/preview` | Exponential backoff preview |
| `POST` | `/api/devices/select` | Select the active device |

### diagnostics

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/diagnostics` | Diagnostics summary |
| `POST` | `/api/diagnostics/benchmark` | Run the micro-benchmark |
| `GET` | `/api/diagnostics/compatibility` | Supported devices matrix |
| `POST` | `/api/diagnostics/crash-reports` | Opt in/out of local crash bundles |
| `DELETE` | `/api/diagnostics/crashes` | Purge crash bundles |
| `GET` | `/api/diagnostics/logs` | Ring-buffer logs |
| `GET` | `/api/diagnostics/sbom` | SBOM for bundled binaries |

### files

| Method | Path | Summary |
| :--- | :--- | :--- |
| `DELETE` | `/api/files` | Delete a file or folder |
| `GET` | `/api/files/download` | Download a file |
| `POST` | `/api/files/mkdir` | Create a folder |
| `POST` | `/api/files/pull` | Pull a file from the device (companion) |
| `POST` | `/api/files/push` | Push a file to the device |
| `POST` | `/api/files/upload` | Upload a file (raw body) |
| `GET` | `/api/mount` | WebDAV mount details |

### gaming

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/gaming/fairplay` | Fair-play disclosure state |
| `POST` | `/api/gaming/fairplay/ack` | Accept fair-play disclosure |
| `POST` | `/api/gaming/import` | Import profile or share code |
| `GET` | `/api/gaming/marketplace` | Community catalog (self-hosted) |
| `POST` | `/api/gaming/marketplace/{id}/install` | Install a catalog profile |
| `POST` | `/api/gaming/profiles` | Create a profile |
| `DELETE` | `/api/gaming/profiles/{id}` | Delete a profile |
| `POST` | `/api/gaming/profiles/{id}/bind` | Rebind a control key |
| `POST` | `/api/gaming/profiles/{id}/controller` | Controller-to-touch mapping |
| `GET` | `/api/gaming/profiles/{id}/export` | Export profile + share code |
| `POST` | `/api/gaming/profiles/{id}/macros` | Add a macro |
| `DELETE` | `/api/gaming/profiles/{id}/macros/{macroId}` | Delete a macro |
| `POST` | `/api/gaming/profiles/{id}/macros/record` | Convert captured events into a macro |
| `POST` | `/api/gaming/profiles/{id}/publish` | Publish to the local catalog |
| `POST` | `/api/gaming/profiles/{id}/sensitivity` | Sensitivity curves + deadzone |
| `POST` | `/api/gaming/profiles/{id}/sync` | Opt-in profile sync |
| `GET` | `/api/gaming/sync` | Profile sync status |

### input

| Method | Path | Summary |
| :--- | :--- | :--- |
| `POST` | `/api/input/gamepad` | Gamepad state passthrough |
| `POST` | `/api/input/stylus` | Stylus pressure/tilt passthrough |

### media

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/media` | Media sessions, mic and camera state |
| `POST` | `/api/media/control` | Play/pause/seek/volume |
| `POST` | `/api/media/mic` | Mic passthrough |
| `POST` | `/api/media/route` | Audio output routing |
| `POST` | `/api/media/webcam` | Enable virtual camera |
| `POST` | `/api/media/webcam/frame` | Ingest a camera frame (companion) |
| `GET` | `/api/media/webcam/latest` | Latest virtual camera still |
| `GET` | `/api/media/webcam/stream` | MJPEG virtual camera stream |

### meta

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Liveness and capability discovery |
| `GET` | `/api/openapi.json` | This document |
| `GET` | `/api/state` | Full state snapshot |

### notifications

| Method | Path | Summary |
| :--- | :--- | :--- |
| `DELETE` | `/api/notifications` | Clear notifications |
| `DELETE` | `/api/notifications/{id}` | Dismiss a notification |
| `POST` | `/api/notifications/{id}/action` | Inline reply or quick action |
| `POST` | `/api/notifications/{id}/read` | Mark one notification read |
| `POST` | `/api/notifications/dnd` | Toggle DND (synced both ways) |
| `POST` | `/api/notifications/read-all` | Mark all read |
| `POST` | `/api/notifications/test` | Inject a test notification |

### plugins

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/plugins` | List plugins and permission model |
| `PATCH` | `/api/plugins/{id}` | Enable/disable a plugin |
| `POST` | `/api/plugins/{id}/hooks/{event}` | Invoke a plugin hook |
| `POST` | `/api/plugins/scan` | Rescan the plugins directory |

### search

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/search` | Universal search |

### security

| Method | Path | Summary |
| :--- | :--- | :--- |
| `DELETE` | `/api/pair/{deviceId}` | Revoke a paired fingerprint |
| `POST` | `/api/pair/cancel` | Cancel pairing |
| `POST` | `/api/pair/confirm` | Complete pairing (token + 6-digit code) |
| `GET` | `/api/pair/identity` | Bridge identity public key + fingerprint |
| `POST` | `/api/pair/start` | Start QR/token pairing |
| `GET` | `/api/pair/status` | Pairing status |

### settings

| Method | Path | Summary |
| :--- | :--- | :--- |
| `PATCH` | `/api/settings` | Patch settings (validated, broadcast over WebSocket) |

### system

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/system` | Lock/battery/keep-awake state |
| `POST` | `/api/system/biometric` | Complete forwarded biometric prompt |
| `POST` | `/api/system/cellular` | Cellular data controls |
| `POST` | `/api/system/hotspot` | Configure hotspot |
| `POST` | `/api/system/keepawake` | Prevent phone sleep |
| `POST` | `/api/system/lock` | Lock the phone, create biometric challenge |
| `GET` | `/api/system/tiles` | Quick settings tiles |
| `POST` | `/api/system/tiles/{id}/toggle` | Toggle a quick setting |

### telephony

| Method | Path | Summary |
| :--- | :--- | :--- |
| `POST` | `/api/telephony/calls` | Place a call / click-to-call |
| `POST` | `/api/telephony/calls/{id}/answer` | Answer an incoming call |
| `POST` | `/api/telephony/calls/{id}/dtmf` | Send DTMF digits |
| `POST` | `/api/telephony/calls/{id}/hangup` | Hang up / decline |
| `POST` | `/api/telephony/calls/{id}/mute` | Mute/unmute a call |
| `GET` | `/api/telephony/contacts` | Contact list |
| `GET` | `/api/telephony/conversations` | List SMS/MMS/RCS conversations |
| `GET` | `/api/telephony/conversations/{id}` | Read a conversation and clear unread |
| `POST` | `/api/telephony/messages` | Send an SMS/MMS |
| `POST` | `/api/telephony/typing` | Relay typing indicator |

### updates

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/updates` | Update state |
| `POST` | `/api/updates/apply` | Verify and stage an update |
| `PATCH` | `/api/updates/channel` | Switch update channel |
| `GET` | `/api/updates/channels` | Release channels |
| `POST` | `/api/updates/check` | Check for updates |

### windows

| Method | Path | Summary |
| :--- | :--- | :--- |
| `GET` | `/api/apps` | Installed apps |
| `POST` | `/api/apps/{id}/launcher` | Generate a host launcher entry (POST) |
| `PATCH` | `/api/hotkeys` | Rebind a global hotkey |
| `POST` | `/api/hotkeys/trigger` | Trigger a hotkey action |
| `GET` | `/api/monitors` | Monitor list |
| `PATCH` | `/api/monitors/{id}` | Monitor topology/scale/primary |
| `POST` | `/api/widgets` | Add an Android widget |
| `DELETE` | `/api/widgets/{id}` | Remove a widget |
| `POST` | `/api/windows` | Launch an app window |
| `DELETE` | `/api/windows/{id}` | Close a window |
| `POST` | `/api/windows/{id}/focus` | Focus/raise a window |
| `POST` | `/api/windows/{id}/snap` | Snap a window to a zone |
| `POST` | `/api/windows/layout` | Apply a tiling preset |

## WebSocket

```
ws://<host>:8787/ws?token=<token>
```

Server frames:

| Type | Payload | When |
| :--- | :--- | :--- |
| `hello` | `{ version, commands[], state }` | on connect |
| `events` | `{ events: [...] }` | batched domain events |
| `pong` | `{ ts }` | reply to `ping` |
| `result` | `{ id, ok, payload } / { id, ok:false, error:{code,message} }` | command result |
| `error` | `{ code, message }` | malformed frame |

Client frame:

```json
{ "type": "command", "id": "cmd_1", "action": "window.snap",
  "payload": { "id": "win_messages", "zone": "left-half" } }
```

Commands: `launch`, `media.control`, `clipboard.add`, `sms.send`, `call.start`,
`window.snap`, `settings.patch`, `search`, `ping`.

Forwarded events include `telemetry`, `notification.*`, `clipboard.*`,
`telephony.*`, `calls.*`, `windows.*`, `widgets.changed`, `monitors.changed`,
`media.*`, `capture.*`, `reconnect.*`, `system.*`, `device.*`, `pairing.*`,
`gaming.*`, `updates.*`, `plugins.*`, `settings.changed`, `input.*`,
`files.changed`, `transfer.*`, and `diagnostics.*`.

### Telemetry frame

```json
{ "type": "telemetry", "payload": {
  "battery": { "level": 76, "charging": true, "temperature": 31.2 },
  "signal": { "rssi": -48, "transport": "wifi" },
  "quality": { "fps": 60, "bitrateMbps": 16, "latencyMs": 38, "drops": 0 },
  "reconnect": { "state": "connected", "attempt": 0 } } }
```

## Examples

```bash
# launch and snap a window
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"appId":"messages"}' http://127.0.0.1:8787/api/windows
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"zone":"left-half"}' http://127.0.0.1:8787/api/windows/win_messages/snap

# upload a file
curl -X POST -H "Authorization: Bearer $TOKEN" \
  --data-binary @deck.pdf 'http://127.0.0.1:8787/api/files/upload?name=deck.pdf&dir=decks'

# send an SMS
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"+4915123456789","text":"on my way"}' \
  http://127.0.0.1:8787/api/telephony/messages
```

## OpenAPI

`GET /api/openapi.json` returns the machine-readable document (public). The
generated block above is refreshed with `node scripts/generate-api-doc.mjs`.
