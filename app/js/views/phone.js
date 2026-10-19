import {
  copyText, el, esc, fmtBytes, fmtDuration, fmtRelative, fmtTime, icon, openModal, promptDialog, toast,
} from '../core.js';
import { t } from '../i18n.js';
import { act, avatar, button, card, emptyState, pageHead, refreshNote, tabs } from './shared.js';

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', ''],
];

export function renderPhone(ctx) {
  const state = ctx.state;
  const tab = ctx.viewState.phoneTab || 'messages';
  const page = el('div', { class: 'page' });
  const activeCall = state.calls.find((call) => ['dialing', 'ringing', 'active'].includes(call.status));

  page.append(pageHead({
    kicker: 'Telephony',
    title: t('phone.title'),
    subtitle: t('phone.sub'),
    actions: [
      refreshNote(ctx),
      button(t('phone.newMessage'), { iconName: 'plus', className: 'btn btn-sm', onClick: () => newMessage(ctx) }),
      activeCall ? button('Active call', { iconName: 'phone-call', className: 'btn btn-primary btn-sm', onClick: () => ctx.setViewState({ phoneTab: 'calls' }) || ctx.rerender() }) : null,
    ].filter(Boolean),
  }));

  if (activeCall) page.append(activeCallCard(ctx, activeCall));
  page.append(tabs([['messages', t('phone.messages')], ['calls', t('phone.calls')], ['contacts', t('phone.contacts')]], tab, (next) => {
    ctx.setViewState({ phoneTab: next }); ctx.rerender();
  }));

  if (tab === 'messages') page.append(renderMessages(ctx));
  else if (tab === 'calls') page.append(renderCalls(ctx));
  else page.append(renderContacts(ctx));
  return page;
}

