# Fair-play policy

Android DEX can translate keyboard, mouse, controller and macro input into
Android touches. That is useful for accessibility and single-player convenience,
and it can be abused in competitive games. This policy draws a hard line.

## What Android DEX does

- Maps physical input to touch coordinates, with per-app profiles.
- Offers optional sensitivity curves, deadzone and gyro tuning.
- Records and replays **macros** the user creates.
- Can expose an optional aim-assist helper that adjusts touch deltas.

## What it never does

- Bypass anti-cheat, root detection, emulator detection or integrity checks.
- Inject touches into another process without the user's explicit ADB/companion
  consent.
- Hide its presence from a game, or spoof a physical device.
- Ship pre-made cheats, wallhacks, ESP, recoil scripts or “undetectable” modes.
- Automate matchmaking, farming or account creation.

## Defaults and enforcement

| Control | Default | Enforcement |
| :--- | :--- | :--- |
| Aim assist | **off** | Disabled unless `settings.aimAssistDisclosureAck` is true |
| Macros | available, empty | No preloaded macros; user records their own |
| Sensitivity curves / deadzone | neutral | Always allowed; no hidden snap-to-target |
| Profile sharing | explicit | Signed codes; importing does not enable assistance silently |
| Cloud sync | off | Opt-in; self-hosted directory, no third-party account |

The bridge enforces the disclosure server-side: `POST
/api/gaming/profiles/:id/sensitivity` with `aimAssist: true` returns **HTTP 428**
`fairplay_ack_required` until the acknowledgement is recorded. The toggle in the
console is a convenience, not the security boundary.

## Sharing rules

- A shared profile must be honest about `aimAssist: true`. The signed payload
  includes the flag; importers see it before installing.
- Do not publish profiles that require anti-cheat bypasses or modified clients.
- The local catalog has no moderation by design; if you expose it beyond your
  LAN, you own the moderation.

## Game-specific rules win

Many competitive titles prohibit *any* input remapping or macro use. This policy
is a floor, not a permission slip: follow the game's terms and the tournament
rules. A profile that is allowed here can still get you banned there.

Android DEX does not appeal bans. If a game or tournament asks whether external
input was used, answer honestly.

## Reporting abuse

Open a **Fair-play** issue with the share code or profile id. Profiles that
misrepresent assistance or bundle cheats will be removed from any catalog we
host, and the code format may be revoked in a future protocol version.

## For developers

- New input features must default to off when they change aim or automate
  actions.
- Any automation feature needs a visible disclosure and a server-side gate, not
  just a UI toggle.
- Do not add obfuscation, process hiding, or “stream-proof” overlays. Those are
  out of scope for this project.
