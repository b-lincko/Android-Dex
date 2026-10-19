# Android DEX — User Guide

Android DEX puts Android apps into resizable desktop windows and adds the layer
that makes them usable for work: a shared clipboard, drag-and-drop files, a
mounted drive, calls and messages, notification mirroring, media routing and
fair-play aware game profiles. Everything runs on your LAN; there is no account
and no cloud.

```
┌────────────┐   USB / Wi-Fi ADB    ┌──────────────────────┐   HTTP + WS   ┌─────────────────┐
│  Android   │ ◄──────────────────► │  Android DEX bridge  │ ◄───────────► │  Console (SPA)  │
│  device    │   mirror, input,     │  Node, zero deps     │   token auth  │  any browser    │
│  + comp.   │   clipboard, SMS…    │  REST · WS · WebDAV  │               │  or PWA         │
└────────────┘                      └──────────────────────┘               └─────────────────┘
```

## 1. Requirements

| Component | Minimum |
| :--- | :--- |
| Android | 9.0 (API 28); Android 13+ recommended for notifications and RCS |
| Bridge host | Node.js **20.11+**, 2 GB free RAM, Linux/macOS/Windows |
| Device transport | USB 2.0 or 5 GHz Wi-Fi; wired Ethernet via USB-C dock is best |
| Browser | Any evergreen browser; Chromium 110+/Safari 16.4+ for PWA install |

Optional external tools: `adb` (device transport), `scrcpy` (mirroring backend),
`ffmpeg` (recording/transcoding). The bridge runs without them in demo mode.

## 2. Install & first run

```bash
git clone https://github.com/Shrey113/Android-Dex
cd Android-Dex
node server/src/index.js serve --host 0.0.0.0 --port 8787
```

The startup output prints the console URL, token, data directory and share
directory. Open the URL; without a reachable bridge the console automatically
falls back to the bundled **demo snapshot** so every screen can be explored
before a phone is connected.

Package installs (`packaging/README.md`):

```bash
sudo apt install ./dist/android-dex_2.0.0_amd64.deb   # Debian/Ubuntu
sudo dnf install ./dist/android-dex-2.0.0-1.noarch.rpm # Fedora
snap install --classic android-dex                     # Snap
flatpak install org.androiddex.Console                 # Flatpak
```

On first launch you can add Android DEX as a PWA (install icon in the address
bar) or use the generated desktop/menu entry.

### Pair a device

1. Enable **Developer options → USB debugging** (and **Wireless debugging** on
   Android 11+).
2. Connect USB, or join the same Wi-Fi and choose **Wireless debugging → Pair
   device with pairing code**.
3. In the console press **Pair** (topbar QR icon) → choose USB or Wi-Fi →
   **Start pairing**.
4. Scan the QR with the companion, or type the 6-digit code on the phone.
5. The bridge pins the device fingerprint. A changed fingerprint is rejected
   until you explicitly revoke the old one in **Settings → Privacy → Paired
   fingerprints**.

The QR payload is:

```
dex://pair?host=192.168.1.10&port=8787&token=…&code=482913&fp=SHA256:…&transport=wifi&device=Pixel%208%20Pro&v=2
```

`android-dex pair --open` does the same from a terminal and opens the console.

## 3. Desktop and windows

| Action | How |
| :--- | :--- |
| Launch an app | **Apps → click a card**, `Ctrl+K` → type an app, or the taskbar app-drawer button |
| Move / resize | Drag the title bar; drag the bottom-right handle |
| Snap | Drag to an edge (hints appear), or **⋯ → Snap** and pick a zone |
| Always on top | **Pin** in the window bar |
| Picture-in-picture | **PiP** in the window bar; the window shrinks and stays above others |
| Orientation | **⋯ → Orientation** (portrait / landscape per app) |
| Per-app DPI | **⋯ → DPI** (120–240); useful for tablet layouts |
| Route to monitor | **⋯ → Monitors**, or drag across monitor surfaces |
| Close | **×** in the window bar |

Tiling presets in the desktop toolbar: **2 columns**, **3 columns**, **2×2**,
**Main + side**, **Focus**. They apply to the active monitor.

Widgets: **Add widget** → clock, battery, weather, notes or media. Drag to move;
double-click a notes widget to edit; × removes it. Widgets persist in state.

