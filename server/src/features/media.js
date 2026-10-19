/**
 * Media, audio routing, mic passthrough, virtual camera, capture and input.
 *
 * Virtual camera contract: the companion (or any WebRTC/MJPEG producer) posts
 * JPEG frames to /api/media/webcam/frame. The bridge fans them out to:
 *   - MJPEG consumers at /api/media/webcam/stream (OBS "Media Source", Zoom
 *     via a virtual camera shim, browsers)
 *   - a v4l2loopback device on Linux when one is configured
 * Recording uses MediaRecorder in the console and uploads the resulting WebM.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, notFound, nowIso, safeJoin, uid } from '../util.js';
import { encodePng, renderVirtualDesktop } from '../png.js';

export function initMedia(runtime, { shareDir }) {
  const { state } = runtime;
  const streamClients = new Set();
  const latestFrame = { buffer: null, ts: null, mime: 'image/jpeg', source: 'none' };

  const activeSession = () => state.media.sessions.find((item) => item.id === state.media.activeSessionId) || state.media.sessions[0];

  const screenshotsDir = path.join(shareDir, 'Screenshots');
  const recordingsDir = path.join(shareDir, 'Recordings');

  return {
    async init() {
      await mkdir(screenshotsDir, { recursive: true });
      await mkdir(recordingsDir, { recursive: true });
      state.media.screenshots = await listCaptures(screenshotsDir, 'image/png');
      state.media.recordings = await listCaptures(recordingsDir, 'video/webm');
      return this;
    },

    sessions() {
      return { sessions: state.media.sessions, activeSessionId: state.media.activeSessionId, volume: state.media.volume, muted: state.media.muted, output: state.media.output };
    },

    control({ action, sessionId, value }) {
      const session = sessionId
        ? state.media.sessions.find((item) => item.id === sessionId)
        : activeSession();
      if (!session) throw notFound('no media session');
      switch (action) {
        case 'play':
          state.media.sessions.forEach((item) => { if (item.id !== session.id) item.playing = false; });
          session.playing = true;
          state.media.activeSessionId = session.id;
          break;
        case 'pause': session.playing = false; break;
        case 'toggle': session.playing = !session.playing; break;
        case 'next':
        case 'previous': {
          const index = state.media.sessions.indexOf(session);
          const next = action === 'next'
            ? state.media.sessions[(index + 1) % state.media.sessions.length]
            : state.media.sessions[(index - 1 + state.media.sessions.length) % state.media.sessions.length];
          state.media.sessions.forEach((item) => { item.playing = false; });
          next.playing = true;
          state.media.activeSessionId = next.id;
          runtime.emit('media.session', next);
          runtime.emit('media.changed', { action, session: next });
          return { session: next };
        }
        case 'seek':
          session.position = Math.max(0, Math.min(Number(value) || 0, session.duration));
          break;
        case 'volume':
          state.media.volume = Math.max(0, Math.min(100, Number(value) || 0));
          state.media.muted = false;
          runtime.emit('media.volume', { volume: state.media.volume });
          break;
        case 'mute':
          state.media.muted = !state.media.muted;
          break;
        default:
          throw badRequest(`unknown media action "${action}"`);
      }
      runtime.emit('media.changed', { action, session, volume: state.media.volume, muted: state.media.muted });
      return { session, volume: state.media.volume, muted: state.media.muted };
    },

    route({ output, volume, muted }) {
      if (output !== undefined) {
        if (!['desktop', 'headphones', 'android', 'hdmi'].includes(output)) throw badRequest('unknown audio output');
        state.media.output = output;
      }
      if (volume !== undefined) state.media.volume = Math.max(0, Math.min(100, Number(volume)));
      if (muted !== undefined) state.media.muted = Boolean(muted);
      runtime.emit('media.routed', { output: state.media.output, volume: state.media.volume, muted: state.media.muted });
      runtime.audit('media.route', state.media.output);
      return { output: state.media.output, volume: state.media.volume, muted: state.media.muted };
    },

    mic({ enabled, gain, muted, device }) {
      if (enabled !== undefined) state.media.micMuted = !enabled;
      if (muted !== undefined) state.media.micMuted = Boolean(muted);
      if (gain !== undefined) state.media.micGain = Math.max(0, Math.min(100, Number(gain)));
      if (device !== undefined) state.settings.hostMicDevice = String(device);
      state.settings.micPassthrough = !state.media.micMuted;
      runtime.patchSettings({ micPassthrough: state.settings.micPassthrough });
      runtime.emit('media.mic', { enabled: !state.media.micMuted, gain: state.media.micGain, device: state.settings.hostMicDevice });
      return { enabled: !state.media.micMuted, gain: state.media.micGain, device: state.settings.hostMicDevice };
    },

    /** Toggle the virtual camera and return the endpoints host apps can use. */
    webcam({ enabled, fps, device } = {}) {
      if (enabled !== undefined) state.media.virtualCamera = Boolean(enabled);
      if (fps !== undefined) state.media.webcamFps = Math.max(1, Math.min(60, Number(fps)));
      state.settings.virtualCamera = state.media.virtualCamera;
      runtime.patchSettings({ virtualCamera: state.media.virtualCamera });
      const loopback = process.env.DEX_V4L2_DEVICE || null;
      const info = {
        enabled: state.media.virtualCamera,
        fps: state.media.webcamFps,
        frames: state.media.webcamFrames,
        streamUrl: '/api/media/webcam/stream',
        stillUrl: '/api/media/webcam/latest',
        ingestUrl: '/api/media/webcam/frame',
        v4l2: { configured: Boolean(loopback), device: loopback },
        usage: {
          obs: 'Add a Media Source and point it at the stream URL (MJPEG).',
          zoom: loopback ? `Select "${loopback}" as the camera (v4l2loopback).` : 'Install v4l2loopback and set DEX_V4L2_DEVICE=/dev/video10.',
          teams: loopback ? `Select "${loopback}" while the bridge is running.` : 'Same as Zoom; the still/stream URLs also work with OBS Virtual Cam.',
        },
        device: device || 'phone-camera',
      };
      runtime.emit('media.webcam', info);
      return info;
    },

    acceptFrame(buffer, { mime = 'image/jpeg' } = {}) {
      if (!buffer?.length) throw badRequest('empty frame');
      if (buffer.length > 8 * 1024 * 1024) throw badRequest('frame exceeds 8 MB');
      if (!/^image\/jpe?g$|^image\/png$/.test(mime)) throw badRequest('frames must be JPEG or PNG');
      latestFrame.buffer = buffer;
      latestFrame.ts = nowIso();
      latestFrame.mime = mime;
      latestFrame.source = 'device';
      state.media.webcamFrames += 1;
      for (const client of streamClients) {
        try {
          client.write(Buffer.concat([
            Buffer.from(`--dexframe\r\nContent-Type: ${mime}\r\nContent-Length: ${buffer.length}\r\n\r\n`),
            buffer,
            Buffer.from('\r\n'),
          ]));
        } catch {
          streamClients.delete(client);
        }
      }
      return { bytes: buffer.length, frames: state.media.webcamFrames, ts: latestFrame.ts };
    },

    latestFrame() {
      return latestFrame;
    },

    addStreamClient(res) {
      res.writeHead(200, {
        'content-type': 'multipart/x-mixed-replace; boundary=dexframe',
        'cache-control': 'no-store',
        connection: 'close',
      });
      const fallback = renderVirtualDesktop({ width: 640, height: 360 });
      res.write(Buffer.concat([
        Buffer.from(`--dexframe\r\nContent-Type: image/png\r\nContent-Length: ${fallback.length}\r\n\r\n`),
        fallback,
        Buffer.from('\r\n'),
      ]));
      streamClients.add(res);
      res.on('close', () => streamClients.delete(res));
    },

    async screenshot({ label } = {}) {
      const active = state.windows.filter((win) => !win.minimized).sort((a, b) => a.z - b.z);
      const png = renderVirtualDesktop({
        width: 1280, height: 800,
        windows: active.map((win) => ({
          x: win.x / 2560, y: win.y / 1600, w: win.w / 2560, h: win.h / 1600,
          color: hexToRgb(win.color),
        })),
      });
      const stamp = nowIso().replace(/[:.]/g, '-');
      const name = `${label ? label.replace(/[^\w-]+/g, '_') + '_' : ''}${stamp}.png`;
      await writeFile(path.join(screenshotsDir, name), png);
      const shot = { id: uid('shot'), name, path: `Screenshots/${name}`, size: png.length, ts: nowIso(), width: 1280, height: 800, url: `/api/files/download?path=${encodeURIComponent(`Screenshots/${name}`)}` };
      state.media.screenshots.unshift(shot);
      state.media.screenshots = state.media.screenshots.slice(0, 100);
      runtime.emit('capture.screenshot', shot);
      runtime.audit('capture.screenshot', name, 'privacy');
      return shot;
    },

    startRecording({ mode = 'screen', fps = 30 } = {}) {
      if (state.media.recording.active) throw badRequest('a recording is already running');
      const id = uid('rec');
      state.media.recording = { id, active: true, startedAt: nowIso(), frames: 0, target: 'video/webm', mode, fps };
      runtime.emit('capture.recording-started', state.media.recording);
      runtime.audit('capture.record-start', mode, 'privacy');
      return state.media.recording;
    },

    async stopRecording({ mime = 'video/webm', buffer = null } = {}) {
      if (!state.media.recording.active) throw badRequest('no recording is running');
      const recording = state.media.recording;
      const name = `recording-${recording.startedAt.replace(/[:.]/g, '-')}.webm`;
      let size = 0;
      if (buffer?.length) {
        if (buffer.length > 512 * 1024 * 1024) throw badRequest('recording exceeds 512 MB');
        await writeFile(path.join(recordingsDir, name), buffer);
        size = buffer.length;
      } else {
        await writeFile(path.join(recordingsDir, name), Buffer.alloc(0));
      }
      const entry = {
        id: recording.id, name, path: `Recordings/${name}`, size, ts: nowIso(),
        durationSec: Math.round((Date.now() - new Date(recording.startedAt).getTime()) / 1000),
        mime, frames: recording.frames,
        url: `/api/files/download?path=${encodeURIComponent(`Recordings/${name}`)}`,
      };
      state.media.recordings.unshift(entry);
      state.media.recording = { active: false, startedAt: null, frames: 0, target: 'video/webm' };
      runtime.emit('capture.recording-stopped', entry);
      runtime.audit('capture.record-stop', `${entry.durationSec}s`, 'privacy');
      return entry;
    },

    screenshots() { return state.media.screenshots; },
    recordings() { return state.media.recordings; },

    gamepad(payload) {
      const { connected = true, id = 'Xbox Wireless Controller', axes = [], buttons = 0, pressed = [] } = payload || {};
      state.input.gamepad = {
        connected,
        id,
        axes: axes.map((value) => Math.max(-1, Math.min(1, Number(value) || 0))).slice(0, 8),
        buttons: Number(buttons) || 0,
        pressed: Array.isArray(pressed) ? pressed.slice(0, 32) : [],
        lastAt: nowIso(),
        passthrough: Boolean(state.settings.gamepadPassthrough),
      };
      runtime.emit('input.gamepad', state.input.gamepad);
      return state.input.gamepad;
    },

    stylus({ pressure = 0, tiltX = 0, tiltY = 0, active = true } = {}) {
      state.input.stylus = {
        pressure: Math.max(0, Math.min(1, Number(pressure) || 0)),
        tiltX: Math.max(-90, Math.min(90, Number(tiltX) || 0)),
        tiltY: Math.max(-90, Math.min(90, Number(tiltY) || 0)),
        active: Boolean(active),
        lastAt: nowIso(),
        strokes: (state.input.stylus?.strokes || 0) + (active ? 0 : 1),
      };
      if (!state.settings.stylusPressure) state.input.stylus.pressure = 0.5;
      runtime.emit('input.stylus', state.input.stylus);
      return state.input.stylus;
    },
  };
}

function hexToRgb(hex = '#888888') {
  const clean = hex.replace('#', '');
  const value = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

async function listCaptures(dir, mime) {
  try {
    const files = (await readdir(dir)).filter((name) => !name.startsWith('.')).slice(-100).reverse();
    const entries = [];
    for (const name of files) {
      const info = await stat(path.join(dir, name));
      entries.push({
        id: 'cap_' + Buffer.from(name).toString('base64url').slice(0, 16),
        name, path: `${path.basename(dir)}/${name}`, size: info.size, ts: info.mtime.toISOString(),
        mime, url: `/api/files/download?path=${encodeURIComponent(`${path.basename(dir)}/${name}`)}`,
      });
    }
    return entries;
  } catch {
    return [];
  }
}
