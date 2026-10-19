/**
 * In-memory state for the Android DEX bridge.
 *
 * The desktop client is the source of truth for UI preferences; this bridge
 * owns connection, telephony, clipboard, files and automation state so that a
 * headless server can drive a phone without any desktop UI attached.
 *
 * Volatile telemetry is never persisted. User-owned data (settings, profiles,
 * clipboard history, conversations, widgets) is persisted as JSON.
 */
import { EventBus, Logger, Store, clamp, nowIso, pick, uid } from './util.js';

export const PERSISTED_KEYS = [
  'settings', 'devices', 'activeDeviceId', 'windows', 'widgets', 'clipboard',
  'conversations', 'contacts', 'gameProfiles', 'plugins', 'quickTiles', 'notes',
];

export const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | system
  highContrast: false,
  dyslexiaFont: false,
  reducedMotion: false,
  uiScale: 100,
  density: 'comfortable', // compact | comfortable | spacious
  locale: 'en',
  rtl: false,

  // connection
  autoReconnect: true,
  reconnectBackoff: { baseMs: 500, factor: 1.8, maxMs: 30000, jitter: 0.2 },
  autoLaunch: true,
  startMinimized: true,
  wakeOnConnect: true,
  offlineMode: false,
  bandwidth: 'high', // low | medium | high
  encryptedWireless: true,
  requirePairingToken: true,

  // sync
  clipboardSync: true,
  clipboardImages: true,
  clipboardRetentionMinutes: 120,
  fileDropEnabled: true,
  filesystemMount: true,

  // system
  dnd: false,
  mirrorToOsNotificationCenter: true,
  replyFromNotifications: true,
  biometricForwarding: true,
  idlePrevention: true,
  chargeLimit: 80,
  chargeThrottle: false,
  audioOutput: 'desktop', // desktop | headphones | android | hdmi
  micPassthrough: false,
  virtualCamera: false,
  gamepadPassthrough: false,
  stylusPressure: true,
  hostMicDevice: 'default',

  // privacy / trust
  crashReporting: false,
  diagnosticsLocalOnly: true,
  aimAssistDisclosureAck: false,
  gameProfileCloudSync: false,
  webhookUrl: '',

  // updates
  updateChannel: 'stable',
  autoUpdate: true,

  // hotkeys (rebindable from Settings → Keyboard)
  hotkeys: {
    toggleUi: 'Ctrl+Alt+Down',
    deviceSwitcher: 'Ctrl+Alt+Right',
    screenshot: 'Ctrl+Alt+P',
    record: 'Ctrl+Alt+R',
    clipboard: 'Ctrl+Shift+V',
    search: 'Ctrl+K',
    lock: 'Ctrl+Shift+L',
    pip: 'Ctrl+Shift+P',
    alwaysOnTop: 'Ctrl+Shift+T',
    fullscreen: 'Ctrl+F',
  },
};

const CAPS = ['clipboard', 'files', 'telephony', 'sms', 'mms', 'rcs', 'notifications',
  'reply', 'camera', 'mic', 'gamepad', 'stylus', 'biometric', 'widgets'];

export function seedDevice(overrides = {}) {
  return {
    id: 'dev_pixel8pro',
    name: 'Pixel 8 Pro',
    model: 'Google Pixel 8 Pro',
    manufacturer: 'Google',
    android: 15,
    sdk: 35,
    serial: '2B1X0A9KQ',
    transport: 'usb', // usb | wifi
    ip: '192.168.1.42',
    status: 'connected', // connected | reconnecting | offline | pairing
    battery: { level: 76, charging: true, temperature: 31.2, health: 'good' },
    signal: 4,
    carrier: 'o2-de',
    encrypted: true,
    pinnedFingerprint: 'SHA256:7f:4c:19:aa:02:9d:31:8e:55:c1:7a:0d:22:bb:46:e0',
    pairedAt: '2026-09-02T08:11:00.000Z',
    lastSeen: nowIso(),
    capabilities: CAPS,
    quality: { preset: 'high', fps: 60, bitrateMbps: 16, resolution: '1440x3120' },
    ...overrides,
  };
}

