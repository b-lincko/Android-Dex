# Plugins

A plugin is a folder with `manifest.json` and `index.js` exporting
`activate(api)`. Plugins are **disabled by default**, get an explicit
permission list, and never receive network access — the bridge does not expose
`fetch` or Node built-ins to them. See [doc/PLUGINS.md](../../doc/PLUGINS.md)
for the full API, permission matrix and packaging guidance.

```bash
android-dex plugins list
android-dex plugins enable speaker-notes
```

Installed plugins live next to this README; user plugins can also be placed in
`$DEX_DATA_DIR/plugins` by setting `DEX_PLUGINS_DIR`.
