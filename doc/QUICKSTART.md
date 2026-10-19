# Quickstart — phone on your desktop in five minutes

## 0. What you need

- Android 9+ phone with USB debugging.
- A computer with **Node.js 20.11+**.
- 300 MB free disk and a USB cable (or 5 GHz Wi-Fi).

## 1. Start the bridge

```bash
git clone https://github.com/Shrey113/Android-Dex
cd Android-Dex
node server/src/index.js serve --port 8787
```

Copy the token from the output:

```
Android DEX Bridge 2.0.0 listening on http://0.0.0.0:8787
Console: http://0.0.0.0:8787/  ·  token 3f9c…
```

Open the console URL. This works before a phone is connected — the console shows
a demo snapshot so you can look around.

## 2. Enable developer mode

1. **Settings → About phone** → tap **Build number** seven times.
2. **Settings → System → Developer options** → enable **USB debugging**.
3. Android 11+: also enable **Wireless debugging**.

## 3. Connect

**USB**

```bash
adb devices          # authorize the RSA prompt on the phone
```

Then in the console: **Pair → USB → Start pairing**. Approve the prompt on the
phone. The topbar turns green and the device pill shows the model.

**Wi-Fi (no cable)**

1. Phone: **Wireless debugging → Pair device with pairing code**.
2. Console: **Pair → Wi-Fi**, enter the IP, port and 6-digit code.
3. Once paired, USB is no longer needed on the same network.

Alternatively use the QR: scan it with the companion, which fills in host, port,
token, code and fingerprint.

## 4. Launch something

- Press `Ctrl+K`, type `messages`, press Enter.
- Drag the window to the left edge to snap it; open Settings beside it.
- Copy text on the phone — it appears in **Clipboard** immediately.
- Drop a PDF onto **Files**, open it, then **Push to phone**.

## 5. Make it permanent (optional)

```bash
# Linux: systemd user service with a generated token
scripts/install-service.sh

# macOS: launchd
cp packaging/macos/org.androiddex.console.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/org.androiddex.console.plist

# Windows (PowerShell, no admin)
powershell -ExecutionPolicy Bypass -File packaging\windows\install-service.ps1
```

Open the console as a PWA (install icon) for a window-less, offline-capable
shell. Everything else — pairing, clipboard, files, calls, notifications,
gaming — is reachable from the rail or `Ctrl+K`.

## Next

- [User guide](USER_GUIDE.md) — every feature.
- [Troubleshooting](TROUBLESHOOTING.md) — when the phone does not appear.
- [API](API.md) — automate it.
- [Benchmarks](BENCHMARKS.md) — what to expect from your link.