function renderMessages(ctx) {
  const state = ctx.state;
  const conversations = [...state.conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.messages.at(-1)?.ts || '').localeCompare(a.messages.at(-1)?.ts || '');
  });
  const selectedId = ctx.viewState.conversationId || conversations[0]?.id;
  const conversation = conversations.find((item) => item.id === selectedId) || conversations[0];
  const layout = el('div', { class: 'phone-layout' });

  const listCard = card({ body: el('div') });
  const search = el('div', { class: 'search-input' });
  search.innerHTML = icon('search');
  const searchInput = el('input', { class: 'input', placeholder: 'Search conversations', value: ctx.viewState.phoneQuery || '' });
  search.append(searchInput);
  listCard.append(search);
  const list = el('div', { class: 'conv-list' });
  const query = (ctx.viewState.phoneQuery || '').toLowerCase();
  conversations.filter((item) => `${item.name} ${item.number}`.toLowerCase().includes(query)).forEach((item) => {
    const last = item.messages.at(-1);
    const row = el('button', { class: `conv-item ${item.id === conversation?.id ? 'is-active' : ''}`, 'aria-label': `Conversation with ${item.name}` });
    row.append(avatar(item.name, item.avatarColor));
    const body = el('div', { class: 'conv-body' });
    body.innerHTML = `<div class="conv-name">${esc(item.name)} ${item.rcs ? '<span class="pill ok" style="height:16px;padding:0 5px;font-size:.52rem">RCS</span>' : ''}</div>
      <div class="conv-snip">${last ? (last.from === 'me' ? 'You: ' : '') + esc(last.text) : 'No messages'}</div>`;
    row.append(body);
    row.append(el('div', { class: 'conv-time' }, last ? fmtRelative(last.ts) : ''));
    if (item.unread) row.append(el('span', { class: 'conv-unread' }, String(item.unread)));
    row.addEventListener('click', async () => {
      ctx.setViewState({ conversationId: item.id, draft: '', attach: null });
      try { await ctx.api.request(`/api/telephony/conversations/${item.id}`); } catch { /* offline */ }
      await ctx.api.refresh().catch(() => {});
      ctx.rerender();
    });
    list.append(row);
  });
  if (!conversations.length) list.append(emptyState('message-square', 'No conversations'));
  listCard.append(list);
  searchInput.addEventListener('input', () => { ctx.setViewState({ phoneQuery: searchInput.value }); ctx.rerender(); });
  layout.append(listCard);

  const threadCard = card({ body: el('div', { class: 'thread' }) });
  if (conversation) {
    const thread = threadCard.querySelector('.thread');
    const head = el('div', { class: 'thread-head' });
    head.append(avatar(conversation.name, conversation.avatarColor, 38));
    const headBody = el('div', { style: { flex: '1', minWidth: '0' } });
    headBody.innerHTML = `<div style="font-weight:620">${esc(conversation.name)} ${conversation.rcs ? '<span class="pill ok" style="height:17px;font-size:.52rem">RCS</span>' : ''}</div>
      <div class="dim tiny-text">${esc(conversation.number)}${conversation.company ? ` · ${esc(conversation.company)}` : ''}</div>`;
    head.append(headBody);
    head.append(button('', { iconName: 'phone', title: t('phone.call'), className: 'icon-btn', onClick: () => placeCall(ctx, { number: conversation.number, name: conversation.name }) }));
    head.append(button('', { iconName: 'video', title: 'Video call', className: 'icon-btn', onClick: () => placeCall(ctx, { number: conversation.number, name: conversation.name, video: true }) }));
    thread.append(head);

    const scroll = el('div', { class: 'thread-scroll' });
    conversation.messages.forEach((message) => {
      const bubble = el('div', { class: `msg ${message.from === 'me' ? 'me' : 'them'}` });
      bubble.innerHTML = `${message.kind === 'mms' && message.media ? `<div class="msg-media">${icon('image')}<span>${esc(message.media.name)} · ${fmtBytes(message.media.size || 0)}</span></div>` : ''}
        <div>${esc(message.text)}</div>
        <div class="msg-meta">${fmtTime(message.ts)} ${message.from === 'me' ? icon(message.status === 'delivered' || message.status === 'read' ? 'check-check' : 'check') : ''}</div>`;
      scroll.append(bubble);
    });
    thread.append(scroll);
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });

    const composer = el('div', { class: 'composer' });
    const attach = el('button', { class: 'icon-btn', title: t('phone.attach'), 'aria-label': t('phone.attach'), html: icon('paperclip') });
    const fileInput = el('input', { type: 'file', hidden: true });
    attach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      ctx.setViewState({ attach: { name: file.name, size: file.size, mime: file.type } });
      ctx.rerender();
    });
    const textarea = el('textarea', {
      class: 'textarea', placeholder: t('phone.reply'), rows: '1', 'aria-label': 'Message text',
      value: ctx.viewState.draft || '',
    });
    textarea.value = ctx.viewState.draft || '';
    if (ctx.viewState.attach) {
      const chip = el('span', { class: 'pill', style: { flex: '0 0 auto' } }, icon('paperclip'), `${ctx.viewState.attach.name} · ${fmtBytes(ctx.viewState.attach.size)}`);
      chip.addEventListener('click', () => { ctx.setViewState({ attach: null }); ctx.rerender(); });
      composer.append(chip);
    }
    const send = el('button', { class: 'btn btn-primary', 'aria-label': t('phone.send') }, icon('send'));
    const submit = async () => {
      const text = textarea.value.trim();
      if (!text && !ctx.viewState.attach) return;
      try {
        await ctx.api.request('/api/telephony/messages', {
          method: 'POST',
          body: { conversationId: conversation.id, text: text || 'Photo', media: ctx.viewState.attach || undefined },
        });
        textarea.value = '';
        ctx.setViewState({ draft: '', attach: null });
        await ctx.api.refresh().catch(() => {});
        ctx.rerender();
      } catch (error) { ctx.toastError(error); }
    };
    send.addEventListener('click', submit);
    textarea.addEventListener('input', () => {
      ctx.setViewState({ draft: textarea.value });
      ctx.api.request('/api/telephony/typing', { method: 'POST', body: { conversationId: conversation.id, typing: true } }).catch(() => {});
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    });
    composer.append(attach, fileInput, textarea, send);
    thread.append(composer);
  } else {
    threadCard.querySelector('.thread').append(emptyState('message-square', t('phone.selectConversation')));
  }
  layout.append(threadCard);
  return layout;
}

