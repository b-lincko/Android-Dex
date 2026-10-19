# Publishing the companion on Google Play

The bridge and console are desktop software; only the **companion** is an
Android app. This page lists what Google Play requires and which features cannot
ship in a Play build without an approved exception.

## Policy-sensitive features

| Feature | Google Play requirement | Fallback for a Play build |
| :--- | :--- | :--- |
| SMS/MMS send & read | Only default SMS handlers, or an approved exception (Play SMS/Call Log policy) | Hide messaging; show a deep link to the user's messaging app |
| Call log / phone numbers | Default dialer or approved exception | Hide call log; click-to-dial through `ACTION_DIAL` |
| Answer/decline calls | `ANSWER_PHONE_CALLS` + default dialer role, or accessibility exception | Notification with answer intent only on permitted devices |
| Notification access | User-granted `NotificationListenerService`, declared and explained | Feature disabled until granted |
| Accessibility service | Only for users with disabilities unless an approved exception | Do **not** use accessibility for input injection in a Play build |
| MediaProjection | Foreground service type `mediaProjection` + per-session consent | Optional screen capture; mirroring itself is scrcpy-based |
| Camera / microphone | Runtime permissions with in-context rationale | Feature toggles default off |
| Overlay (`SYSTEM_ALERT_WINDOW`) | Declared purpose, user grant | Not needed for the reference companion |

**Recommendation:** publish two flavours from the same source:

- `play` — no SMS/telephony roles, no accessibility services; mirroring, clipboard,
  files, notifications (user-granted), camera/mic, gaming.
- `full` — direct APK/F-Droid build with telephony and ADB-assisted input.

Document the difference in the store listing. Never ship a Play build that
silently enables restricted permissions.

## Foreground service types

Declare only what you use:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

```xml
<service
    android:name=".DexCompanionService"
    android:exported="false"
    android:foregroundServiceType="connectedDevice|dataSync" />
```

`mediaProjection` must be added only when a projection session is active, and
the notification must be visible and dismissible per Android 14 rules.

## Data safety form

Answer truthfully for the reference design:

- **Collected:** none transmitted to the developer. Clipboard, notifications,
  files and telephony metadata move only between the phone and the user's bridge
  on the LAN.
- **Shared:** no.
- **Encrypted in transit:** optional (LAN HTTP by default; TLS with a reverse
  proxy). State this plainly.
- **Deletion:** everything is local; uninstalling and clearing app data removes it.
- **Crash reports:** off by default. If you enable them, disclose collection and
  retention.

## Listing checklist

```
[ ] Privacy policy URL (local-only processing, no account)
[ ] Prominent disclosure for notification access and camera/mic
[ ] Foreground service justification video for review
[ ] Target SDK = current Play requirement (35+ at time of writing)
[ ] 64-bit ABIs, no native debug binaries
[ ] Data safety form matches the built flavour
[ ] Screenshots show the companion, not the desktop console
[ ] "Requires the Android DEX bridge on your computer" in the description
[ ] No "scrcpy" trademark in the app name; credit it in the description
```

## Versioning

The companion declares `protocol: 2` in `hello`. Bump the major only for
breaking frames. Keep a compatibility table in the listing changelog:

| Companion | Bridge | Notes |
| :--- | :--- | :--- |
| 2.0.x | 2.0.x | current |
| 1.x | 1.x | legacy pairing payload, unsupported |

## Testing tracks

Use **internal testing** with the bridge on a laptop and a physical device;
Play's pre-launch report cannot exercise a LAN bridge. Provide reviewers with:

- a test account-free path (the app opens to a pairing screen),
- a QR payload example,
- a note that no server login exists.

Rejections usually cite "broken functionality" when reviewers cannot reach the
bridge. Add a "Reviewer mode" that renders the demo snapshot locally, exactly
like the console's `?demo=1`.