Host launcher: **Apps → ↗** generates a `.lnk`/`.app`/`.desktop` entry so the
app can be started from the operating system, not just the console.

## 4. Files and the mounted drive

- Drag files anywhere onto the **Files** dropzone, or use **Upload**.
- Files land in the bridge share (`DEX_SHARE_DIR`, default
  `./share` next to the data directory).
- **Push to phone** copies the file into `/sdcard/Download` through the
  companion.
- Click a file to preview images, video and text; **Download** streams the
  original.

Mount it natively over WebDAV at `http://<host>:8787/dav/`:

```bat
:: Windows
net use Z: http://192.168.1.10:8787/dav /USER:dex <token>
```
```bash
# macOS: Finder → Go → Connect to Server → http://192.168.1.10:8787/dav
# Linux (davfs2)
sudo mount -t davfs http://192.168.1.10:8787/dav /mnt/dex
```

Auth user is `dex`; the password is the bridge token. Screenshots and recordings
are written to `Screenshots/` and `Recordings/` inside the share.

## 5. Clipboard

Text and images sync both ways.

- Items are labelled by source and time; pin the ones you reuse.
- **Copy to desktop** writes into the host clipboard; **Send to phone** writes
  into the Android clipboard.
- Paste an image directly into the input to sync it (4.5 MB limit).
- History retention is configurable (1 hour → 1 week); pinned items never
  expire.
- Images are stored as data URLs in the bridge state; disable **Image sync** if
  you handle sensitive screenshots.

## 6. Phone: messages, calls, contacts

- **Messages** — SMS, MMS and RCS threads with typing indicators, attachments,
  delivery ticks and unread counts. Inline reply works from the notification
  center too.
- **Calls** — dialer, call log, answer/decline, mute, DTMF keypad, speaker
  routing; click-to-call from any contact.
- **Contacts** — search, favourite marker, message/call buttons.
- Everything is mirrored, not simulated: the phone remains the telephony owner.

> Calls and SMS require the companion service with the default-dialer / SMS role
> on Android. RCS availability depends on the carrier and the Google Messages
> version; the UI falls back to SMS automatically.

## 7. Notifications, system and quick settings

- The **Alerts** view lists notifications with **Reply** and app-provided quick
  actions, mark-read, dismiss and clear-all.
- **Mirror to OS notification center** uses the host notification system when
  the console runs as a PWA/native shell.
- **Do Not Disturb** is synced both ways.
- **Quick settings tiles** mirror Wi-Fi, Bluetooth, DND, flashlight, rotation,
  hotspot and cellular data. Tap to toggle.
- **Lock phone** creates a biometric challenge forwarded to the desktop; confirm
  or deny. Failed attempts are counted and audited.
- **Hotspot / Cellular** controls live in the Alerts right rail.

## 8. Media and IO

| Feature | Notes |
| :--- | :--- |
| Audio routing | Desktop speakers, headphones, phone speaker or HDMI. Per-session volume and seek. |
| Mic passthrough | Desktop mic → Android with gain and an input meter. |
| Virtual camera | MJPEG stream at `/api/media/webcam/stream`; copy the URL into OBS/Teams/Zoom. Preview and FPS control in the console. |
| Screenshots | `Ctrl+Shift+1` or the camera button; saved to `Screenshots/`. |
| Recording | `Ctrl+Shift+2`; stop returns name and duration; saved to `Recordings/`. |
| Gamepad | Xbox/DualSense/8BitDo inputs map to touch; live visualiser. |
| Stylus | Pressure and tilt with a test pad; enable in **Settings → Audio & camera**. |

The virtual camera uses the phone camera, not the desktop webcam. Frames are
encoded by the bridge; 720p/30 is the safe default for Wi-Fi.

## 9. Gaming profiles

- Profiles are per app (`delta`, `genshin`, …). Each has controls, sensitivity,
  macros and a controller mapping.
- **Controls** — select a control and press a key; the binding is stored in the
  profile. The pad on the left is a live layout preview.
- **Sensitivity** — X/Y response curves, deadzone, gyro sensitivity and aim
  assist. Curves are visualised.
- **Macros** — record a sequence or add steps by hand; edit the timeline;
  remove steps. Coordinates are normalised, so macros survive window resizes.
- **Controller** — physical inputs mapped to touch regions.
- **Sharing** — generate a signed `dexgame:` code, import by pasting a code or
  dropping a `.json`, publish to the local catalog, install from the catalog.
