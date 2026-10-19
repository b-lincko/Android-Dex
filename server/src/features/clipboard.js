/**
 * Clipboard sync (text + images), history, pinning and explicit copy-to-device.
 */
import { badRequest, notFound, uid } from '../util.js';

export function initClipboard(runtime) {
  const { bus, state } = runtime;

  // Android side announces a new clip
  bus.on('android.clipboard', (payload) => {
    if (!state.settings.clipboardSync) return;
    if (payload.kind === 'image' && !state.settings.clipboardImages) return;
    runtime.addClipboard({ kind: payload.kind || 'text', text: payload.text, dataUrl: payload.dataUrl, source: 'android', size: payload.size });
  });

  return {
    list() {
      return runtime.visibleClipboard();
    },

    add(payload) {
      if (!state.settings.clipboardSync) throw badRequest('clipboard sync is disabled in settings');
      const kind = payload.kind === 'image' ? 'image' : 'text';
      if (kind === 'text') {
        if (typeof payload.text !== 'string' || !payload.text.trim()) throw badRequest('text is required');
        if (payload.text.length > 256_000) throw badRequest('clipboard text exceeds 256 KB');
      } else {
        if (payload.dataUrl && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(payload.dataUrl)) {
          throw badRequest('image must be a data URL of type png, jpeg, webp or gif');
        }
        if (payload.dataUrl && payload.dataUrl.length > 6_000_000) throw badRequest('image exceeds 4.5 MB');
      }
      return runtime.addClipboard({
        kind,
        text: payload.text || 'Image',
        dataUrl: payload.dataUrl,
        source: payload.source === 'android' ? 'android' : 'desktop',
        width: payload.width,
        height: payload.height,
        size: payload.size,
      });
    },

    copy(id, target = 'device') {
      const item = state.clipboard.find((entry) => entry.id === id);
      if (!item) throw notFound('clipboard item not found');
      item.lastCopiedAt = new Date().toISOString();
      // The bridge announces the clip; the companion service writes it into the
      // Android clipboard, or the desktop client writes it to the host clipboard.
      runtime.emit(target === 'host' ? 'host.clipboard.write' : 'android.clipboard.write', {
        id: item.id, kind: item.kind, text: item.text, dataUrl: item.dataUrl,
      });
      runtime.audit('clipboard.copied', `${item.kind} → ${target}`, 'privacy');
      runtime.persist();
      return { ok: true, id, target };
    },

    pin(id) {
      const item = state.clipboard.find((entry) => entry.id === id);
      if (!item) throw notFound('clipboard item not found');
      item.pinned = !item.pinned;
      runtime.persist();
      return item;
    },

    remove(id) {
      const index = state.clipboard.findIndex((entry) => entry.id === id);
      if (index === -1) throw notFound('clipboard item not found');
      const [removed] = state.clipboard.splice(index, 1);
      runtime.emit('clipboard.removed', { id });
      runtime.persist();
      return removed;
    },

    clear({ keepPinned = true } = {}) {
      const before = state.clipboard.length;
      state.clipboard = keepPinned ? state.clipboard.filter((item) => item.pinned) : [];
      runtime.emit('clipboard.cleared', { removed: before - state.clipboard.length });
      runtime.persist();
      return { removed: before - state.clipboard.length };
    },

    /** Called by the companion app / OS integration to simulate an inbound clip. */
    simulateInbound({ text, kind = 'text' } = {}) {
      return runtime.addClipboard({
        kind, text: text || `Clip from phone ${new Date().toLocaleTimeString()}`, source: 'android',
        dataUrl: kind === 'image' ? 'placeholder:gradient' : undefined,
        size: kind === 'image' ? 402_120 : undefined,
        id: uid('clip'),
      });
    },
  };
}
