# Supported devices

Matrix maintained in [`server/data/compatibility.json`](../server/data/compatibility.json)
and surfaced in **Developer → Compatibility**. "Supported" means the bridge,
mirroring, input, clipboard and file transfer are exercised; telephony and
notification features additionally depend on the companion's roles.

## Minimum

| | |
| :--- | :--- |
| Android | 9.0 (API 28); 13+ recommended |
| RAM | 2 GB free |
| Transport | USB 2.0 or 5 GHz Wi-Fi |
| Desktop | Windows 10 21H2+/11, macOS 12+ (Intel & Apple Silicon), Linux glibc 2.31+ (Ubuntu 20.04+, Fedora 36+, Debian 11+) |

## Tiers

### A — fully supported

Google Pixel 6–9, Samsung Galaxy S22–S25, Galaxy Tab S8–S10, Nothing Phone
(2/3), OnePlus 11–13. All features including virtual camera, telephony relay and
multi-window are exercised. Android 13+ recommended.

### B — supported with caveats

Xiaomi 13/14 (HyperOS), OPPO Find X6–X8 (ColorOS), vivo X90–X200 (OriginOS),
Huawei P50+ (EMUI/HarmonyOS). Background restrictions must be lifted for the
companion service (see below).

### C — community tested

Android TV / Google TV, ChromeOS ARC++ devices, Fire tablets (Fire OS 8).
Mirroring and input work; telephony and calls are unavailable on tablets/TV.

## OEM fixes

| OEM | Restriction | Fix |
| :--- | :--- | :--- |
| Samsung One UI 6/7 | Battery optimisation and "Put unused apps to sleep" stop the companion | Settings → Battery → Background usage limits → Never sleeping apps → add the companion. Disable "Pause USB power delivery" for sustained mirroring. |
| Xiaomi HyperOS / MIUI 14+ | Autostart blocked; input injection needs USB debugging (Security settings) | Enable Developer options → USB debugging (Security settings), turn on Autostart, battery saver "No restrictions". |
| OnePlus / OPPO ColorOS 14+ | Adaptive battery and sleep standby | Battery → More settings → Sleep standby optimisation off; allow background activity. |
| vivo OriginOS / iQOO | High background power prompt after 3 minutes | i Manager → App Manager → Autostart → allow companion; battery unrestricted. |
| Huawei EMUI 13+/HarmonyOS | No Google Mobile Services | SMS/MMS and mirroring work; RCS and GMS integrations unavailable. |

## Required phone settings

- Developer options → **USB debugging**
- Developer options → **Wireless debugging** (Android 11+) for cable-free use
- Developer options → **Disable permission monitoring** on some OEMs (input injection)
- Notification access, DND access, SMS role (for the corresponding features)
- Battery: unrestricted for the companion

## Known limitations

- DRM/secure surfaces (banking, Netflix) render black by design.
- RCS availability is carrier- and app-dependent; the bridge never spoofs it.
- Devices without a notification listener can still mirror calls but not other apps.
- Android TV has no telephony stack; the Phone view is disabled there.
- Foldables report changing resolutions; pin per-app DPI if the layout jumps.
- Wireless latency is dominated by Wi-Fi; use 5 GHz and the `low`/`medium`
  bandwidth presets on congested networks.

## Reporting a new device

Open an issue with the **Device compatibility** template and include
`android-dex doctor --json` plus the output of
`android-dex api GET /api/devices`. Tier changes are reviewed against a real
device, not vendor spec sheets.