const APP_SEED = [
  ['android', 'Settings', 'com.android.settings', 'System', 'settings', '#8a8f98'],
  ['messages', 'Messages', 'com.google.android.apps.messaging', 'Social', 'message-square', '#3ddc84'],
  ['dialer', 'Phone', 'com.google.android.dialer', 'System', 'phone', '#34a853'],
  ['whatsapp', 'WhatsApp', 'com.whatsapp', 'Social', 'messages-square', '#25d366'],
  ['teams', 'Teams', 'com.microsoft.teams', 'Work', 'users', '#6264a7'],
  ['gmail', 'Gmail', 'com.google.android.gm', 'Work', 'file-text', '#ea4335'],
  ['chrome', 'Chrome', 'com.android.chrome', 'Internet', 'globe', '#4285f4'],
  ['photos', 'Photos', 'com.google.android.apps.photos', 'Media', 'image', '#fbbc04'],
  ['youtube', 'YouTube', 'com.google.android.youtube', 'Media', 'play', '#ff0033'],
  ['spotify', 'Spotify', 'com.spotify.music', 'Media', 'music', '#1db954'],
  ['maps', 'Maps', 'com.google.android.apps.maps', 'Travel', 'map-pin', '#34a853'],
  ['camera', 'Camera', 'com.android.camera', 'Media', 'camera', '#9aa0a6'],
  ['clock', 'Clock', 'com.google.android.deskclock', 'System', 'clock', '#8ab4f8'],
  ['gallery', 'Gallery', 'com.android.gallery3d', 'Media', 'image', '#e8eaed'],
  ['minecraft', 'Minecraft', 'com.mojang.minecraftpe', 'Games', 'gamepad-2', '#62b47a'],
  ['genshin', 'Genshin Impact', 'com.miHoYo.GenshinImpact', 'Games', 'sparkles', '#d6b26a'],
  ['termux', 'Termux', 'com.termux', 'Developer', 'terminal', '#5f6c72'],
  ['files', 'Files', 'com.android.documentsui', 'System', 'folder', '#8ab4f8'],
];

export function seedApps() {
  return APP_SEED.map(([id, name, pkg, category, icon, color]) => ({
    id, name, package: pkg, category, icon, color,
    installed: true,
    version: `${1 + (id.length % 5)}.${id.length % 9}.0`,
    usageMinutes: (id.length * 37) % 480,
  }));
}

function seedWindows() {
  return [
    {
      id: 'win_messages', appId: 'messages', title: 'Messages', package: 'com.google.android.apps.messaging',
      icon: 'message-square', color: '#3ddc84', monitorId: 'mon_main',
      x: 40, y: 48, w: 380, h: 620, z: 3, minimized: false, maximized: false,
      alwaysOnTop: false, pip: false, orientation: 'portrait', dpi: 420, scale: 100,
      snapped: null, audio: true, state: 'running',
    },
    {
      id: 'win_spotify', appId: 'spotify', title: 'Spotify', package: 'com.spotify.music',
      icon: 'music', color: '#1db954', monitorId: 'mon_main',
      x: 446, y: 48, w: 560, h: 420, z: 2, minimized: false, maximized: false,
      alwaysOnTop: false, pip: false, orientation: 'landscape', dpi: 320, scale: 100,
      snapped: 'right-half', audio: true, state: 'running',
    },
    {
      id: 'win_teams', appId: 'teams', title: 'Teams', package: 'com.microsoft.teams',
      icon: 'users', color: '#6264a7', monitorId: 'mon_side',
      x: 60, y: 80, w: 640, h: 460, z: 1, minimized: false, maximized: false,
      alwaysOnTop: false, pip: false, orientation: 'landscape', dpi: 240, scale: 100,
      snapped: null, audio: false, state: 'running',
    },
  ];
}

