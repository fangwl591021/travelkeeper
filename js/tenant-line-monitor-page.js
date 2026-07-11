(function (global) {
  'use strict';
  const page = global.TravelKeeperTenantPage;
  const api = global.TravelKeeperTenantLine;
  if (!page || !api) throw new Error('Tenant page and LINE clients are required');

  const params = new URLSearchParams(location.search);
  const state = { threads: [], active: null, status: 'all', view: 'all', search: '', role: '', userUid: '', openSeq: 0, sending: new Map() };
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = value => value ? new Date(value).toLocaleString('zh-TW') : '';
  const keepQuery = () => {
    const q = new URLSearchParams();
    ['tenant', 'worker', 'dev_uid'].forEach(key => { if (params.get(key)) q.set(key, params.get(key)); });
    return q.toString();
  };
  const clientRequestId = () => `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  function activeThreadId() { return state.active?.id || ''; }
  function isSending(threadId = activeThreadId()) { return !!threadId && state.sending.has(threadId); }
  function isAdmin() { return ['platform_admin', 'tenant_admin'].includes(state.role); }
  function isAgent() { return ['sales', 'editor'].includes(state.role); }
  function canOperateThread(thread = state.active) {
    return !!thread && (isAdmin() || thread.owner_uid === state.userUid || thread.assigned_to_uid === state.userUid);
  }
  function canClaimThread(thread = state.active) {
    return !!thread && isAgent() && !thread.assigned_to_uid && thread.queue_status !== 'closed';
  }

  function renderThreads() {
    const box = el('thread-list');
    box.innerHTML = '';
    if (!state.threads.length) {
      box.innerHTML = '<div class="empty-card">目前沒有符合條件的聊天室。</div>';
      return;
    }
    state.threads.forEach(thread => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `thread-card ${state.active?.id === thread.id ? 'active' : ''}`;
      button.innerHTML = `
        <div class="thread-head"><strong>${esc(thread.display_name || thread.line_user_uid || '未命名客戶')}</strong><small>${esc(fmt(thread.last_message_at))}</small></div>
        <p>${esc(thread.last_message || '尚無訊息')}</p>
        <div class="pills"><span>${esc(thread.queue_status || thread.status)}</span><span>${esc(thread.risk)}</span><span>${thread.message_count} 則</span><span>未讀 ${Number(thread.unread_count || 0)}</span><span>${thread.assigned_to_uid ? `客服 ${esc(thread.assigned_to_uid)}` : '未指派'}</span></div>`;
      button.addEventListener('click', () => openThread(thread.id));
      box.appendChild(button);
    });
  }

  function updateComposer(enabled, statusText = '') {
    const composer = el('composer');
    const threadId = activeThreadId();
    const sending = isSending(threadId);
    composer.classList.toggle('hidden', !enabled);
    el('reply-text').disabled = !enabled || sending;
    el('send-message').disabled = !enabled || sending || !el('reply-text').value.trim();
    el('reply-status').textContent = statusText || (sending ? '送出中...' : (enabled ? '可送出人工客服回覆。' : '請先選擇聊天室。'));
  }

  function updateAssignmentControls() {
    const thread = state.active;
    const operating = canOperateThread(thread);
    const admin = isAdmin();
    const claimable = canClaimThread(thread);
    el('assignment-status').textContent = thread
      ? `狀態 ${thread.queue_status || thread.status || 'open'}｜未讀 ${Number(thread.unread_count || 0)}｜客服 ${thread.assigned_to_uid || '未指派'}｜owner ${thread.owner_uid || '未設定'}`
      : '尚未選擇聊天室。';
    el('assignee-uid').disabled = !admin || !thread;
    el('assignee-uid').value = thread?.assigned_to_uid || '';
    el('assign-thread').disabled = !admin || !thread;
    el('unassign-thread').disabled = !admin || !thread || !thread.assigned_to_uid;
    el('claim-thread').disabled = !claimable;
    el('mark-read').disabled = !operating || !thread || Number(thread.unread_count || 0) <= 0;
    el('save').disabled = !operating;
    updateComposer(operating);
  }

  function messageMeta(message) {
    const parts = [message.message_type || message.event_type, fmt(message.sent_at || message.created_at || message.event_timestamp)];
    if (message.direction === 'outbound' && message.send_status) parts.push(message.send_status);
    if (message.sent_by_role) parts.push(message.sent_by_role);
    if (message.retryable) parts.push('可重試');
    return parts.filter(Boolean).join('｜');
  }

  function renderThread(data) {
    state.active = data.thread;
    renderThreads();
    el('chat-name').textContent = data.thread.display_name || data.thread.line_user_uid || '未命名客戶';
    el('chat-meta').textContent = [data.thread.line_user_uid, data.thread.phone, data.thread.owner_uid ? `負責人 ${data.thread.owner_uid}` : ''].filter(Boolean).join('｜');
    el('status').value = data.thread.status || 'open';
    el('risk').value = data.thread.risk || 'low';
    el('summary').value = data.thread.summary || '';
    el('note').value = data.thread.note || '';
    el('tags').value = (data.thread.tags || []).join(', ');
    updateAssignmentControls();

    const box = el('messages');
    box.innerHTML = '';
    if (!data.messages.length) {
      box.innerHTML = '<div class="empty-card">尚無訊息。</div>';
      return;
    }
    data.messages.forEach(message => {
      const row = document.createElement('div');
      row.className = `message-row ${message.direction === 'outbound' ? 'outbound' : ''}`;
      const statusClass = message.direction === 'outbound' && message.send_status ? ` status-${message.send_status}` : '';
      row.innerHTML = `<div class="message-bubble${statusClass}"><p>${esc(message.content || message.text_content || `[${message.event_type || message.message_type || 'event'}]`)}</p><small>${esc(messageMeta(message))}${message.error_message_safe ? `｜${esc(message.error_message_safe)}` : ''}</small></div>`;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function loadThreads() {
    try {
      const filters = { status: state.status, search: state.search, limit: 200 };
      if (state.view === 'mine') filters.mine = 'true';
      if (state.view === 'unassigned') filters.unassigned = 'true';
      if (state.view === 'unread') filters.unread_only = 'true';
      const result = await api.listThreads(filters);
      state.threads = result.data || [];
      renderThreads();
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
    }
  }

  async function openThread(id) {
    const seq = ++state.openSeq;
    updateComposer(false, '讀取中...');
    try {
      const result = await api.getThreadMessages(id);
      if (seq !== state.openSeq) return;
      renderThread(result.data);
      const thread = result.data.thread;
      if (activeThreadId() === id && canOperateThread(thread) && Number(thread.unread_count || 0) > 0) {
        const readResult = await api.markThreadRead(id);
        if (activeThreadId() === id) {
          state.active = { ...state.active, ...readResult.data.thread };
          state.threads = state.threads.map(item => item.id === id ? { ...item, unread_count: 0 } : item);
          renderThreads();
          updateAssignmentControls();
        }
      }
    } catch (error) {
      if (seq !== state.openSeq) return;
      state.active = null;
      renderThreads();
      el('chat-name').textContent = '無法開啟聊天室';
      el('chat-meta').textContent = '請確認權限或聊天室是否存在。';
      el('messages').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
      el('save').disabled = true;
      updateAssignmentControls();
      updateComposer(false, '無法在目前聊天室送出訊息。');
    }
  }

  async function saveThread() {
    if (!state.active || !canOperateThread()) return;
    el('save').disabled = true;
    el('save-status').textContent = '儲存中...';
    try {
      const result = await api.updateThread(state.active.id, {
        status: el('status').value,
        queue_status: el('status').value,
        risk: el('risk').value,
        summary: el('summary').value,
        note: el('note').value,
        tags: el('tags').value.split(',').map(item => item.trim()).filter(Boolean),
      });
      renderThread(result.data);
      el('save-status').textContent = '已儲存';
      await loadThreads();
    } catch (error) {
      el('save-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    } finally {
      updateAssignmentControls();
    }
  }

  async function assignThread(value) {
    if (!state.active || !isAdmin()) return;
    el('assignment-status').textContent = '指派中...';
    try {
      const result = await api.assignThread(state.active.id, { assigned_to_uid: value });
      state.active = { ...state.active, ...result.data.thread };
      el('assignment-status').textContent = value ? '已指派' : '已解除指派';
      await loadThreads();
      updateAssignmentControls();
    } catch (error) {
      el('assignment-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    }
  }

  async function claimThread() {
    if (!state.active || !canClaimThread()) return;
    el('assignment-status').textContent = '接手中...';
    try {
      const result = await api.claimThread(state.active.id);
      state.active = { ...state.active, ...result.data.thread };
      el('assignment-status').textContent = '已接手';
      await loadThreads();
      updateAssignmentControls();
    } catch (error) {
      el('assignment-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    }
  }

  async function markRead() {
    if (!state.active || !canOperateThread()) return;
    const threadId = activeThreadId();
    try {
      const result = await api.markThreadRead(threadId);
      if (activeThreadId() !== threadId) return;
      state.active = { ...state.active, ...result.data.thread };
      state.threads = state.threads.map(item => item.id === threadId ? { ...item, unread_count: 0 } : item);
      renderThreads();
      updateAssignmentControls();
    } catch (error) {
      el('assignment-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    }
  }
  async function sendMessage() {
    const threadId = activeThreadId();
    if (!threadId || isSending(threadId) || el('send-message').disabled) return;
    const messageText = el('reply-text').value.trim();
    if (!messageText) { updateComposer(true); return; }
    const requestId = clientRequestId();
    state.sending.set(threadId, requestId);
    updateComposer(true, '送出中...');
    try {
      const result = await api.sendThreadMessage(threadId, {
        type: 'text',
        text: messageText,
        client_request_id: requestId,
      });
      state.sending.delete(threadId);
      if (activeThreadId() === threadId) {
        el('reply-text').value = '';
        el('reply-status').textContent = result.duplicate ? '已忽略重複送出。' : '已送出。';
        await openThread(threadId);
      }
    } catch (error) {
      state.sending.delete(threadId);
      if (activeThreadId() === threadId) {
        const message = page.friendlyError ? page.friendlyError(error) : error.message;
        el('reply-status').textContent = message;
        if (error.payload?.data?.message) await openThread(threadId);
        updateComposer(true, message);
      }
    }
  }

  async function init() {
    try {
      const session = await page.initLiffSession({ fallbackLiffId: '2009367829-BDZCGti8', requireContext: true });
      state.role = session.context?.role || '';
      state.userUid = session.context?.userUid || session.profile?.userId || params.get('dev_uid') || '';
      el('tenant-label').textContent = '租戶 ' + page.tenantSlug + '｜角色 ' + state.role;
      const query = keepQuery();
      el('settings-link').href = `line-channel-settings.html?${query}`;
      el('crm-link').href = `crm.html?${query}`;
      el('dashboard-link').href = `dashboard.html?${query}`;
      updateComposer(false);
      await loadThreads();
      if (params.get('thread')) await openThread(params.get('thread'));
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
      updateComposer(false, '無法載入聊天室。');
    }
  }

  let searchTimer;
  el('search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    state.search = event.target.value;
    searchTimer = setTimeout(loadThreads, 250);
  });
  el('reply-text').addEventListener('input', () => updateComposer(canOperateThread()));
  el('reply-text').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active-filter', item === button));
      loadThreads();
    });
  });
  document.querySelectorAll('[data-status]').forEach(button => {
    button.addEventListener('click', () => {
      state.status = button.dataset.status;
      document.querySelectorAll('[data-status]').forEach(item => item.classList.toggle('active-filter', item === button));
      loadThreads();
    });
  });
  el('send-message').addEventListener('click', sendMessage);
  el('save').addEventListener('click', saveThread);
  el('assign-thread').addEventListener('click', () => assignThread(el('assignee-uid').value.trim()));
  el('unassign-thread').addEventListener('click', () => assignThread(null));
  el('claim-thread').addEventListener('click', claimThread);
  el('mark-read').addEventListener('click', markRead);
  init();
})(window);