function activeCallCard(ctx, call) {
  const node = el('div', { class: 'card call-card', style: { marginBottom: '14px' } });
  const status = call.status === 'active' ? `${fmtDuration((Date.now() - new Date(call.answeredAt || Date.now()).getTime()) / 1000)}` : call.status;
  node.innerHTML = `<div class="row"><span class="avatar-c" style="background:var(--green);width:42px;height:42px">${icon('phone-call')}</span>
    <div style="flex:1"><div style="font-weight:620">${esc(call.name || call.number)} ${call.video ? '<span class="pill accent">video</span>' : ''}</div>
    <div class="dim tiny-text">${esc(call.number)} · ${esc(status)} ${call.muted ? '· muted' : ''}</div></div>
    <div class="row" data-call-actions></div></div>`;
  const actions = node.querySelector('[data-call-actions]');
  actions.append(button('', { iconName: 'volume-2', className: 'icon-btn', title: 'Speaker', onClick: () => toast('Audio routed to the desktop speaker') }));
  actions.append(button('', {
    iconName: 'mic-off', className: 'icon-btn', title: t('phone.mute'),
    onClick: () => act(ctx, () => ctx.api.request(`/api/telephony/calls/${call.id}/mute`, { method: 'POST', body: { muted: !call.muted } }), { success: call.muted ? 'Unmuted' : 'Muted' }),
  }));
  actions.append(button('', { iconName: 'keyboard', className: 'icon-btn', title: t('phone.dtmf'), onClick: () => dtmfPad(ctx, call) }));
  if (call.status === 'ringing' || call.status === 'dialing') {
    actions.append(button(t('phone.answer'), {
      iconName: 'phone-call', className: 'btn btn-primary',
      onClick: () => act(ctx, () => ctx.api.request(`/api/telephony/calls/${call.id}/answer`, { method: 'POST', body: {} }), { success: 'Call answered' }),
    }));
  }
  actions.append(button(t('phone.hangup'), {
    iconName: 'phone-off', className: 'btn btn-danger',
    onClick: () => act(ctx, () => ctx.api.request(`/api/telephony/calls/${call.id}/hangup`, { method: 'POST', body: {} }), { success: 'Call ended' }),
  }));
  return node;
}

function dtmfPad(ctx, call) {
  const body = el('div');
  const display = el('input', { class: 'input mono-text', readonly: true, value: call.dtmf || '', 'aria-label': 'DTMF digits' });
  const pad = el('div', { class: 'dialer' });
  KEYS.forEach(([digit, letters]) => {
    const key = el('button', { class: 'dial-key' }, el('span', {}, digit), el('small', {}, letters));
    key.addEventListener('click', async () => {
      display.value += digit;
      try { await ctx.api.request(`/api/telephony/calls/${call.id}/dtmf`, { method: 'POST', body: { digits: digit } }); } catch (error) { ctx.toastError(error); }
    });
    pad.append(key);
  });
  body.append(display, pad);
  openModal({ title: 'In-call keypad', subtitle: 'DTMF tones are sent through the phone call.', body, small: true });
}

function renderCalls(ctx) {
  const state = ctx.state;
  const layout = el('div', { class: 'grid cols-2' });
  const log = el('div', { class: 'card' });
  log.innerHTML = `<div class="card-title">${icon('history')}<span>Call log</span></div>`;
  const list = el('div', { style: { marginTop: '8px' } });
  if (!state.calls.length) list.append(emptyState('phone', t('phone.noCalls')));
  state.calls.slice(0, 30).forEach((call) => {
    const row = el('div', { class: 'contact-row' });
    const directionIcon = call.direction === 'incoming' ? 'phone-incoming' : 'phone-outgoing';
    row.innerHTML = `<span class="app-icon" style="width:32px;height:32px;background:var(--card-hi);color:var(--text-2)">${icon(call.direction === 'incoming' ? 'phone-call' : directionIcon)}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:560;font-size:.8rem">${esc(call.name || call.number)}</div>
      <div class="dim tiny-text">${call.direction} · ${fmtRelative(call.startedAt)}${call.duration ? ` · ${fmtDuration(call.duration)}` : ''} · ${esc(call.status)}</div></div>
      <button class="icon-btn" data-call title="Call back" aria-label="Call back">${icon('phone')}</button>`;
    row.querySelector('[data-call]').addEventListener('click', () => placeCall(ctx, { number: call.number, name: call.name }));
    list.append(row);
  });
  log.append(list);
  layout.append(log);

  const dialer = el('div', { class: 'card' });
  dialer.innerHTML = `<div class="card-title">${icon('phone')}<span>${t('phone.dialer')}</span></div>`;
  const number = el('input', { class: 'input mono-text', placeholder: '+49 …', value: ctx.viewState.dialNumber || '', 'aria-label': 'Phone number', style: { marginTop: '10px', textAlign: 'center', fontSize: '1rem' } });
  const pad = el('div', { class: 'dialer' });
  KEYS.forEach(([digit, letters]) => {
    const key = el('button', { class: 'dial-key' });
    key.innerHTML = `<span>${digit}</span><small>${letters}</small>`;
    key.addEventListener('click', () => {
      number.value += digit;
      ctx.setViewState({ dialNumber: number.value });
      ctx.api.request('/api/telephony/typing', { method: 'POST', body: { typing: false } }).catch(() => {});
    });
    pad.append(key);
  });
  const actions = el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } });
  actions.append(button('', {
    iconName: 'delete', className: 'icon-btn', title: 'Backspace', onClick: () => { number.value = number.value.slice(0, -1); ctx.setViewState({ dialNumber: number.value }); },
  }));
  actions.append(button(t('phone.call'), {
    iconName: 'phone-call', className: 'btn btn-primary', onClick: () => { if (number.value.trim()) placeCall(ctx, { number: number.value.trim() }); },
  }));
  dialer.append(number, pad, actions);
  layout.append(dialer);
  return layout;
}