function seedConversations() {
  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return [
    {
      id: 'conv_maya', name: 'Maya Rodríguez', number: '+49 151 2345 6789', avatarColor: '#e07a5f',
      company: 'Northwind', unread: 2, rcs: true, pinned: true, muted: false,
      messages: [
        { id: 'm1', from: 'them', kind: 'sms', text: 'Did you get the deck from the client?', ts: t(42), status: 'read' },
        { id: 'm2', from: 'me', kind: 'sms', text: 'Yes — reviewing it now. The roadmap slide needs one more pass.', ts: t(39), status: 'delivered' },
        { id: 'm3', from: 'them', kind: 'mms', text: 'Mockup for slide 4 📎', media: { name: 'roadmap-v4.png', size: 284_112 }, ts: t(21), status: 'read' },
        { id: 'm4', from: 'them', kind: 'sms', text: 'Ping me when you are free, I have two questions.', ts: t(6), status: 'read' },
      ],
    },
    {
      id: 'conv_jonas', name: 'Jonas Weber', number: '+49 160 9988 771', avatarColor: '#3d8bfd',
      company: 'Freelance', unread: 0, rcs: true, pinned: true, muted: false,
      messages: [
        { id: 'm1', from: 'them', kind: 'sms', text: 'The Flatpak build passes on Fedora 41 now.', ts: t(180), status: 'read' },
        { id: 'm2', from: 'me', kind: 'sms', text: 'Excellent. Pushing the signature step to CI tonight.', ts: t(175), status: 'read' },
        { id: 'm3', from: 'them', kind: 'sms', text: 'Nice. Can you add a checksum file to the release notes?', ts: t(150), status: 'read' },
        { id: 'm4', from: 'me', kind: 'sms', text: 'Already automated — SHA256SUMS + .sig.', ts: t(148), status: 'read' },
      ],
    },
    {
      id: 'conv_mum', name: 'Mum', number: '+44 7700 900123', avatarColor: '#9b5de5',
      company: '', unread: 1, rcs: false, pinned: false, muted: false,
      messages: [
        { id: 'm1', from: 'them', kind: 'sms', text: 'Are you still coming Sunday?', ts: t(320), status: 'read' },
        { id: 'm2', from: 'me', kind: 'sms', text: 'Yes, around 1pm. I will bring the cake.', ts: t(300), status: 'read' },
        { id: 'm3', from: 'them', kind: 'sms', text: '💛 Perfect. Drive safe.', ts: t(60), status: 'read' },
      ],
    },
    {
      id: 'conv_delivery', name: 'DHL Express', number: '+49 222 4455667', avatarColor: '#ffb703',
      company: 'DHL', unread: 0, rcs: false, pinned: false, muted: true,
      messages: [
        { id: 'm1', from: 'them', kind: 'sms', text: 'Your parcel 00340 4421 9983 is out for delivery today between 14:00 and 16:00.', ts: t(500), status: 'read' },
      ],
    },
  ];
}

function seedContacts() {
  return [
    { id: 'c_maya', name: 'Maya Rodríguez', number: '+4915123456789', email: 'maya@northwind.dev', company: 'Northwind', favorite: true, avatarColor: '#e07a5f' },
    { id: 'c_jonas', name: 'Jonas Weber', number: '+491609988771', email: 'jonas@weber.dev', company: 'Freelance', favorite: true, avatarColor: '#3d8bfd' },
    { id: 'c_mum', name: 'Mum', number: '+447700900123', email: '', company: '', favorite: true, avatarColor: '#9b5de5' },
    { id: 'c_amara', name: 'Amara Okafor', number: '+2348031234567', email: 'amara@okafor.io', company: 'Field Labs', favorite: false, avatarColor: '#2a9d8f' },
    { id: 'c_lijo', name: 'Lijo Thomas', number: '+97433123456', email: 'lijo@example.qa', company: 'Doha Studio', favorite: false, avatarColor: '#f4a261' },
    { id: 'c_sven', name: 'Sven Hartmann', number: '+491701233445', email: 'sven@hartmann.de', company: 'Northwind', favorite: false, avatarColor: '#118ab2' },
    { id: 'c_priya', name: 'Priya Nair', number: '+919820011223', email: 'priya@nair.in', company: 'Anvil', favorite: false, avatarColor: '#e76f51' },
  ];
}

