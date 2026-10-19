/**
 * Universal search across apps, contacts, messages, files, clipboard,
 * notifications, game profiles, settings and plugins.
 */
import path from 'node:path';

const SETTINGS_INDEX = [
  ['Appearance & theme', 'settings', 'Theme, high contrast, dyslexia font, reduced motion, UI scale.', 'appearance'],
  ['Keyboard shortcuts', 'settings', 'Rebind global hotkeys and review accessibility shortcuts.', 'hotkeys'],
  ['Clipboard history', 'settings', 'Clipboard sync, retention and image support.', 'clipboard'],
  ['Connection & reconnection', 'settings', 'Backoff, auto-reconnect, wake-on-connect, bandwidth presets.', 'connection'],
  ['Audio routing', 'settings', 'Desktop, headphones, phone speaker or HDMI.', 'audio'],
  ['Virtual camera & microphone', 'settings', 'Expose phone camera and desktop mic to Zoom, Teams and OBS.', 'camera'],
  ['Notifications & DND', 'settings', 'Mirroring, inline replies, do-not-disturb sync.', 'notifications'],
  ['Lock screen & biometrics', 'settings', 'Lock/unlock the phone and forward biometric prompts.', 'security'],
  ['Gaming profiles', 'settings', 'Sensitivity curves, macros, controller mapping and fair-play.', 'gaming'],
  ['Updates & release channel', 'settings', 'Stable, beta or nightly channel and signature verification.', 'updates'],
  ['Privacy & diagnostics', 'settings', 'Crash reporting toggle (off by default) and local logs.', 'privacy'],
  ['Filesystem mount', 'settings', 'WebDAV drive and shared folder configuration.', 'files'],
];

export function initSearch(runtime, { files }) {
  const { state } = runtime;

  const match = (text, query) => String(text || '').toLowerCase().includes(query);

  const walkFiles = async (dir = '', depth = 0) => {
    if (depth > 2) return [];
    const listing = await files.list(dir).catch(() => ({ items: [] }));
    const nested = [];
    for (const item of listing.items) {
      nested.push(item);
      if (item.kind === 'folder') nested.push(...await walkFiles(item.path, depth + 1));
    }
    return nested;
  };

  return {
    async query(rawQuery, { limit = 8 } = {}) {
      const query = String(rawQuery || '').trim().toLowerCase();
      if (query.length < 1) return { query, groups: [], total: 0 };
      const groups = [];

      const push = (type, label, items) => {
        if (items.length) groups.push({ type, label, items: items.slice(0, limit) });
      };

      push('apps', 'Apps', state.apps.filter((app) => match(app.name, query) || match(app.package, query))
        .map((app) => ({
          id: app.id, title: app.name, subtitle: app.package, icon: app.icon, color: app.color,
          action: { type: 'launch', appId: app.id },
        })));

      push('contacts', 'Contacts', state.contacts.filter((contact) => match(contact.name, query) || match(contact.number, query) || match(contact.email, query))
        .map((contact) => ({
          id: contact.id, title: contact.name, subtitle: `${contact.number}${contact.company ? ` · ${contact.company}` : ''}`,
          icon: 'user', color: contact.avatarColor, action: { type: 'call', number: contact.number, name: contact.name },
        })));

      const messages = [];
      for (const conversation of state.conversations) {
        for (const message of conversation.messages.slice(-30)) {
          if (match(message.text, query)) {
            messages.push({
              id: `${conversation.id}:${message.id}`, title: conversation.name,
              subtitle: message.text.slice(0, 140), icon: 'message-square', color: conversation.avatarColor,
              action: { type: 'open-conversation', conversationId: conversation.id },
            });
          }
        }
      }
      push('messages', 'Messages', messages);

      const filesFound = (await walkFiles('')).filter((file) => match(file.name, query) || match(file.path, query));
      push('files', 'Files', filesFound.map((file) => ({
        id: file.id, title: file.name, subtitle: `${file.kind === 'folder' ? 'Folder' : file.sizeLabel} · ${file.path || '/'}`,
        icon: file.kind === 'folder' ? 'folder' : 'file', color: '#8ab4f8',
        action: { type: 'files', path: file.kind === 'folder' ? file.path : path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path) },
      })));

      push('clipboard', 'Clipboard', state.clipboard.filter((item) => match(item.text, query))
        .map((item) => ({
          id: item.id, title: item.text.slice(0, 80), subtitle: `${item.kind} · ${item.source}`,
          icon: item.kind === 'image' ? 'image' : 'clipboard', color: '#f4a261',
          action: { type: 'clipboard', path: '' },
        })));

      push('notifications', 'Notifications', state.notifications.filter((item) => match(item.title, query) || match(item.body, query))
        .map((item) => ({
          id: item.id, title: item.title, subtitle: item.body, icon: 'bell', color: item.color,
          action: { type: 'notifications' },
        })));

      push('gaming', 'Game profiles', state.gameProfiles.filter((profile) => match(profile.name, query) || match(profile.game, query))
        .map((profile) => ({
          id: profile.id, title: profile.name, subtitle: `${profile.game} · ${profile.controls.length} controls`,
          icon: 'gamepad-2', color: '#c084fc', action: { type: 'game-profile', profileId: profile.id },
        })));

      push('settings', 'Settings', SETTINGS_INDEX.filter(([title, , description]) => match(title, query) || match(description, query))
        .map(([title, , description, section]) => ({
          id: `setting_${section}`, title, subtitle: description, icon: 'settings', color: '#8a8f98',
          action: { type: 'settings', section },
        })));

      push('plugins', 'Plugins', state.plugins.filter((plugin) => match(plugin.name, query) || match(plugin.description, query))
        .map((plugin) => ({
          id: plugin.id, title: plugin.name, subtitle: plugin.description, icon: 'puzzle', color: '#a78bfa',
          action: { type: 'plugins', pluginId: plugin.id },
        })));

      return { query: rawQuery, groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) };
    },
  };
}
