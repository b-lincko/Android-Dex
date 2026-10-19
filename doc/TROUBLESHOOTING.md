# Troubleshooting matrix

Start with `android-dex doctor`. It checks Node, ADB, OpenSSL, port occupancy,
the data directory, console assets and the SBOM without touching the network.

## Connection

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| `adb devices` shows `unauthorized` | RSA prompt not accepted | Unlock the phone, accept **Allow USB debugging**, tick "always". If it never appears: revoke USB authorisations in Developer options, replug. |
| Device missing entirely | Cable is charge-only / port is USB 2 hub | Try another cable and a direct port; `adb kill-server && adb start-server`. |
| Works on USB, not Wi-Fi | Different subnet or AP isolation | Put both on the same SSID/VLAN, disable client isolation, allow mDNS. Wireless debugging needs the pairing port (not 5555) once. |
| Drops every few minutes | OEM battery optimisation | [SUPPORTED_DEVICES.md](SUPPORTED_DEVICES.md) OEM fixes; disable "Pause USB power delivery" on Samsung. |
| `401 unauthorized` in the console | Missing token | Open `http://host:8787/?token=<token>`; the token is printed at startup and by `android-dex doctor`. |
| Console loads but shows demo data | Bridge unreachable from the browser | Check `/api/health`; if the bridge binds `127.0.0.1`, use `--host 0.0.0.0`. Corporate proxies may block private IPs. |
| `EADDRINUSE` on start | Another bridge/adb forward | `lsof -i :8787` or `--port 8788`. |
| Reconnect loop after a network change | Backoff is doing its job | Watch **Settings → Connection → Reconnect state**; force **Reconnect now**. Check `health`. |

## Screen and input

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Black window | Secure surface (banking/DRM) or screen off | Unlock the phone; secure flags cannot be captured by design. |
| Very low FPS | Wi-Fi congestion or high preset | **Settings → Connection → Bandwidth → low/medium**; prefer 5 GHz or USB. |
| Input offset | DPI/orientation changed after mapping | Relaunch the window; per-app DPI is applied at launch. |
| Cursor stuck as touch | Stylus/gamepad passthrough enabled | Disable the mode in **Media & IO**. |
| macOS: window does not focus | App is running in the background | Click the console tab first; Safari requires a user gesture for fullscreen. |

## Clipboard and files

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Clipboard not syncing | Disabled or Android 10+ background clipboard restriction | Enable **Settings → Sync → Clipboard sync**; keep the companion foreground service alive. Some OEMs restrict clipboard reads outside the foreground app. |
| Images never arrive | Image sync off or > 4.5 MB | Enable **Image sync**; compress screenshots. |
| WebDAV mount fails on Windows | Basic auth over HTTP is blocked by WebClient | Use `net use Z: http://host:8787/dav /USER:dex <token>`; for HTTPS use a reverse proxy. Windows may require `BasicAuthLevel=2` in the registry. |
| Upload fails at ~100 MB | Proxy/body limit | Upload through WebDAV or raise the reverse-proxy limit; direct bridge uploads stream to disk. |
| Files show but download 401s | `<a href>` without token | Use the **Download** button (it appends the token), or mount WebDAV. |

## Calls, SMS and notifications

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| No conversations | Companion lacks SMS role | Set the companion as default SMS app or grant READ_SMS/SEND_SMS. |
| RCS falls back to SMS | Carrier/device RCS unavailable | Expected; the UI shows RCS only when the phone advertises it. |
| Inline reply fails | Notification action expired | Open the conversation and reply there; Android drops action tokens after a while. |
| No notifications at all | Notification listener not granted | Grant **Notification access** to the companion. |
| DND does not mirror | Policy access missing | Grant **Do Not Disturb access** (Android 6+). |
| Lock button does nothing | No device lock configured | Set a PIN/pattern/biometric on the phone first. |

## Media and camera

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Audio silent | Output routed to phone | **Media → Audio output → Desktop speakers**; check host volume. |
| Mic passthrough echoes | Desktop speakers + host mic | Use headphones, or lower gain. |
| Virtual camera not listed | App started before camera was enabled | Enable the camera, then restart Zoom/Teams/OBS. The MJPEG URL is `http://host:8787/api/media/webcam/stream`. |
| Recording empty | No frames received | Start recording after the first frame arrives; check the log tail in **Developer → Diagnostics**. |

## Gaming

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Aim assist toggle refuses | Fair-play disclosure not accepted | Accept it in **Gaming**; the API returns `428 fairplay_ack_required`. |
| Share code rejected | Tampered or from another bridge key | Codes are HMAC-signed per bridge; re-export on the source machine. |
| Controls do not reach the game | Anti-cheat blocks injected input | This is a hard boundary — Android DEX does not bypass anti-cheat. Use supported games. |
| Macro runs at wrong positions | Game letterboxes differently | Macros use normalised coordinates; re-record inside the same aspect ratio. |

## Packaging and updates

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| `node: command not found` after `.deb` install | Node not installed | `sudo apt install nodejs` (>= 20.11) or use the Flatpak/Snap which bundle it. |
| Signature verification fails | Manifest/checksum mismatch | Re-download; never bypass. Run `scripts/verify-release.sh` and compare the GPG key with the one in SECURITY.md. |
| Update says "staged" but nothing changes | Package-managed install | Use apt/dnf/snap; the in-app updater is for portable builds. |
| mac app blocked by Gatekeeper | Not notarised build | Right-click → Open once, or use a notarised release. Builds from source are unsigned unless `CODESIGN_IDENTITY` is set. |
| Windows installer needs admin | Installed per-machine previously | Uninstall the old version; the current installer is per-user and needs no admin. |

## Logs and diagnostics

```bash
android-dex diagnostics                 # version, uptime, reconnect, metrics
android-dex api GET /api/diagnostics/logs?count=200
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/diagnostics/logs
```

Full logs: `<dataDir>/logs/bridge.log`. Crash bundles (opt-in):
`<dataDir>/crashes`. Nothing is uploaded automatically.

If you open an issue, include:

```bash
node --version
android-dex doctor --json
android-dex diagnostics --json
android-dex api GET /api/diagnostics/logs?count=80
```