- **Fair play** — aim assist and macros are off by default. Enabling assistance
  requires accepting the disclosure; the bridge never bypasses anti-cheat or
  emulator detection, and games may still disallow it. See
  [FAIR_PLAY.md](FAIR_PLAY.md).

## 10. Settings

| Section | Highlights |
| :--- | :--- |
| Appearance | Dark/light/system, high contrast, dyslexia font, reduced motion, scale 85–125%, density, language |
| Connection | Auto-reconnect, backoff preview, wake-on-connect, encrypted wireless, LAN-only, bandwidth preset, auto-launch, idle prevention, charge limit |
| Sync | Clipboard text/images, drag-and-drop, WebDAV mount, profile cloud sync |
| Notifications | OS mirroring, inline reply, DND, biometric forwarding |
| Audio & camera | Output route, mic, virtual camera, gamepad, stylus |
| Keyboard | Rebind every global hotkey |
| Privacy | Local crash bundles, paired fingerprints, audit log, purge |
| Updates | Channel, auto-update, check, verify & stage |
| About | Endpoint, versions, device, data directory, licences, demo reset |

## 11. Accessibility

- **Keyboard only:** `Tab` reaches every control; dialogs trap focus and restore
  it; `Esc` closes; a skip link jumps to the workspace.
- **Screen readers:** icon-only buttons carry labels; toasts and connection
  status use live regions; window controls are labelled. Tested with NVDA
  (Firefox/Chromium) and VoiceOver (Safari).
- **Vision:** high-contrast theme, 125% scale, reduced motion, dyslexia-friendly
  typography with wider spacing.
- **Input:** touch targets ≥ 32 px; no drag-only action has a menu equivalent.

## 12. Languages and RTL

English, Spanish, Hindi, Arabic, Chinese and French ship in the console. Switch
under **Settings → Appearance → Language**; Arabic sets `dir="rtl"` on the
document and mirrors the layout. Missing keys fall back to English, so partial
translations never break a screen.

## 13. Privacy and security

- The bridge listens on `0.0.0.0` by default but requires a token for every API
  call when reachable off-loopback.
- Device fingerprints are pinned (trust on first use). A changed fingerprint is
  rejected until revoked.
- No telemetry, no analytics, no external fonts/CDNs. The console works offline.
- Crash bundles are opt-in and stay in the local data directory; purge any time.
- The SBOM and reproducible build hashes let you verify what you run. See
  [TRUST.md](TRUST.md).

## 14. Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+K` / `Cmd+K` | Universal search |
| `Alt+1…9` | Desktop, Apps, Phone, Files, Clipboard, Alerts, Media, Gaming, Developer |
| `Alt+0` | Settings |
| `Ctrl+Shift+1` | Screenshot |
| `Ctrl+Shift+2` | Start/stop recording |
| `Ctrl+Shift+L` | Lock phone |
| `Ctrl+Shift+V` | Pin clipboard item (clipboard view) |
| `Ctrl+/` | Shortcut cheat sheet |
| `?` | Shortcut cheat sheet |
| `Esc` | Close dialog / palette |

Global hotkeys are configured in **Settings → Keyboard** and can be imported or
exported with a profile.

## 15. CLI

```bash
android-dex serve --host 0.0.0.0 --port 8787
android-dex doctor
android-dex devices
android-dex connect --transport wifi
android-dex apps && android-dex launch messages
android-dex windows --layout 2x2
android-dex clip set "reviewed build 2.0.0"
android-dex clip copy clip_3 --target phone
android-dex sms send --to "+4915123456789" --text "on my way"
android-dex call "+4915123456789"
android-dex screenshot
android-dex record start|stop
android-dex profiles export gp_delta --out delta.json
android-dex search "maya"
android-dex mount
android-dex pair --open
android-dex diagnostics
android-dex bench
android-dex open --view settings
```

Every command accepts `--json`, `--url` and `--token`.

## 16. Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the full matrix. First aid:

- `android-dex doctor` checks Node, ADB, OpenSSL, the port and the data dir.
- A blank console usually means the bridge is unreachable: open
  `http://host:8787/api/health`.
- `401` means the token is missing; open the console with `?token=…`.
- A device that disappears after a while is usually OEM battery optimisation —
  see [SUPPORTED_DEVICES.md](SUPPORTED_DEVICES.md).
