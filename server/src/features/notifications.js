/**
 * Notification mirroring with inline reply, quick actions, DND sync and
 * optional forwarding into the host OS notification centre.
 */
import { execFile } from 'node:child_process';
import { badRequest, notFound } from '../util.js';

function hostNotifier() {
  if (process.platform === 'linux') return { cmd: 'notify-send', args: (title, body) => ['-a', 'Android DEX', title, body] };
  if (process.platform === 'darwin') {
    return { cmd: 'osascript', args: (title, body) => ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`] };
  }
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell',
      args: (title, body) => ['-NoProfile', '-Command',
        `New-BurntToastNotification -Text '${title.replace(/'/g, "''")}','${body.replace(/'/g, "''")}'`],
    };
  }
  return null;
}

export function initNotifications(runtime) {
  const { state } = runtime;

  const mirror = (notification) => {
    if (!state.settings.mirrorToOsNotificationCenter) return false;
    const notifier = hostNotifier();
    if (!notifier) return false;
    // Best effort: a missing notification daemon must never fail a notification.
    try {
      const child = execFile(notifier.cmd, notifier.args(notification.title, notification.body), { timeout: 4000 });
      child.on('error', () => {});
      return true;
    } catch {
      return false;
    }
  };

  return {
    list({ unreadOnly = false } = {}) {
      return unreadOnly ? state.notifications.filter((item) => !item.read) : state.notifications;
    },

    markRead(id) {
      const notification = state.notifications.find((item) => item.id === id);
      if (!notification) throw notFound('notification not found');
      notification.read = true;
      runtime.emit('notification.updated', notification);
      runtime.persist();
      return notification;
    },

    markAllRead() {
      state.notifications.forEach((item) => { item.read = true; });
      runtime.emit('notifications.read-all', {});
      runtime.persist();
      return { ok: true };
    },

    dismiss(id) {
      const index = state.notifications.findIndex((item) => item.id === id);
      if (index === -1) throw notFound('notification not found');
      const [removed] = state.notifications.splice(index, 1);
      runtime.emit('notification.dismissed', { id });
      runtime.persist();
      return removed;
    },

    clear() {
      state.notifications = [];
      runtime.emit('notifications.cleared', {});
      runtime.persist();
      return { ok: true };
    },

    /**
     * Execute an inline action. `reply` actions carry text and are routed into
     * the right conversation (creating one when needed).
     */
    async action(id, actionId, payload = {}, telephony) {
      const notification = state.notifications.find((item) => item.id === id);
      if (!notification) throw notFound('notification not found');
      const action = notification.actions.find((item) => item.id === actionId);
      if (!action) throw badRequest(`unknown action "${actionId}"`);

      if (action.reply) {
        if (!state.settings.replyFromNotifications) throw badRequest('inline replies are disabled in settings');
        const text = String(payload.text || '').trim();
        if (!text) throw badRequest('reply text is required');
        if (text.length > 2000) throw badRequest('reply exceeds 2000 characters');
        const result = telephony.send({
          conversationId: notification.conversationId,
          number: notification.number,
          text,
        });
        notification.read = true;
        notification.repliedAt = new Date().toISOString();
        notification.repliedText = text;
        runtime.emit('notification.replied', { notification, ...result });
        runtime.audit('notification.replied', notification.title, 'privacy');
        runtime.persist();
        return { ok: true, conversationId: result.conversationId, message: result.message };
      }

      if (actionId === 'answer' && notification.callId) {
        return telephony.answer(notification.callId);
      }
      if (actionId === 'decline' && notification.callId) {
        return telephony.hangup(notification.callId);
      }
      if (actionId === 'mark_read') {
        return this.markRead(id);
      }
      if (actionId === 'snooze') {
        notification.snoozedUntil = new Date(Date.now() + (payload.minutes || 10) * 60_000).toISOString();
        notification.read = true;
        runtime.emit('notification.snoozed', { id, until: notification.snoozedUntil });
        runtime.persist();
        return notification;
      }

      notification.read = true;
      runtime.emit('notification.action', { id, actionId, payload });
      runtime.persist();
      return { ok: true, action: actionId };
    },

    setDnd(enabled) {
      runtime.patchSettings({ dnd: Boolean(enabled) });
      runtime.audit('dnd.changed', enabled ? 'enabled' : 'disabled');
      return { dnd: state.settings.dnd };
    },

    /** Simulates the Android listener delivering a notification. */
    pushFromAndroid({ app = 'Messages', title, body, actions = [], conversationId } = {}) {
      const notification = runtime.addNotification({ app, title: title || app, body: body || '', actions, conversationId, icon: 'bell', color: '#8ab4f8' });
      notification.mirroredToOs = mirror(notification);
      runtime.persist();
      return notification;
    },

    mirrorStatus() {
      const notifier = hostNotifier();
      return {
        enabled: state.settings.mirrorToOsNotificationCenter,
        platform: process.platform,
        backend: notifier?.cmd || null,
        available: Boolean(notifier),
      };
    },
  };
}
