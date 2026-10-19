# Benchmarks and latency budget

Two different things get called "latency" in a mirroring product:

1. **Control-plane latency** — how long an API call or WebSocket command takes.
   This is what Android DEX adds on top of the video path, and it is measured
   below.
2. **Mirror latency** — glass-to-glass delay between the phone screen and the
   desktop window. It is dominated by capture, encode, network and decode, not
   by the bridge.

## Reproduce

```bash
node server/src/index.js serve --port 8787 --token bench
node bench/bench.js --url http://127.0.0.1:8787 --token bench --rounds 120
```

`bench/bench.js` warms up each route, then reports min/p50/p95/p99/max. Use
`--json` for machine-readable output. Run it on the machine that hosts the
bridge; do not benchmark through a VPN.

## Measured — control plane

Environment: Intel Xeon @ 2.60 GHz (2 vCPU), Linux x64, Node **22.22.3**,
loopback interface, demo bridge with 18 apps, 1 device, 3 windows. 2026-10-19.
These numbers are **not** a LAN or Wi-Fi measurement and should not be
extrapolated to one.

| Operation | n | min | p50 | p95 | p99 | max |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /api/health` (no auth) | 120 | 0.31 ms | 0.60 ms | 1.10 ms | 1.56 ms | 2.46 ms |
| `GET /api/state` (full snapshot) | 120 | 0.70 ms | 0.85 ms | 1.21 ms | 2.56 ms | 6.43 ms |
| `GET /api/search?q=ma` | 120 | 1.70 ms | 3.49 ms | 5.45 ms | 7.42 ms | 7.81 ms |
| `GET /api/files` | 120 | 0.96 ms | 1.19 ms | 1.69 ms | 3.29 ms | 4.93 ms |
| `POST /api/clipboard` | 100 | 0.78 ms | 0.95 ms | 1.66 ms | 2.61 ms | 3.83 ms |
| WebSocket command `ping` RTT | 50 | 0.09 ms | 0.15 ms | 1.87 ms | 5.84 ms | 5.84 ms |

Internal encode paths (`POST /api/diagnostics/benchmark`, two runs):

| Operation | Run A | Run B |
| :--- | ---: | ---: |
| JSON stringify, per touch event | 0.36 µs | 0.37 µs |
| PNG encode 640×360 | 14.6 ms | 24.5 ms |
| HMAC-SHA256, per op | 2.96 µs | 8.4 µs |
| Event bus fan-out p50 | 1.0 µs | 1.6 µs |
| Event bus fan-out p95 | 1.35 µs | 1.87 µs |

The spread between the two runs (PNG encode especially) is CPU steal on a
shared VM, not code variance.

## Why the control plane is cheap

- The server has **zero runtime dependencies**; state is an in-memory object and
  a snapshot is a shallow serialisation.
- Clipboard and files are handled off the event loop for the heavy part (file
  uploads stream to disk; images are capped at 4.5 MB).
- The WebSocket is a single frame envelope with a small command table, not a
  generic RPC layer.
- Telemetry is pushed at 1 Hz and coalesced; the UI debounces state refreshes.

## Mirror latency (video path)

Android DEX delegates capture/encode to the device and uses scrcpy-compatible
transport. Published scrcpy figures for the mirroring path are **35–70 ms** on
USB with a hardware encoder ([scrcpy README, latency section](../doc/scrcpy.md)).
The bridge does not add a decode/re-encode step; the console receives the video
stream and renders it. Expect:

| Link | Typical glass-to-glass | Notes |
| :--- | ---: | :--- |
| USB 3, hardware H.264 | 35–60 ms | best case, 60 fps |
| USB 2, 1080p | 50–90 ms | bandwidth-limited at high bitrate |
| 5 GHz Wi-Fi, 1080p60 | 60–120 ms | depends on AP airtime and interference |
| 2.4 GHz Wi-Fi | 120–250 ms | use the `low` preset (720p30) |

These are expectations, not measurements from the run above. Measure your own
link with:

```bash
# control plane
node bench/bench.js
# video: capture 10 s in the console, then compare tap-to-photon with a 240 fps phone camera
```

The **Developer → Benchmark** view runs the internal micro-benchmark without a
terminal and shows the CPU/Node it ran on.

## Comparison with scrcpy

| | scrcpy | Android DEX |
| :--- | :--- | :--- |
| Process model | Native desktop app, SDL window | Node bridge + browser/PWA |
| Startup | ~0.3–1 s | ~0.5 s bridge + first paint |
| Mirror latency | 35–70 ms (published) | Same class; transport is scrcpy-compatible |
| Control plane | ADB shell per action, no API | REST + WebSocket, ~1 ms p50 |
| Clipboard | Text only | Text + images, history, pins |
| Files | Drag-and-drop into a window | Upload + WebDAV mount + push to device |
| Telephony / notifications | None | SMS/MMS/RCS, calls, inline replies |
| Multi-window | One window (plus OTG) | Floating windows, snapping, PiP, monitors |
| RAM on host | ~50–150 MB | ~60–120 MB Node + browser tab |
| Dependencies | adb, SDL, FFmpeg | Node only; browser for UI |

Use scrcpy directly if all you need is one mirrored window with the lowest
possible overhead. Use Android DEX when you want the productivity layer around
it. Both can coexist; the bridge never takes exclusive ownership of adb.

## Regressions

CI runs `npm run build` and `npm run reproducible` on every push but not the
latency benchmark (shared runners are too noisy for stable numbers). Before a
release, run the benchmark on a quiet machine and compare p95, not min. Attach
the JSON output to the release PR.
