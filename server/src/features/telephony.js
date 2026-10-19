/**
 * Calls, SMS/MMS/RCS and contacts — the Phone Link parity layer.
 *
 * The bridge is transport agnostic: a companion app on the phone streams new
 * messages/calls over WebSocket, and the desktop console can send messages and
 * place calls through this module. In demo mode the same contract is served
 * from local state so every UI path is exercise-able.
 */
import { badRequest, notFound, nowIso, uid } from '../util.js';

const normalize = (number) => String(number || '').replace(/[^\d+]/g, '');

export function initTelephony(runtime) {
  const { state, bus } = runtime;

  const findConversation = ({ conversationId, number }) => {
    if (conversationId) {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) throw notFound('conversation not found');
      return conversation;
    }
    const clean = normalize(number);
    const contact = state.contacts.find((item) => normalize(item.number) === clean);
    const existing = state.conversations.find(
      (item) => normalize(item.number) === clean || (contact && item.name === contact.name),
    );
    if (existing) return existing;
    if (!clean) throw badRequest('conversationId or number is required');
    const conversation = {
      id: uid('conv'), name: contact?.name || clean, number: clean,
      avatarColor: contact?.avatarColor || '#6b7280', company: contact?.company || '',
      unread: 0, rcs: false, pinned: false, muted: false, messages: [],
    };
    state.conversations.unshift(conversation);
    return conversation;
  };

  const appendMessage = (conversation, message) => {
    const entry = { id: uid('m'), ts: nowIso(), status: 'sending', kind: 'sms', ...message };
    conversation.messages.push(entry);
    runtime.persist();
    runtime.emit('telephony.message', { conversationId: conversation.id, message: entry });
    return entry;
  };

  // Companion announcements
  bus.on('android.message', (payload) => {
    const conversation = findConversation({ number: payload.number, conversationId: payload.conversationId });
    const message = appendMessage(conversation, { ...payload, from: 'them', status: 'received' });
    conversation.unread += 1;
    runtime.addNotification({
      app: 'Messages', icon: 'message-square', color: '#3ddc84',
      title: conversation.name, body: message.text,
      actions: [{ id: 'reply', label: 'Reply', reply: true }, { id: 'mark_read', label: 'Mark read' }],
      conversationId: conversation.id,
    });
    runtime.persist();
  });

  bus.on('android.call', (payload) => {
    const contact = state.contacts.find((item) => normalize(item.number) === normalize(payload.number));
    const call = runtime.addCall({
      number: payload.number, name: contact?.name || payload.name || payload.number,
      direction: 'incoming', status: 'ringing', video: Boolean(payload.video),
    });
    runtime.emit('calls.incoming', call);
    runtime.addNotification({
      app: 'Phone', icon: 'phone-call', color: '#34a853', title: call.name,
      body: call.video ? 'Incoming video call' : 'Incoming call',
      actions: [{ id: 'answer', label: 'Answer' }, { id: 'decline', label: 'Decline' }],
      callId: call.id,
    });
  });

  return {
    conversations() {
      return [...state.conversations].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const aTs = a.messages.at(-1)?.ts || '';
        const bTs = b.messages.at(-1)?.ts || '';
        return bTs.localeCompare(aTs);
      });
    },

    conversation(id) {
      const conversation = state.conversations.find((item) => item.id === id);
      if (!conversation) throw notFound('conversation not found');
      conversation.unread = 0;
      runtime.emit('telephony.read', { conversationId: id });
      runtime.persist();
      return conversation;
    },

    contacts() {
      return state.contacts;
    },

    lookup(number) {
      const clean = normalize(number);
      return state.contacts.find((contact) => normalize(contact.number) === clean) || null;
    },

    send({ conversationId, number, text, media, kind = 'sms' }) {
      if (!text && !media) throw badRequest('text or media is required');
      const conversation = findConversation({ conversationId, number });
      const message = appendMessage(conversation, {
        from: 'me', text: text || 'Photo', media,
        kind: media ? 'mms' : kind,
      });
      conversation.unread = 0;
      runtime.audit('telephony.sent', `${conversation.name}: ${text?.slice(0, 60) || 'media'}`, 'privacy');
      // adb shell am service call com.android.mms ... (or companion RPC) happens here.
      setTimeout(() => {
        message.status = 'delivered';
        runtime.emit('telephony.status', { conversationId: conversation.id, messageId: message.id, status: 'delivered' });
        runtime.persist();
      }, 450);
      return { conversationId: conversation.id, message };
    },

    setTyping(conversationId, typing) {
      runtime.emit('telephony.typing', { conversationId, typing: Boolean(typing), direction: 'desktop' });
      return { ok: true };
    },

    calls() {
      return state.calls;
    },

    call({ number, contactId, video = false }) {
      const contact = contactId ? state.contacts.find((item) => item.id === contactId) : this.lookup(number);
      if (!contact && !number) throw badRequest('number or contactId is required');
      const active = state.calls.find((call) => ['dialing', 'ringing', 'active'].includes(call.status));
      if (active) throw badRequest('a call is already in progress', { callId: active.id });
      const call = runtime.addCall({
        number: contact?.number || normalize(number),
        name: contact?.name || number,
        direction: 'outgoing', status: 'dialing', video: Boolean(video),
      });
      runtime.emit('calls.outgoing', call);
      setTimeout(() => {
        if (call.status === 'dialing') {
          call.status = 'active';
          call.answeredAt = nowIso();
          runtime.emit('calls.active', call);
        }
      }, 1800);
      return call;
    },

    answer(callId) {
      const call = state.calls.find((item) => item.id === callId);
      if (!call) throw notFound('call not found');
      call.status = 'active';
      call.answeredAt = nowIso();
      runtime.emit('calls.active', call);
      runtime.audit('calls.answered', call.name, 'privacy');
      return call;
    },

    hangup(callId) {
      const call = state.calls.find((item) => item.id === callId);
      if (!call) throw notFound('call not found');
      call.status = call.status === 'ringing' ? 'declined' : 'ended';
      call.endedAt = nowIso();
      call.duration = call.answeredAt ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000) : 0;
      runtime.emit('calls.ended', call);
      runtime.audit('calls.ended', `${call.name} · ${call.duration}s`, 'privacy');
      return call;
    },

    dtmf(callId, digits) {
      const call = state.calls.find((item) => item.id === callId);
      if (!call) throw notFound('call not found');
      if (call.status !== 'active') throw badRequest('call is not active');
      call.dtmf = (call.dtmf || '') + String(digits).replace(/[^0-9*#]/g, '');
      runtime.emit('calls.dtmf', { callId, digits });
      return { ok: true, dtmf: call.dtmf };
    },

    toggleMute(callId, muted) {
      const call = state.calls.find((item) => item.id === callId);
      if (!call) throw notFound('call not found');
      call.muted = Boolean(muted);
      runtime.emit('calls.mute', { callId, muted: call.muted });
      return call;
    },
  };
}
