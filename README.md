> [!WARNING]
> **Official Distribution Only:** This GitHub repository (<https://github.com/Shrey113/Android-Dex>) is the **only official and authorized source** for Android DEX. Creating websites, mirrors, or download portals to distribute, repackage, or monetize Android DEX (via ads, popups, paywalls, or paid links) is **strictly prohibited**. Do not download releases from unauthorized third-party websites.

# Android DEX

<img src="Data/app_png.png" width="128" height="128" alt="Android DEX" align="right" />

_Your phone, reimagined as a desktop._

Android DEX mirrors Android applications into resizable desktop windows and adds
the productivity layer that makes them usable for work: two-way clipboard with
history, drag-and-drop files and a WebDAV drive, SMS/MMS/RCS and calls,
notification mirroring with inline replies, multi-monitor window management,
media routing, and fair-play aware game profiles. It runs entirely on your LAN.

<p>
  <img src="https://img.shields.io/badge/Node.js-20.11%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20.11+" />
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-3ddc84?style=flat-square" alt="Zero runtime dependencies" />
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-0078D4?style=flat-square" alt="Desktop platforms" />
  <img src="https://img.shields.io/badge/license-Proprietary-blue?style=flat-square" alt="Proprietary" />
</p>

**Version 2.0.0** is the console release: a zero-dependency Node bridge, a
fully offline-capable web console, a documented REST/WebSocket API, a JS SDK,
packaging for six targets, and signed, reproducible release artefacts.

---

## Quickstart

```bash
git clone https://github.com/Shrey113/Android-Dex
cd Android-Dex
node server/src/index.js serve --port 8787
```

Open `http://127.0.0.1:8787/`. With no phone connected the console runs the
bundled demo snapshot, so every screen is explorable. Enable **USB debugging**
on the phone and press **Pair** to go live — full steps in
[doc/QUICKSTART.md](doc/QUICKSTART.md).

```bash
android-dex doctor            # Node, ADB, port, data dir, assets, SBOM
android-dex devices           # paired devices + reconnect health
android-dex launch messages   # open a window
android-dex clip set "hello"  # push to the synced clipboard
android-dex sms send --to "+4915123456789" --text "on my way"
```

## Features

### Productivity
- **Clipboard sync** — text **and images**, history, pinning, source labels,
  retention, “copy to desktop / send to phone”.
- **Drag-and-drop file transfer** — drop onto the view or a file table; previews,
  push-to-device, delete, folders.
- **Shared filesystem / mount** — WebDAV at `/dav/` with Windows, macOS and Linux
  recipes; screenshots and recordings land in the same share.
- **Calls, SMS, MMS, RCS** — conversations, typing indicators, attachments,
  delivery status, call log, dialer, DTMF, mute.
- **Contacts** — search, click-to-call, click-to-message.
- **Universal search** — `Ctrl+K` across apps, contacts, messages, files,
  settings, game profiles, plugins and actions.

### Windows
- **Snap layouts** — eight zones with drag hints plus 2-column, 3-column, 2×2,
  main+side and focus presets.
- **Always-on-top pin · PiP · per-app orientation · per-app DPI.**
- **Multi-monitor routing** with scale/primary controls.
- **Android widgets** — clock, battery, weather, notes, media; draggable and
  persistent.
- **App drawer / host launcher** — launch into windows, or generate a real
  `.lnk` / `.app` / `.desktop` entry.

### Input & media
- **Audio routing** — desktop, headphones, phone, HDMI; per-session volume/seek.
- **Microphone passthrough** with gain and input meter.
- **Virtual camera** — MJPEG stream for Zoom/Teams/OBS/browsers.
- **Screenshot & recording hotkeys** with galleries.
- **Gamepad passthrough** with a live visualiser.
- **Stylus pressure/tilt** with a test pad.

### Connection & power
- **Auto-reconnect** with exponential backoff, jitter, preview and state restore.
- **Background service + auto-launch** — systemd, launchd, scheduled task, NSSM,
  Snap daemon.
- **Wake-on-connect**, idle prevention, **battery/charge UI and charge limiter**.
- **Encrypted wireless ADB model** — pinned fingerprints, pairing tokens,
  single-use codes, revocation.
- **LAN-only indicator, bandwidth presets** and a reconnect health score.

### Notifications & system
- **Inline reply + quick actions** straight from a notification.
- **OS notification-center mirroring** and **DND sync** (both ways).
- **Lock/unlock with forwarded biometrics.**
- **Quick-settings tiles**, hotspot and cellular data controls.

### Gaming
- **Per-app hotkey rebinding** with import/export.
- **Community profile catalog** with signed `dexgame:` share codes and opt-in sync.
- **Sensitivity curves, gyro and deadzone** with a live graph.
- **Macro timeline editor** and event recording.
- **Controller-to-touch mapping.**
- **Fair-play disclosure** — assistance is off by default, has no anti-cheat
  bypass, and is enforced server-side (`428 fairplay_ack_required`).

### Platform
- **Linux** `.deb`, `.rpm`, Flatpak and classic Snap definitions.
- **macOS** `.app`/`.dmg` build, entitlements, Developer ID signing and
  notarisation scripts; Apple Silicon and Intel.
- **Windows** per-user Inno Setup installer and service/task helper.
- **Auto-update** plumbing with SHA256 + GPG verification and channels.
- **QR pairing** and a six-locale UI (English, Spanish, Hindi, Arabic/RTL,
  Chinese, French).

### Accessibility
- Screen-reader labels, live regions, focus trapping/restoration, skip link.
- Keyboard-only operation with a searchable shortcut sheet.
- High-contrast and dyslexia-friendly themes, reduced motion, UI scale, density,
  dark/light/system.

### Developer
- **Plugin API** with a permissions model and a working example.
- **CLI** covering every domain, plus `--json` for scripting.
- **REST + WebSocket API**, OpenAPI 3.1, **headless mode**, **JS SDK**, embed
  docs and a Kotlin companion protocol.
- **Local crash bundles** (opt-in), logs, metrics and a micro-benchmark.

### Trust
- **Reproducible release tarball** (`npm run reproducible` verifies it).
- **SHA256SUMS + GPG signature** (Sigstore fallback in CI), **SBOM**, issue
  templates, changelog and a security policy.
- Fingerprint pinning, audit log, rate limiting; no telemetry and no external
  network calls.

## Architecture

```
┌────────────┐    USB / Wi-Fi ADB    ┌───────────────────────┐   HTTP + WS   ┌──────────────────┐
│  Android   │ ◄───────────────────► │  Android DEX bridge   │ ◄───────────► │  Console (SPA)   │
│  device    │  mirror, input, sync  │  Node · zero deps     │  token auth   │  browser / PWA   │
│ + companion│                       │  REST · WS · WebDAV   │               │  offline demo    │
└────────────┘                       └───────────────────────┘               └──────────────────┘
                                              │
                                    ┌─────────┴──────────┐
                                    │  plugins · SDK     │
                                    │  CLI · benchmarks  │
                                    └────────────────────┘
```

The bridge is the only component that touches the device. The console is a
static app served by the bridge; it has no build step and no CDN assets. The
CLI and SDK speak the same public API. See
[doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) for the module map and state model.

## Repository layout

| Path | Contents |
| :--- | :--- |
| `server/src/` | Bridge: HTTP router, WebSocket, WebDAV, state, supervisor, pairing |
| `server/src/features/` | clipboard, files, telephony, notifications, windows, system, media, gaming, plugins, updates, search, diagnostics |
| `server/test/` | 25 `node:test` API/feature/security tests |
| `app/` | Console: shell, router, window manager, 9 views, CSS, icons, service worker |
| `sdk/` | Dependency-free JS client + live integration tests |
| `bench/` | Control-plane benchmark |
| `packaging/` | deb/rpm/Flatpak/Snap/macOS/Windows |
| `scripts/` | release, SBOM, signing, reproducibility, service install, app checks |
| `companion/` | Kotlin protocol reference (wire types + foreground service) |
| `doc/` | User guide, quickstart, API, plugin SDK, protocol, benchmarks, trust |

## Documentation

| Document | Read it for |
| :--- | :--- |
| [Quickstart](doc/QUICKSTART.md) | Phone on the desktop in five minutes |
| [User guide](doc/USER_GUIDE.md) | Every feature, shortcut and setting |
| [Troubleshooting](doc/TROUBLESHOOTING.md) | Symptom → cause → fix matrix |
| [Supported devices](doc/SUPPORTED_DEVICES.md) | Tiers, OEM fixes, limitations |
| [Benchmarks](doc/BENCHMARKS.md) | Measured control-plane latency, scrcpy comparison |
| [API](doc/API.md) | 119 REST paths + WebSocket protocol |
| [Plugin API](doc/PLUGIN_API.md) | Manifest, permissions, hooks, example |
| [Embed SDK](doc/EMBED_SDK.md) | JS client, kiosk, headless, webhooks |
| [Companion protocol](doc/COMPANION_PROTOCOL.md) | Pairing, frames, telemetry, security |
| [Play Store guide](doc/PLAY_STORE.md) | Policy constraints for the companion |
| [Fair play](doc/FAIR_PLAY.md) | What assistance is and is not allowed |
| [Trust](doc/TRUST.md) | Reproducibility, SBOM, signatures, crash reports |

## Development

```bash
npm --prefix server test           # 25 tests, no install step
npm run lint:app                   # imports, syntax, icons, service worker
node --test sdk/test/*.test.js     # SDK against a live bridge on :8790
npm run bench                      # latency table
npm run reproducible               # build twice, compare hashes
npm run build                      # dist/android-dex-2.0.0.tar.gz + SHA256SUMS
```

Requirements: Node **20.11+**. The server has no runtime dependencies; please
keep it that way. Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

The bridge listens on your LAN, requires a bearer token off-loopback, pins device
fingerprints, and never contacts a third party. Clipboard, notifications, files
and telephony metadata move only between the phone and your bridge. Crash bundles
are opt-in and local. See [SECURITY.md](SECURITY.md).

## License

Android DEX is proprietary, closed-source software.

Users may use Android DEX for personal, educational, research, and testing
purposes. Users may create, publish, and share non-commercial videos, tutorials,
reviews, demonstrations, screenshots, and other content featuring Android DEX.
Such content must not be monetized or used to generate advertising revenue,
sponsorship income, affiliate commissions, paid promotions, memberships,
donations, or other commercial income.

> [!CAUTION]
> **Strict Prohibition on Monetized Websites & Mirrors:**
> Creating websites, download portals, landing pages, or mirror services to
> distribute or promote Android DEX for commercial gain (including ad revenue via
> Google AdSense, banners, popups, paywalls, link shorteners, or paid download
> gateways) is **strictly prohibited**. Bundling or wrapping Android DEX with
> third-party installers, download managers, adware, toolbars, or commercial
> software suites is strictly forbidden.

Redistribution, modification, repackaging, commercial use, commercial
distribution, and unauthorized mirroring of Android DEX are prohibited unless
explicitly authorized in writing by the copyright holder.

For commercial licensing inquiries or written monetization permissions, please
contact [@Shrey113](https://github.com/Shrey113).

Third-party open-source components, including scrcpy, Lucide and
qrcode-generator, remain subject to their respective licenses.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [SECURITY.md](SECURITY.md) for
complete details.

---

<div align="center">

### Thanks for using Android DEX! 🎉

**Made by [Shrey113](https://github.com/Shrey113)**

</div>