function renderContacts(ctx) {
  const state = ctx.state;
  const cardNode = el('div', { class: 'card' });
  const header = el('div', { class: 'row between', style: { marginBottom: '8px' } });
  header.innerHTML = `<div class="card-title">${icon('users')}<span>${state.contacts.length} contacts</span></div>`;
  const search = el('input', { class: 'input', placeholder: 'Search contacts', style: { maxWidth: '240px' }, value: ctx.viewState.contactQuery || '' });
  header.append(search);
  cardNode.append(header);
  const list = el('div');
  const draw = () => {
    list.innerHTML = '';
    const query = (ctx.viewState.contactQuery || '').toLowerCase();
    state.contacts.filter((contact) => `${contact.name} ${contact.number} ${contact.email}`.toLowerCase().includes(query)).forEach((contact) => {
      const row = el('div', { class: 'contact-row' });
      row.append(avatar(contact.name, contact.avatarColor, 34));
      const body = el('div', { style: { flex: '1', minWidth: '0' } });
      body.innerHTML = `<div style="font-weight:560;font-size:.82rem">${esc(contact.name)} ${contact.favorite ? '★' : ''}</div>
        <div class="dim tiny-text">${esc(contact.number)}${contact.company ? ` · ${esc(contact.company)}` : ''}</div>`;
      row.append(body);
      row.append(button('', { iconName: 'message-square', className: 'icon-btn', title: 'Message', onClick: () => newMessage(ctx, contact.number) }));
      row.append(button('', { iconName: 'phone', className: 'icon-btn', title: 'Call', onClick: () => placeCall(ctx, { number: contact.number, name: contact.name }) }));
      list.append(row);
    });
  };
  draw();
  search.addEventListener('input', () => { ctx.setViewState({ contactQuery: search.value }); draw(); });
  cardNode.append(list);
  return cardNode;
}

async function placeCall(ctx, { number, name, video = false }) {
  try {
    const call = await ctx.api.request('/api/telephony/calls', { method: 'POST', body: { number, video } });
    toast(`Calling ${call.name || number}…`, { type: 'info' });
    ctx.setViewState({ phoneTab: 'calls' });
    await ctx.api.refresh().catch(() => {});
    ctx.rerender();
  } catch (error) { ctx.toastError(error); }
}

async function newMessage(ctx, presetNumber = '') {
  const body = el('div', { class: 'stack' });
  const number = el('input', { class: 'input', placeholder: '+49 151 2345 6789', value: presetNumber, 'aria-label': 'Number' });
  const text = el('textarea', { class: 'textarea', placeholder: 'Message', 'aria-label': 'Message' });
  body.append(el('div', { class: 'field' }, el('label', {}, 'To'), number), el('div', { class: 'field' }, el('label', {}, 'Message'), text));
  const submit = el('button', { class: 'btn btn-primary' }, icon('send'), t('phone.send'));
  const modal = openModal({
    title: t('phone.newMessage'), body, small: true, footer: submit,
    onClose: () => {},
  });
  submit.addEventListener('click', async () => {
    if (!number.value.trim() || !text.value.trim()) { toast('Enter a number and a message', { type: 'warn' }); return; }
    try {
      const result = await ctx.api.request('/api/telephony/messages', { method: 'POST', body: { number: number.value.trim(), text: text.value.trim() } });
      ctx.setViewState({ conversationId: result.conversationId, phoneTab: 'messages' });
      modal.close();
      await ctx.api.refresh().catch(() => {});
      ctx.rerender();
      toast('Message sent');
    } catch (error) { ctx.toastError(error); }
  });
}