function seedClipboard() {
  const t = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    { id: 'clip_1', kind: 'text', text: 'https://github.com/Shrey113/Android-Dex/releases/latest', source: 'desktop', ts: t(2), pinned: true, deviceId: 'dev_pixel8pro' },
    { id: 'clip_2', kind: 'text', text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq…Y2VkZ2U= lijo@doha', source: 'android', ts: t(9), pinned: false, deviceId: 'dev_pixel8pro' },
    { id: 'clip_3', kind: 'image', text: 'Screenshot 2026-10-19 09-58-12.png', dataUrl: 'placeholder:gradient', source: 'android', ts: t(16), pinned: false, deviceId: 'dev_pixel8pro', width: 1440, height: 3120, size: 612_455 },
    { id: 'clip_4', kind: 'text', text: 'npm run package:linux -- --targets deb,rpm,flatpak', source: 'desktop', ts: t(31), pinned: false, deviceId: 'dev_pixel8pro' },
    { id: 'clip_5', kind: 'text', text: 'Q4 OKR draft: latency p95 < 40 ms, crash-free sessions ≥ 99.7%', source: 'desktop', ts: t(47), pinned: true, deviceId: 'dev_pixel8pro' },
  ];
}

function seedNotifications() {
  const t = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    {
      id: 'note_1', app: 'Messages', icon: 'message-square', color: '#3ddc84', title: 'Maya Rodríguez',
      body: 'Ping me when you are free, I have two questions.', ts: t(6), read: false,
      actions: [{ id: 'reply', label: 'Reply', reply: true }, { id: 'mark_read', label: 'Mark read' }],
      conversationId: 'conv_maya', mirroredToOs: true, deviceId: 'dev_pixel8pro',
    },
    {
      id: 'note_2', app: 'Teams', icon: 'users', color: '#6264a7', title: 'Design review · 14:30',
      body: 'Sven Hartmann started the meeting early.', ts: t(18), read: false,
      actions: [{ id: 'join', label: 'Join' }, { id: 'snooze', label: 'Snooze 10m' }],
      mirroredToOs: true, deviceId: 'dev_pixel8pro',
    },
    {
      id: 'note_3', app: 'Maps', icon: 'map-pin', color: '#34a853', title: 'Traffic alert',
      body: 'A7 northbound delayed by 18 minutes. Leave by 15:05.', ts: t(54), read: false,
      actions: [{ id: 'open', label: 'Open route' }], mirroredToOs: false, deviceId: 'dev_pixel8pro',
    },
    {
      id: 'note_4', app: 'Play Store', icon: 'package', color: '#62b47a', title: '4 apps updated',
      body: 'Chrome, Photos, Gmail and 1 other were updated in the background.', ts: t(120), read: true,
      actions: [], mirroredToOs: false, deviceId: 'dev_pixel8pro',
    },
    {
      id: 'note_5', app: 'Battery', icon: 'battery-charging', color: '#f4a261', title: 'Charge limit reached',
      body: 'Battery protection paused charging at 80% while mirroring.', ts: t(140), read: true,
      actions: [{ id: 'resume', label: 'Charge to 100%' }], mirroredToOs: false, deviceId: 'dev_pixel8pro',
    },
  ];
}

