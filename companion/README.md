# Android DEX Companion — Kotlin reference

This folder contains the **protocol reference** for the phone side of Android
DEX: wire types, QR parsing, reconnect policy and a foreground-service
skeleton. It is intentionally not a finished APK.

> The bridge in this repository is complete and tested. This companion is a
> specification you (or we) can build into a Play/F-Droid app. The protocol in
> [doc/COMPANION_PROTOCOL.md](../doc/COMPANION_PROTOCOL.md) is stable.

## What is here

```
build.gradle.kts                 Android app module (Kotlin 2.0, SDK 35)
src/main/AndroidManifest.xml     permissions, service types, dex:// intent filter
src/main/kotlin/…/DexProtocol.kt Wire types + strict QR parser
src/main/kotlin/…/DexCompanionService.kt  foreground service, WS, backoff, telemetry
```

## Build

```bash
cd companion
./gradlew :assembleFullDebug     # telephony-enabled direct build
./gradlew :assemblePlayDebug     # Play flavour (no SMS/call-log roles)
```

You need the Android SDK and a JDK 17. The module depends on
`kotlinx-serialization-json` and OkHttp only.

**Missing files on purpose:** `PairingActivity`, `BootReceiver`,
`DexNotificationListener`, launcher icons and theme resources. They are part of
the product app, not the protocol; the README lists the behaviour each must
implement so a build does not silently pretend to work.

## Behaviour checklist for a complete companion

```
[ ] PairingActivity: QR scanner + code entry, calls /api/pair/confirm,
    stores host + token + pinned fingerprint in EncryptedSharedPreferences
[ ] DexNotificationListener: forwards notification.received, implements inline
    reply through RemoteInput, honours DND
[ ] Telephony bridge: SMS/MMS send, conversation read, call state; skip entirely
    in the play flavour unless the app holds the default roles
[ ] Clipboard: pushes text/images on change, applies remote clipboard writes
[ ] Files: receives pull requests, writes to Downloads, reports transfer.complete
[ ] Camera/mic: gated runtime permissions, explicit per-session consent
[ ] Foreground service types valid on Android 14+ (connectedDevice|dataSync)
[ ] BootReceiver: restarts the service only if the user enabled auto-start
[ ] Reconnect: exponential backoff, stop on unauthorized/fingerprint_mismatch
[ ] Do not use accessibility for input injection in the Play flavour
```

## Security

- Store the token with `EncryptedSharedPreferences` (or the Keystore); never in
  plain prefs or logs.
- Pin the bridge fingerprint from the QR payload. Refuse a changed value.
- Use `wss://` with a real certificate when the bridge is behind a proxy.
- Request telephony/notification roles only when the user enables the matching
  feature, and explain why first.

## Play Store

Read [doc/PLAY_STORE.md](../doc/PLAY_STORE.md) before publishing. SMS, call-log
and accessibility features are policy-restricted; the `play` product flavour
deliberately excludes them.

## Licence

Same as the bridge: see [LICENSE](../LICENSE). "scrcpy" is a separate project
(Apache-2.0) and is not part of this companion.
