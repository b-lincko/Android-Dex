# Changelog

All notable changes to Android DEX are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Companion APK reference build in CI (the protocol is stable; the demo bridge is the reference today).
- Hardware-accelerated video decode through WebCodecs when the browser exposes it.

## [2.0.0] — 2026-10-19

The console release. Android DEX is now a complete, runnable product: a
zero-dependency Node bridge, an offline-capable web console, a documented REST
and WebSocket API, a JS SDK, packaging for six platforms, and the trust
artefacts (SBOM, signed checksums, reproducible tarball) needed to ship it.

### Added — productivity
- Two-way clipboard sync for text **and images**, with pinning, search, source
  labels, retention settings and a "copy to host / send to phone" action.
- Drag-and-drop uploads into the shared folder, a file table with previews,
  push-to-device, copy-path, delete, and folder creation.
- WebDAV mount at `/dav/` with Windows (`net use`), macOS Finder and Linux
  `davfs` recipes surfaced in the UI.
- SMS, MMS and RCS conversations with typing indicators, attachments, delivery
  status, call log and a full dialer.
- Contacts with click-to-call and click-to-message.
- Universal search (Ctrl+K) across apps, contacts, messages, files, settings,
  game profiles, plugins and actions.

### Added — windows & widgets
- Tiling presets (2 columns, 3 columns, 2×2, main+side, focus) and eight snap
  zones with drag-time hints.
- Always-on-top pin, picture-in-picture, per-window orientation and per-app DPI.
- Multi-monitor topology with routing, scaling and primary display selection.
- Android widgets on the desktop: clock, battery, weather, notes and media,
  draggable and configurable.
- Host-launcher generation for Windows, macOS and Linux, plus an app drawer that
  launches into the desktop.

### Added — input & media
- Audio output routing (desktop, headphones, phone, HDMI) and volume control.
- Desktop microphone passthrough with gain and input meter.
- Virtual camera exposed as an MJPEG stream with a copyable OBS/Teams/Zoom URL.
- Screenshot and screen-recording hotkeys with a gallery.
- Gamepad passthrough with a live visualiser.
- Stylus pressure/tilt forwarding with an in-browser test pad.

### Added — connection & power
- Automatic reconnect with exponential backoff, jitter, attempt history and
  preview, plus state restoration after a drop.
- Background service definitions for systemd, launchd, scheduled task and NSSM,
  including auto-launch.
- Wake-on-connect, idle prevention, battery/charging UI and a charge limiter.
- Encrypted wireless ADB model: pinned device fingerprints, pairing tokens,
  6-digit confirmation codes and revocable trust.
- Offline/LAN-only indicator, bandwidth presets (low/medium/high) and a visible
  reconnect health score.

### Added — notifications & system
- Notification center with inline replies, quick actions, mark-read, dismiss and
  clear-all.
- OS notification-center mirroring and DND sync (both directions).
- Lock/unlock with forwarded biometric challenges.
- Quick-settings tiles, hotspot control and cellular data toggles.

### Added — gaming
- Per-app game profiles with a draggable control pad and key rebinding.
- Sensitivity curves (X/Y), deadzone and gyro sensitivity with a live graph.
- Macro timeline editor and event-to-step recording.
- Controller-to-touch mapping.
- Signed `dexgame:` share codes with tamper detection, import/export, local
  catalog publishing and opt-in sync.
- Fair-play disclosure: aim assist and macros are off by default; assistance
  requires an explicit acknowledgement and never bypasses anti-cheat.

### Added — platform
- Debian, RPM, Flatpak and classic Snap packaging; macOS `.app`/`.dmg` build and
  notarisation scripts; Windows Inno Setup installer and service helper.
- Auto-update plumbing with SHA256 + GPG verification and channel selection.
- QR pairing with a signed payload, demo scan simulation and live status polling.
- Six-locale UI (English, Spanish, Hindi, Arabic with RTL, Chinese, French) and
  an immediate language switcher.

### Added — accessibility
- Keyboard-only operation with a visible skip link, focus rings, roving focus in
  dialogs and documented shortcuts.
- Screen-reader labels on icon-only controls, live regions for toasts and
  status, and NVDA/VoiceOver-tested markup.
- High-contrast and dyslexia-friendly themes, reduced motion, UI scale, density,
  and dark/light/system toggles.

### Added — developer & trust
- Plugin API with a permission model, hooks, enable/disable and hot rescan,
  demonstrated by the bundled `speaker-notes` plugin.
- Public CLI covering devices, apps, windows, clipboard, telephony, capture,
  gaming profiles, plugins, diagnostics and benchmarks.
- Documented REST + WebSocket API, OpenAPI 3.1 endpoint, headless mode, JS SDK,
  embed docs and a Kotlin companion protocol reference.
- Local-only crash bundles (opt-in), ring-buffer logs, metrics, SBOM generation,
  reproducible tarball, SHA256SUMS, GPG signing and a verification script.
- Issue templates, security policy, contribution guide and a full user guide,
  quickstart, troubleshooting matrix, supported-device list and benchmark
  methodology.

### Added — documentation
- `doc/BENCHMARKS.md` with measured control-plane latency (p50/p95 over 120
  rounds) and video-path expectations, plus a scrcpy comparison.
- `doc/PLUGIN_API.md`, `doc/EMBED_SDK.md`, `sdk/README.md` and
  `doc/COMPANION_PROTOCOL.md` (v2 wire format, pairing, capabilities, errors).
- `doc/PLAY_STORE.md` (policy matrix and data-safety guidance),
  `doc/FAIR_PLAY.md` (what assistance is and is not allowed) and
  `doc/TRUST.md` (reproducibility, SBOM, signatures, crash reports).
- `companion/` Kotlin reference with the protocol types and a foreground
  service.
- `app/README.md` documenting the console boot path and view conventions.

### Changed
- The console is served by the bridge itself and works offline from the demo
  snapshot; no CDN, fonts or analytics are loaded.
- All API traffic requires a bearer token when the bridge is not on loopback.

### Fixed
- First-run splash could stay visible when the demo backend resolved before the
  boot listener was attached.
- Panels crashed when their card wrapper was queried as a descendant.
- Missing icons in the offline sprite fell back to blank boxes.
- Several console classes (`step-n`, the gamepad visualiser, theme swatch
  selection and the virtual-camera overlay) had no CSS rule and rendered
  unstyled; `npm run lint:app` now fails on any static class without a rule.
- The Settings trust card called the SBOM “CycloneDX”; it is SPDX 2.3.
- The landing page broke its navigation when the Lucide CDN was unavailable;
  icon initialisation is now optional and all copy/links point at v2.

## [1.0.0] — 2026-08-01

- Initial public preview: docs, landing page and the architecture of the
  original Windows-first mirroring design.

[Unreleased]: https://github.com/Shrey113/Android-Dex/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Shrey113/Android-Dex/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Shrey113/Android-Dex/releases/tag/v1.0.0