function seedGameProfiles() {
  return [
    {
      id: 'gp_delta', appId: 'delta', name: 'Delta Force — 4-finger claw', game: 'Delta Force Mobile',
      package: 'com.tencent.tmgp.dfm', author: 'shrey', version: 3, sharing: 'link',
      updatedAt: '2026-10-11T18:12:00.000Z', downloads: 1420, rating: 4.7,
      sensitivity: { xCurve: 0.62, yCurve: 0.58, deadzone: 0.06, gyroSens: 55, aimAssist: false },
      controls: [
        { id: 'k_w', type: 'dpad', key: 'W', label: 'Move', x: 0.14, y: 0.76, w: 0.16, h: 0.16, settings: { radius: 0.09, deadzone: 0.08, sprint: 0.85 } },
        { id: 'k_mouse', type: 'look', key: 'Mouse', label: 'Aim / Look', x: 0.78, y: 0.42, w: 0.2, h: 0.2, settings: { lockCursor: true, sensitivity: 0.62 } },
        { id: 'k_lmb', type: 'tap', key: 'Mouse1', label: 'Fire', x: 0.9, y: 0.78, w: 0.07, h: 0.07, settings: { turbo: false } },
        { id: 'k_rmb', type: 'tap', key: 'Mouse2', label: 'ADS', x: 0.82, y: 0.7, w: 0.07, h: 0.07, settings: { hold: true } },
        { id: 'k_r', type: 'tap', key: 'R', label: 'Reload', x: 0.7, y: 0.86, w: 0.06, h: 0.06, settings: {} },
        { id: 'k_shift', type: 'swipe', key: 'Shift', label: 'Sprint', x: 0.22, y: 0.88, w: 0.06, h: 0.06, settings: { direction: 'up', distance: 0.18 } },
        { id: 'k_e', type: 'tap', key: 'E', label: 'Interact', x: 0.63, y: 0.8, w: 0.06, h: 0.06, settings: {} },
        { id: 'k_q', type: 'macro', key: 'Q', label: 'Quick-swap combo', x: 0.68, y: 0.74, w: 0.06, h: 0.06, settings: { macroId: 'macro_swap' } },
      ],
      macros: [
        {
          id: 'macro_swap', name: 'Quick-swap combo',
          steps: [
            { type: 'tap', x: 0.31, y: 0.91, delayMs: 0 },
            { type: 'tap', x: 0.88, y: 0.9, delayMs: 90 },
            { type: 'swipe', x: 0.6, y: 0.8, x2: 0.7, y2: 0.72, delayMs: 140 },
            { type: 'tap', x: 0.9, y: 0.78, delayMs: 70 },
          ],
        },
      ],
      controllerMap: {
        buttonA: { action: 'tap', x: 0.9, y: 0.78 },
        buttonB: { action: 'tap', x: 0.7, y: 0.86 },
        leftStick: { action: 'dpad', deadzone: 0.08 },
        rightStick: { action: 'look', sensitivity: 0.6 },
        triggerR2: { action: 'tap', x: 0.82, y: 0.7 },
      },
    },
    {
      id: 'gp_genshin', appId: 'genshin', name: 'Genshin — comfort layout', game: 'Genshin Impact',
      package: 'com.miHoYo.GenshinImpact', author: 'lijo', version: 2, sharing: 'private',
      updatedAt: '2026-09-28T09:30:00.000Z', downloads: 0, rating: 0,
      sensitivity: { xCurve: 0.5, yCurve: 0.5, deadzone: 0.1, gyroSens: 0, aimAssist: false },
      controls: [
        { id: 'g_wasd', type: 'dpad', key: 'W', label: 'Move', x: 0.15, y: 0.75, w: 0.16, h: 0.16, settings: { radius: 0.09, deadzone: 0.1 } },
        { id: 'g_look', type: 'look', key: 'Mouse', label: 'Camera', x: 0.8, y: 0.4, w: 0.2, h: 0.2, settings: { sensitivity: 0.5 } },
        { id: 'g_e', type: 'tap', key: 'E', label: 'Elemental skill', x: 0.83, y: 0.82, w: 0.07, h: 0.07, settings: {} },
        { id: 'g_q', type: 'tap', key: 'Q', label: 'Burst', x: 0.91, y: 0.72, w: 0.07, h: 0.07, settings: {} },
        { id: 'g_space', type: 'tap', key: 'Space', label: 'Jump', x: 0.9, y: 0.9, w: 0.06, h: 0.06, settings: {} },
      ],
      macros: [],
      controllerMap: {},
    },
  ];
}

function seedWidgets() {
  return [
    { id: 'w_clock', type: 'clock', monitorId: 'mon_main', x: 28, y: 96, w: 220, h: 140, z: 1, config: { timezone: 'Asia/Qatar', format24h: true } },
    { id: 'w_battery', type: 'battery', monitorId: 'mon_main', x: 262, y: 96, w: 200, h: 140, z: 1, config: { showTemperature: true } },
    { id: 'w_weather', type: 'weather', monitorId: 'mon_side', x: 36, y: 36, w: 240, h: 150, z: 1, config: { city: 'Doha' } },
    { id: 'w_notes', type: 'notes', monitorId: 'mon_main', x: 28, y: 250, w: 300, h: 200, z: 1, config: { text: 'Ship the 2.0 console:\n• mount\n• calls + SMS\n• signed packages' } },
  ];
}

