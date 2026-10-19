# Contributing to Android DEX

Thanks for helping. This repository ships **code, not mockups** — every feature
in the README is backed by a route, a view and a test or a documented manual
check.

## Quick start

```bash
git clone https://github.com/Shrey113/Android-Dex
cd Android-Dex
node --version          # >= 20.11
npm --prefix server test # 25 tests, no dependencies to install
node server/src/index.js serve --port 8787
# open http://127.0.0.1:8787/
```

There is nothing to build: the server is plain ESM Node, the console is plain
ES modules and CSS. Do not add a bundler.

## Layout

| Path | What lives there |
| :--- | :--- |
| `server/src/` | Bridge core: state, HTTP router, WebSocket, WebDAV, pairing, supervisor |
| `server/src/features/` | One module per domain (clipboard, files, telephony, …) |
| `server/test/` | `node:test` suites — API, features, security |
| `app/` | Console: shell, router, window manager, views, CSS, offline assets |
| `sdk/` | Dependency-free JS client used by integrations and its tests |
| `doc/` | User guide, API, plugin SDK, protocol, benchmarks, troubleshooting |
| `packaging/` | deb/rpm/Flatpak/Snap/macOS/Windows definitions |
| `scripts/` | Release, SBOM, signing, reproducibility and verification tooling |

## Rules of the road

1. **Zero runtime dependencies** in `server/`. Node core modules only. This keeps
   the bridge auditable and the SBOM small. Dev-only tooling must stay out of
   `server/package.json` `dependencies`.
2. **No network calls to third parties.** The bridge is LAN-only by design. New
   outbound traffic needs a privacy review and an opt-in setting.
3. **Every new endpoint** needs a route in `server/src/http.js` with a `summary`,
   a test in `server/test/`, and a row in `doc/API.md`.
4. **Every new view** must render from the demo snapshot with no bridge running.
   `npm run lint:app` checks imports, syntax and icon coverage.
5. **Accessibility is not optional.** Icon-only buttons need `aria-label`; new
   dialogs must use `openModal` (it traps focus and restores it); new shortcuts
   must be registered so they appear in the cheat sheet.
6. **i18n:** add keys to `app/js/i18n.js` `en` and use `t('key')`. Other locales
   fall back key-by-key, so partial translations are welcome.
7. **Never commit runtime data.** `.dex-data/`, logs, tokens and crash bundles
   are ignored.

## Adding a feature (checklist)

```text
[ ] state shape in server/src/state.js (+ migration/default)
[ ] feature module in server/src/features/<name>.js
[ ] route(s) with summaries in server/src/http.js
[ ] demo behaviour in app/js/demo.js so the UI works offline
[ ] view or panel wiring in app/js/views/ and app/js/panels.js
[ ] i18n keys in app/js/i18n.js
[ ] test in server/test/features.test.js (or a new suite)
[ ] doc/API.md + doc/USER_GUIDE.md
[ ] CHANGELOG.md entry
[ ] npm test && npm run lint:app
```

## Tests

```bash
npm --prefix server test          # API/features/security (25)
node --test sdk/test/*.test.js    # SDK against a live bridge
npm run lint:app                  # import graph, syntax, icons, service worker
npm run bench                     # latency table against a running bridge
npm run reproducible              # build twice, compare hashes
```

The SDK suite expects a bridge on `http://127.0.0.1:8790` with token `smoke`
(`DEX_TEST_URL` / `DEX_TEST_TOKEN` override). CI starts one for you.

## Style

- 2-space indent, single quotes, semicolons, trailing commas in multiline
  literals. No linter dependency; match the surrounding file.
- Server functions stay small and return JSON-serialisable values. Throws are
  `HttpError` (see `server/src/util.js`) so the router can map status codes.
- Console code uses `el()` / `icon()` helpers instead of string templates where
  user data is interpolated; raw HTML must pass through `esc()`.
- Comments explain *why*, not *what*. Remove dead code instead of commenting it
  out.

## Commits & PRs

Conventional-commit subjects (`feat:`, `fix:`, `docs:`, `chore:`) are preferred.
A PR should describe the user-visible change, list the tests run, and include a
screenshot or recording for UI changes. Do not bump the version in a feature PR;
the release workflow owns that.

## Security

Report vulnerabilities privately per [SECURITY.md](SECURITY.md). Do not open a
public issue for an unpatched token, TLS or fingerprint bypass.

## Licence

Contributions become part of the project under the repository licence in
[LICENSE](LICENSE) (proprietary; see the file for permitted use). By opening a PR
you confirm you have the right to submit the code and agree to those terms.
