/**
 * Example plugin for the Android DEX plugin API.
 *
 * Enabled from Settings → Plugins or:  android-dex plugins enable speaker-notes
 * The plugin only receives the permissions declared in manifest.json.
 */
let currentNote = '';

export function activate(api) {
  api.log('activated');

  const offClipboard = api.on('clipboard.changed', (item) => {
    if (item.kind === 'text') currentNote = item.text.slice(0, 400);
  });

  const offFocus = api.on('window.focused', (win) => {
    if (!currentNote) return;
    if (!/slides|powerpoint|keynote|presentation/i.test(`${win.title} ${win.package}`)) return;
    api.notify({ body: `📝 ${currentNote}` });
  });

  return {
    dispose() {
      offClipboard();
      offFocus();
    },
    currentNote: () => currentNote,
  };
}

export function deactivate() {
  currentNote = '';
}