function seedQuickTiles() {
  return [
    { id: 'wifi', label: 'Wi-Fi', icon: 'wifi', enabled: true, detail: 'HomeNet-5G', danger: false },
    { id: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth', enabled: true, detail: 'Buds Pro', danger: false },
    { id: 'hotspot', label: 'Hotspot', icon: 'radio', enabled: false, detail: 'Off', danger: false },
    { id: 'cellular', label: 'Mobile data', icon: 'signal', enabled: true, detail: '5G · 12 GB left', danger: false },
    { id: 'flashlight', label: 'Flashlight', icon: 'zap', enabled: false, detail: 'Off', danger: false },
    { id: 'airplane', label: 'Airplane', icon: 'globe', enabled: false, detail: 'Off', danger: true },
    { id: 'dnd', label: 'Do not disturb', icon: 'moon', enabled: false, detail: 'Off', danger: false },
    { id: 'rotation', label: 'Auto-rotate', icon: 'rotate-cw', enabled: true, detail: 'On', danger: false },
  ];
}

function seedPlugins() {
  return [
    {
      id: 'speaker-notes', name: 'Speaker Notes', version: '1.0.0', author: 'Android DEX SDK',
      description: 'Shows clipboard snippets as speaker notes next to mirrored slides.',
      enabled: false, permissions: ['clipboard:read', 'windows:read'], hooks: ['window.focused', 'clipboard.changed'],
    },
    {
      id: 'home-automation', name: 'Home Automation Bridge', version: '0.9.1', author: 'community',
      description: 'Republishes bridge events (calls, arrivals, DND) to a local MQTT/HTTP endpoint.',
      enabled: false, permissions: ['events:read', 'settings:write'], hooks: ['calls.incoming', 'dnd.changed'],
    },
  ];
}

export function seedState() {
  return {
    version: 2,
    createdAt: nowIso(),
    settings: { ...DEFAULT_SETTINGS },
    devices: [seedDevice()],
    activeDeviceId: 'dev_pixel8pro',
    apps: seedApps(),
    windows: seedWindows(),
    monitors: [
      { id: 'mon_main', name: 'Built-in display', width: 2560, height: 1600, refresh: 120, primary: true, x: 0, y: 0, scale: 100 },
      { id: 'mon_side', name: 'DELL U2723QE', width: 3840, height: 2160, refresh: 60, primary: false, x: 2560, y: 0, scale: 100 },
    ],
    widgets: seedWidgets(),
    clipboard: seedClipboard(),
    conversations: seedConversations(),
    contacts: seedContacts(),
    notifications: seedNotifications(),
    calls: [],
    gameProfiles: seedGameProfiles(),
    quickTiles: seedQuickTiles(),
    plugins: seedPlugins(),
    notes: [{ id: 'note_seed', text: 'Ctrl+K opens universal search. Ctrl+Shift+V pins a clipboard item.', ts: nowIso() }],
    media: {
      output: 'desktop', volume: 62, muted: false, micGain: 55, micMuted: true,
      virtualCamera: false, webcamFps: 30, webcamFrames: 0,
      sessions: [
        { id: 'ms_spotify', app: 'Spotify', title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming', duration: 244, position: 78, playing: true, color: '#1db954', artwork: 'placeholder:aurora' },
        { id: 'ms_youtube', app: 'YouTube', title: 'Building a headless Android bridge', artist: 'DevConf 2026', album: '', duration: 1860, position: 512, playing: false, color: '#ff0033', artwork: 'placeholder:ember' },
      ],
      activeSessionId: 'ms_spotify',
      recording: { active: false, startedAt: null, frames: 0, target: 'video/webm' },
      screenshots: [],
      recordings: [],
    },
    input: {
      gamepad: { connected: false, id: null, axes: [0, 0, 0, 0], buttons: 0, lastAt: null, passthrough: false },
      stylus: { pressure: 0, tiltX: 0, tiltY: 0, active: false, lastAt: null, strokes: 0 },
      lastHotkey: null,
    },
    updates: {
      installed: '2.0.0', latest: '2.0.0', available: false, channel: 'stable',
      checkedAt: nowIso(), notes: 'You are on the latest signed release.',
      downloadUrl: 'https://github.com/Shrey113/Android-Dex/releases/latest',
      sha256: '9f2c0a1de6b8f4de2b2f7c1d7f3b4b6a9b2e0f8c5d7a1b3c9e2f4a6b8c0d1e3f',
      signature: '-----BEGIN PGP SIGNATURE----- (see SHA256SUMS.sig)',
    },
    reconnect: {
      state: 'connected', attempt: 0, nextRetryAt: null, lastDropAt: null,
      lastReason: null, restored: 0, totalDrops: 0, healthScore: 100,
    },
    security: {
      tls: false, requirePairingToken: true, pairedFingerprints: [{
        deviceId: 'dev_pixel8pro',
        fingerprint: 'SHA256:7f:4c:19:aa:02:9d:31:8e:55:c1:7a:0d:22:bb:46:e0',
        addedAt: '2026-09-02T08:11:00.000Z', lastUsedAt: nowIso(),
      }],
      pairing: null, rejectedAttempts: 0, audit: [
        { ts: nowIso(), event: 'bridge.started', detail: 'loopback only', severity: 'info' },
      ],
    },
    diagnostics: {
      crashReports: false, lastCrash: null, bootCount: 1, droppedFrames: 0,
      metrics: { httpRequests: 0, wsClients: 0, clipboardItems: 5, eventsEmitted: 0 },
    },
  };
}

export function createRuntime({ dataDir, logger = new Logger(), logFile = null } = {}) {
  const bus = new EventBus(logger);
  const state = seedState();
  const store = new Store(`${dataDir}/bridge-state.json`, state);
  let telemetryTimer = null;
  let dirty = false;

  if (logFile) logger.attachFile(logFile);

  const runtime = {
    logger,
    bus,
    state,
    dataDir,
    startedAt: Date.now(),
    store,

    async hydrate() {
      const saved = await store.load();
      for (const key of PERSISTED_KEYS) {
        if (saved[key] !== undefined) state[key] = saved[key];
      }
      state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      state.diagnostics.bootCount = (saved.diagnostics?.bootCount || 1) + 1;
      state.security.audit = (saved.security?.audit || []).slice(-100);
      if (!state.devices?.length) state.devices = [seedDevice()];
      logger.info('state', `hydrated ${PERSISTED_KEYS.length} persisted sections`);
      return state;
    },

    persist() {
      dirty = true;
      store.save({
        ...pick(state, PERSISTED_KEYS),
        diagnostics: { bootCount: state.diagnostics.bootCount },
        security: { audit: state.security.audit.slice(-100) },
      });
    },

    patchSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      if (patch.dnd !== undefined) {
        const tile = state.quickTiles.find((tile) => tile.id === 'dnd');
        if (tile) {
          tile.enabled = Boolean(patch.dnd);
          tile.detail = patch.dnd ? 'On' : 'Off';
        }
        bus.emit('dnd.changed', { enabled: state.settings.dnd });
      }
      if (patch.theme) bus.emit('theme.changed', { theme: patch.theme });
      if (patch.locale) bus.emit('locale.changed', { locale: patch.locale });
      bus.emit('settings.changed', patch);
      runtime.persist();
      return state.settings;
    },

    emit(event, payload) {
      state.diagnostics.metrics.eventsEmitted += 1;
      bus.emit(event, payload);
    },

    audit(event, detail, severity = 'info') {
      state.security.audit.push({ ts: nowIso(), event, detail, severity });
      state.security.audit = state.security.audit.slice(-200);
      runtime.persist();
    },

    activeDevice() {
      return state.devices.find((device) => device.id === state.activeDeviceId) || state.devices[0] || null;
    },

    /** Telemetry ticker. Keeps demo/live data fresh without touching user data. */
    startTelemetry(intervalMs = 2500) {
      stopTelemetry();
      telemetryTimer = setInterval(() => {
        const device = runtime.activeDevice();
        if (device && device.status === 'connected') {
          const jitter = (Math.random() - 0.5);
          device.battery.level = clamp(device.battery.level + (device.battery.charging ? 0.02 : -0.01), 1, 100);
          device.battery.temperature = clamp(device.battery.temperature + jitter * 0.08, 26, 43);
          device.signal = clamp(device.signal + (Math.random() > 0.92 ? (Math.random() > 0.5 ? 1 : -1) : 0), 0, 4);
          device.lastSeen = nowIso();
          const preset = { low: 30, medium: 45, high: 60 }[device.quality.preset] || 60;
          device.quality.fps = preset;
          device.quality.bitrateMbps = { low: 3, medium: 8, high: 16 }[device.quality.preset] || 16;
          runtime.emit('telemetry', {
            deviceId: device.id,
            battery: device.battery,
            signal: device.signal,
            quality: device.quality,
            reconnect: state.reconnect,
          });
        }
        const media = state.media;
        const active = media.sessions.find((session) => session.id === media.activeSessionId);
        if (active?.playing) {
          active.position = (active.position + intervalMs / 1000) % active.duration;
        }
        if (media.recording.active) {
          media.recording.frames += Math.round(intervalMs / 33);
        }
        if (media.virtualCamera) media.webcamFrames += 1;
        state.diagnostics.metrics.wsClients = bus.listenerCount?.('__clients__') || state.diagnostics.metrics.wsClients;
      }, intervalMs);
      telemetryTimer.unref?.();
      return () => stopTelemetry();
    },

    stopTelemetry() { stopTelemetry(); },

    snapshot() {
      return {
        version: state.version,
        bridge: { version: '2.0.0', uptimeMs: Date.now() - runtime.startedAt, persistence: Boolean(store.file) },
        settings: state.settings,
        devices: state.devices,
        activeDeviceId: state.activeDeviceId,
        apps: state.apps,
        windows: state.windows,
        monitors: state.monitors,
        widgets: state.widgets,
        clipboard: runtime.visibleClipboard(),
        conversations: state.conversations,
        contacts: state.contacts,
        notifications: state.notifications,
        calls: state.calls,
        gameProfiles: state.gameProfiles,
        quickTiles: state.quickTiles,
        plugins: state.plugins,
        notes: state.notes,
        media: state.media,
        input: state.input,
        updates: state.updates,
        reconnect: state.reconnect,
        security: { ...state.security, pairing: state.security.pairing ? { ...state.security.pairing, token: undefined } : null },
        diagnostics: state.diagnostics,
        timestamp: nowIso(),
      };
    },

    /** Respect clipboard retention + privacy settings. */
    visibleClipboard() {
      const cutoff = Date.now() - state.settings.clipboardRetentionMinutes * 60_000;
      const items = state.clipboard.filter((item) => item.pinned || new Date(item.ts).getTime() >= cutoff);
      state.clipboard = items;
      return items;
    },

    addClipboard(item) {
      const id = uid('clip');
      const entry = { id, ts: nowIso(), pinned: false, deviceId: state.activeDeviceId, ...item };
      // de-duplicate identical consecutive text
      const duplicate = state.clipboard.find((existing) => existing.text === entry.text && existing.kind === entry.kind);
      if (duplicate) {
        duplicate.ts = entry.ts;
        runtime.emit('clipboard.updated', duplicate);
        runtime.persist();
        return duplicate;
      }
      state.clipboard.unshift(entry);
      state.clipboard = state.clipboard.slice(0, 200);
      runtime.emit('clipboard.changed', entry);
      runtime.audit('clipboard.received', `${entry.kind} from ${entry.source}`, 'privacy');
      runtime.persist();
      return entry;
    },

    addNotification(notification) {
      const entry = { id: uid('note'), ts: nowIso(), read: false, actions: [], deviceId: state.activeDeviceId, ...notification };
      state.notifications.unshift(entry);
      state.notifications = state.notifications.slice(0, 100);
      runtime.emit('notification.received', entry);
      runtime.persist();
      return entry;
    },

    addCall(call) {
      const entry = { id: uid('call'), startedAt: nowIso(), ...call };
      state.calls.unshift(entry);
      runtime.emit('calls.changed', entry);
      return entry;
    },
  };

  function stopTelemetry() {
    if (telemetryTimer) clearInterval(telemetryTimer);
    telemetryTimer = null;
  }

  return runtime;
}
