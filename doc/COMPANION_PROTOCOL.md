# Companion protocol (v2)

Android DEX is two halves: the **bridge** (this repository) and a **companion**
running on the phone. The bridge never assumes root; the companion is a normal
app that uses public Android APIs. This document is the contract. The Kotlin
reference skeleton lives in [`companion/`](../companion/README.md) and is the
source of truth for types and framing.

> Status: stable, versioned `v2`. The bridge side is implemented and tested.
> The Kotlin folder is a reference skeleton, not a Play-ready binary; building
> and signing the APK is deliberately outside this repository's CI.

## 1. Transport

| Purpose | Transport | Auth |
| :--- | :--- | :--- |
| Control plane, events | WebSocket at `ws://host:8787/ws?token=…` | bearer token |
| Pairing confirmation | `POST /api/pair/confirm` | one-time code + token + fingerprint |
| Large files | `POST /api/files/pull` / `push` and WebDAV | token |
| Virtual camera frames | `POST /api/media/webcam/frame` (JPEG) | token |
| MediaProjection video | out of scope for v2; the production path is scrcpy | — |

Everything is JSON over a single WebSocket except binary uploads. Use TLS
(`wss://`) when the bridge is behind a reverse proxy; pin the bridge certificate
fingerprint at pairing time (see §7).

## 2. Pairing

```
POST /api/pair/start   { "deviceName": "Pixel 8 Pro", "transport": "wifi" }
→ 200 {
    "pairingId": "pair_…", "token": "…", "code": "482913",
    "fingerprint": "SHA256:…", "qrPayload": "dex://pair?…", "adbSteps": [ … ],
    "expiresAt": "2026-10-19T10:21:00.000Z"
  }

POST /api/pair/confirm  (public)
{ "pairingId": "pair_…", "token": "…", "code": "482913",
  "device": "Pixel 8 Pro",
  "fingerprint": "SHA256:2f:…" }
→ 200 { "paired": true, "device": { … }, "fingerprint": "SHA256:…",
        "bridgeFingerprint": "SHA256:…" }
```

Rules:

- The code is six digits and expires after two minutes (configurable).
- The token must match the one issued by `start`; the code is single-use.
- The device fingerprint is stored in `security.pairedFingerprints`.
- A later connection presenting a **different** fingerprint is rejected until
  the operator revokes the old entry (`DELETE /api/pair/:deviceId`).
- Failed attempts increment `security.rejectedAttempts` and are rate-limited.

### QR payload

```
dex://pair?host=192.168.1.10&port=8787&token=…&code=482913
  &fp=SHA256:7f:4c:…&transport=wifi&device=Pixel%208%20Pro&v=2
```

Parse with a strict allowlist; reject unknown `v` and non-`SHA256:` fingerprints.

## 3. WebSocket frames

Server → companion:

```json
{ "type": "hello", "payload": { "version": "2.0.0", "commands": ["…"], "state": { … } } }
{ "type": "events", "payload": { "events": [ { "type": "clipboard.changed", "payload": { … } } ] } }
{ "type": "pong", "payload": { "ts": 1790313148000 } }
{ "type": "result", "id": "cmd_1", "ok": true, "payload": { … } }
{ "type": "result", "id": "cmd_1", "ok": false, "error": { "code": "…", "message": "…" } }
{ "type": "error", "payload": { "code": "bad_json", "message": "…" } }
```

Companion → server:

```json
{ "type": "command", "id": "cmd_1", "action": "sms.send",
  "payload": { "number": "+4915123456789", "text": "on my way" } }
{ "type": "ping" }
```

Command actions the bridge forwards today: `launch`, `media.control`,
`clipboard.add`, `sms.send`, `call.start`, `window.snap`, `settings.patch`,
`search`, `ping`. Companion-specific actions (`telephony.read`,
`notification.action`, `media.project`) are declared by the companion in its
capability list and answered with the same `result` envelope.

## 4. Capabilities

On connect the companion sends `hello` metadata (server echoes its own). The
bridge enables UI affordances from this list:

```json
{ "type": "hello",
  "payload": { "device": { "model": "Pixel 8 Pro", "android": 15, "sdk": 35 },
               "capabilities": ["sms", "mms", "rcs", "calls", "notifications",
                                "clipboard", "files", "camera", "mic", "stylus",
                                "gamepad", "telemetry"],
               "protocol": 2 } }
```

A missing capability disables the corresponding console control instead of
failing at click time.

## 5. Telemetry

Companion pushes a frame at 1 Hz:

```json
{ "type": "telemetry",
  "payload": {
    "battery": { "level": 76.0, "charging": true, "temperature": 31.2 },
    "signal": { "rssi": -48, "transport": "wifi" },
    "quality": { "fps": 60, "bitrateMbps": 16, "latencyMs": 38, "drops": 0 },
    "reconnect": { "state": "connected", "attempt": 0 }
  } }
```

Battery and temperature feed the charge-throttle UI; quality feeds the status
bar. Do not send identifiers or location.

## 6. Domain events

| Event | Payload (minimum) |
| :--- | :--- |
| `notification.received` | `id, app, title, body, ts, actions[]` |
| `notification.replied` | `id, text` |
| `telephony.message` | `conversationId, id, from, text, kind, ts` |
| `calls.incoming` | `id, number, name?, video` |
| `calls.active` | `id, answeredAt` |
| `calls.ended` | `id, duration` |
| `clipboard.changed` | `kind: "text"\|"image", text?, dataUrl?` |
| `files.changed` | `path, size, modified` |
| `system.tile` | `id, enabled` |
| `input.stylus` | `pressure, tiltX, tiltY, active` |
| `input.gamepad` | `id, axes[], buttons` |
| `media.changed` | `sessions[]` |
| `transfer.complete` | `id, name, bytes` |

All events are best-effort. The bridge treats them as hints and patches state;
it never trusts a companion event to be ordered.

## 7. Security model

- **Token:** 24 bytes hex, generated by the bridge or supplied via `DEX_TOKEN`.
  Never log it. Use `Authorization: Bearer` or `?token=`; the WS handshake
  accepts both.
- **Fingerprints:** the companion pins the bridge fingerprint from the pairing
  payload (`fp`) and the bridge pins the device fingerprint. Both sides must
  refuse a silent change.
- **TLS:** when terminating TLS at a proxy, use `wss://` and a certificate the
  companion trusts. Self-signed certificates require explicit pinning; do not
  disable verification.
- **Least privilege:** the companion requests only the roles it uses. Telephony
  and notification access are user-granted system roles and must degrade
  gracefully when absent.
- **No remote shell:** the protocol never exposes an adb shell. Input injection
  happens through the companion's Accessibility/ADB integration that the user
  explicitly enabled.

## 8. Errors

| Code | Meaning | Companion behaviour |
| :--- | :--- | :--- |
| `unauthorized` | Bad/missing token | Stop reconnecting; ask the user to re-pair |
| `token_expired` | Token rotated | Re-pair |
| `fingerprint_mismatch` | Pinned fingerprint changed | Refuse, surface a security warning |
| `pairing_expired` | Code older than 2 min | Start a new pairing |
| `rate_limited` | Too many attempts | Back off exponentially (≥30 s) |
| `unsupported` | Command not in capabilities | Hide the affordance |
| `bad_request` | Malformed payload | Log and drop; never retry blindly |

## 9. Versioning

`v2` is additive. Fields may be added; existing names and semantics do not
change inside a major version. The companion must ignore unknown fields and
unknown event types. A companion that requires a newer bridge reports
`protocol_too_old` and the console shows an update prompt.

## 10. Reference implementation

```
companion/
  README.md
  build.gradle.kts
  src/main/AndroidManifest.xml
  src/main/kotlin/dev/androiddex/companion/DexProtocol.kt
  src/main/kotlin/dev/androiddex/companion/DexCompanionService.kt
```

The Kotlin files compile conceptually against `kotlinx.serialization` and
OkHttp; they exist to make the contract executable, not to ship an APK. See
[PLAY_STORE.md](PLAY_STORE.md) for the policy constraints that apply if you
publish a build.
