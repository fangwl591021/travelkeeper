(function (global) {
  'use strict';
  const page = global.TravelKeeperTenantPage;
  const api = global.TravelKeeperTenantLine;
  if (!page || !api) throw new Error('Tenant page and LINE clients are required');

  const params = new URLSearchParams(location.search);
  const state = {
    threads: [],
    agents: [],
    active: null,
    status: 'all',
    view: 'all',
    search: '',
    agentSearch: '',
    assigneeFilter: '',
    slaStatus: 'all',
    priorityFilter: 'all',
    waitingOnly: false,
    breachedOnly: false,
    role: '',
    userUid: '',
    openSeq: 0,
    agentSeq: 0,
    sending: new Map(),
    assigning: new Set(),
  };
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
  function isAssigning(threadId = activeThreadId()) { return !!threadId && state.assigning.has(threadId); }
  function isAdmin() { return ['platform_admin', 'tenant_admin'].includes(state.role); }
  function isAgent() { return ['sales', 'editor'].includes(state.role); }
  function roleLabel(role) { return role === 'sales' ? 'Sales' : role === 'editor' ? 'Editor' : role || ''; }
  function canOperateThread(thread = state.active) {
    return !!thread && (isAdmin() || thread.owner_uid === state.userUid || thread.assigned_to_uid === state.userUid);
  }
  function canClaimThread(thread = state.active) {
    return !!thread && isAgent() && !thread.assigned_to_uid && thread.queue_status !== 'closed';
  }
  function agentByUid(uid) { return state.agents.find(agent => agent.uid === uid) || null; }
  function assigneeName(thread = state.active) {
    if (!thread?.assigned_to_uid) return '\u672a\u6307\u6d3e';
    const agent = agentByUid(thread.assigned_to_uid);
    const assignee = thread.assignee || {};
    return agent?.display_name || assignee.display_name || '\u672a\u547d\u540d\u5ba2\u670d';
  }
  function assigneeText(thread = state.active) {
    if (!thread?.assigned_to_uid) return '\u672a\u6307\u6d3e';
    const agent = agentByUid(thread.assigned_to_uid);
    const role = agent?.role || thread.assignee?.role || '';
    return `${assigneeName(thread)}${role ? '\uff5c' + roleLabel(role) : ''}`;
  }
  function agentOptionText(agent) {
    return `${agent.display_name || '\u672a\u547d\u540d\u5ba2\u670d'}\uff5c${roleLabel(agent.role)}\uff5c\u9032\u884c\u4e2d ${Number(agent.active_thread_count || 0)}\uff5c\u672a\u8b80 ${Number(agent.unread_thread_count || 0)}`;
  }
  function durationText(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(value / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${value}s`;
  }
  function slaLabel(thread) {
    const status = thread?.sla_status || 'not_applicable';
    if (status === 'breached') return `Breached ${durationText(thread.overdue_seconds)}`;
    if (status === 'due_soon') return `Due soon ${durationText(thread.remaining_seconds)}`;
    if (status === 'paused') return `Paused ${durationText(thread.remaining_seconds)}`;
    if (status === 'waiting') return `Waiting ${durationText(thread.waiting_seconds)}`;
    return 'No SLA';
  }
  function renderThreads() {
    const box = el('thread-list');
    box.innerHTML = '';
    if (!state.threads.length) {
      box.innerHTML = '<div class="empty-card">No matching threads.</div>';
      return;
    }
    state.threads.forEach(thread => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `thread-card ${state.active?.id === thread.id ? 'active' : ''}`;
      button.innerHTML = `
        <div class="thread-head"><strong>${esc(thread.display_name || thread.line_user_uid || '\u672a\u547d\u540d\u5ba2\u6236')}</strong><small>${esc(fmt(thread.last_message_at))}</small></div>
        <p>${esc(thread.last_message || '\u5c1a\u7121\u8a0a\u606f')}</p>
        <div class="pills"><span>${esc(thread.queue_status || thread.status)}</span><span>${esc(thread.priority || 'normal')}</span><span>${esc(slaLabel(thread))}</span><span>${Number(thread.message_count || 0)} \u5247</span><span>\u672a\u8b80 ${Number(thread.unread_count || 0)}</span><span>${esc(assigneeText(thread))}</span></div>`;
      button.addEventListener('click', () => openThread(thread.id));
      box.appendChild(button);
    });
  }

  function renderAgentFilter() {
    const select = el('assignee-filter');
    if (!select) return;
    select.classList.toggle('hidden', !isAdmin());
    const current = select.value || state.assigneeFilter;
    select.innerHTML = '<option value="">All agents</option><option value="__unassigned">\u672a\u6307\u6d3e</option>' + state.agents.map(agent => `<option value="${esc(agent.uid)}">${esc(agentOptionText(agent))}</option>`).join('');
    select.value = Array.from(select.options).some(option => option.value === current) ? current : '';
  }

  function renderAgentPicker() {
    const adminControls = el('admin-assignment-controls');
    if (adminControls) adminControls.classList.toggle('hidden', !isAdmin());
    const select = el('assignee-picker');
    const status = el('agent-list-status');
    if (!select || !status) return;
    const thread = state.active;
    select.disabled = !isAdmin() || !thread || state.agents.length === 0;
    if (!isAdmin()) {
      select.innerHTML = '<option value="">Admins only</option>';
      status.textContent = '\u76ee\u524d\u89d2\u8272\u4e0d\u53ef\u6307\u6d3e\u5ba2\u670d\u3002';
      return;
    }
    if (!state.agents.length) {
      select.innerHTML = '<option value="">No assignable agents</option>';
      status.textContent = '\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684 sales/editor \u6210\u54e1\u3002';
      return;
    }
    select.innerHTML = '<option value="">Select an agent</option>' + state.agents.map(agent => `<option value="${esc(agent.uid)}">${esc(agentOptionText(agent))}</option>`).join('');
    if (thread?.assigned_to_uid && !agentByUid(thread.assigned_to_uid)) {
      const option = document.createElement('option');
      option.value = thread.assigned_to_uid;
      option.textContent = `${assigneeName(thread)}\uff5ccurrent assignee`;
      select.appendChild(option);
    }
    select.value = thread?.assigned_to_uid || '';
    status.textContent = `\u5df2\u8f09\u5165 ${state.agents.length} \u4f4d\u53ef\u6307\u6d3e\u5ba2\u670d\u3002`;
  }

  function updateComposer(enabled, statusText = '') {
    const composer = el('composer');
    const threadId = activeThreadId();
    const sending = isSending(threadId);
    composer.classList.toggle('hidden', !enabled);
    el('reply-text').disabled = !enabled || sending;
    el('send-message').disabled = !enabled || sending || !el('reply-text').value.trim();
    el('reply-status').textContent = statusText || (sending ? '\u63a5\u624b\u4e2d...' : (enabled ? '\u53ef\u9001\u51fa\u4eba\u5de5\u5ba2\u670d\u56de\u8986\u3002' : '\u5c1a\u672a\u9078\u64c7\u804a\u5929\u5ba4\u3002'));
  }

  function updateAssignmentActions() {
    const thread = state.active;
    const operating = canOperateThread(thread);
    const admin = isAdmin();
    const claimable = canClaimThread(thread);
    const assigning = isAssigning(thread?.id || '');
    el('assign-thread').disabled = assigning || !admin || !thread || !el('assignee-picker')?.value;
    el('unassign-thread').disabled = assigning || !admin || !thread || !thread.assigned_to_uid;
    el('claim-thread').disabled = !claimable;
    el('mark-read').disabled = !operating || !thread || Number(thread.unread_count || 0) <= 0;
    el('save').disabled = !operating;
    updateComposer(operating);
  }

  function updateAssignmentControls() {
    const thread = state.active;
    el('assignment-status').textContent = thread
      ? `\u72c0\u614b ${thread.queue_status || thread.status || 'open'}\uff5c\u672a\u8b80 ${Number(thread.unread_count || 0)}\uff5c\u5ba2\u670d ${assigneeText(thread)}\uff5cowner ${thread.owner_uid || '\u672a\u8a2d\u5b9a'}`
      : '\u5c1a\u672a\u9078\u64c7\u804a\u5929\u5ba4\u3002';
    renderAgentPicker();
    updateAssignmentActions();
  }

  function messageMeta(message) {
    const parts = [message.message_type || message.event_type, fmt(message.sent_at || message.created_at || message.event_timestamp)];
    if (message.direction === 'outbound' && message.send_status) parts.push(message.send_status);
    if (message.sent_by_role) parts.push(message.sent_by_role);
    if (message.retryable) parts.push('\u53ef\u91cd\u8a66');
    return parts.filter(Boolean).join('\uff5c');
  }

  function renderThread(data) {
    state.active = data.thread;
    renderThreads();
    el('chat-name').textContent = data.thread.display_name || data.thread.line_user_uid || 'Unnamed customer';
    el('chat-meta').textContent = [data.thread.line_user_uid, data.thread.phone, data.thread.owner_uid ? 'Owner ' + data.thread.owner_uid : ''].filter(Boolean).join(' | ');
    el('status').value = data.thread.status || 'open';
    el('risk').value = data.thread.risk || 'low';
    el('priority').value = data.thread.priority || 'normal';
    el('sla-summary').innerHTML = `<strong>${esc(slaLabel(data.thread))}</strong><br>Waiting: ${esc(durationText(data.thread.waiting_seconds))}<br>Remaining: ${esc(durationText(data.thread.remaining_seconds))}<br>Overdue: ${esc(durationText(data.thread.overdue_seconds))}<br>Responses: ${Number(data.thread.response_count || 0)}<br>Total wait: ${esc(durationText(data.thread.total_customer_wait_seconds))}`;
    el('summary').value = data.thread.summary || '';
    el('note').value = data.thread.note || '';
    el('tags').value = (data.thread.tags || []).join(', ');
    updateAssignmentControls();

    const box = el('messages');
    box.innerHTML = '';
    if (!data.messages.length) {
      box.innerHTML = '<div class="empty-card">No messages.</div>';
      return;
    }
    data.messages.forEach(message => {
      const row = document.createElement('div');
      row.className = `message-row ${message.direction === 'outbound' ? 'outbound' : ''}`;
      const statusClass = message.direction === 'outbound' && message.send_status ? ` status-${message.send_status}` : '';
      row.innerHTML = `<div class="message-bubble${statusClass}"><p>${esc(message.content || message.text_content || `[${message.event_type || message.message_type || 'event'}]`)}</p><small>${esc(messageMeta(message))}${message.error_message_safe ? `\uff5c${esc(message.error_message_safe)}` : ''}</small></div>`;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function loadAgents() {
    if (!isAdmin()) { state.agents = []; renderAgentFilter(); renderAgentPicker(); return; }
    const seq = ++state.agentSeq;
    el('agent-list-status').textContent = '\u8f09\u5165\u5ba2\u670d\u6e05\u55ae\u4e2d...';
    try {
      const result = await api.listLineAgents({ search: state.agentSearch, limit: 100 });
      if (seq !== state.agentSeq) return;
      state.agents = result.data || [];
      renderAgentFilter();
      renderAgentPicker();
      renderThreads();
    } catch (error) {
      if (seq !== state.agentSeq) return;
      state.agents = [];
      renderAgentFilter();
      renderAgentPicker();
      el('agent-list-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    }
  }

  async function loadThreads() {
    try {
      const filters = { status: state.status, search: state.search, limit: 200 };
      if (state.view === 'mine') filters.mine = 'true';
      if (state.view === 'unassigned') filters.unassigned = 'true';
      if (state.view === 'unread') filters.unread_only = 'true';
      if (isAdmin() && state.assigneeFilter === '__unassigned') filters.unassigned = 'true';
      if (isAdmin() && state.assigneeFilter && state.assigneeFilter !== '__unassigned') filters.assigned_to_uid = state.assigneeFilter;
      if (state.slaStatus && state.slaStatus !== 'all') filters.sla_status = state.slaStatus;
      if (state.priorityFilter && state.priorityFilter !== 'all') filters.priority = state.priorityFilter;
      if (state.waitingOnly) filters.waiting_only = 'true';
      if (state.breachedOnly) filters.breached_only = 'true';
      const result = await api.listThreads(filters);
      state.threads = result.data || [];
      renderThreads();
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
    }
  }

  async function openThread(id) {
    const seq = ++state.openSeq;
    updateComposer(false, '\u63a5\u624b\u4e2d...');
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
      el('chat-name').textContent = 'Unable to open thread';
      el('chat-meta').textContent = 'Please try again or adjust filters.';
      el('messages').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
      el('save').disabled = true;
      updateAssignmentControls();
      updateComposer(false, '\u7121\u6cd5\u5728\u76ee\u524d\u804a\u5929\u5ba4\u9001\u51fa\u8a0a\u606f\u3002');
    }
  }

  async function saveThread() {
    if (!state.active || !canOperateThread()) return;
    el('save').disabled = true;
    el('save-status').textContent = '\u5132\u5b58\u4e2d...';
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
      el('save-status').textContent = '\u5df2\u5132\u5b58';
      await loadThreads();
    } catch (error) {
      el('save-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    } finally {
      updateAssignmentControls();
    }
  }


  async function updatePriority() {
    if (!state.active || !canOperateThread()) return;
    const threadId = activeThreadId();
    try {
      const result = await api.updateThreadPriority(threadId, { priority: el('priority').value });
      if (activeThreadId() === threadId) state.active = { ...state.active, ...result.data.thread };
      await loadThreads();
      if (activeThreadId() === threadId) updateAssignmentControls();
    } catch (error) {
      el('save-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    }
  }
  async function assignThread(value) {
    const threadId = activeThreadId();
    if (!threadId || !isAdmin() || isAssigning(threadId)) return;
    state.assigning.add(threadId);
    updateAssignmentActions();
    el('assignment-status').textContent = value ? '\u6307\u6d3e\u4e2d...' : '\u89e3\u9664\u6307\u6d3e\u4e2d...';
    try {
      const result = await api.assignThread(threadId, { assigned_to_uid: value || null });
      if (activeThreadId() === threadId) {
        state.active = { ...state.active, ...result.data.thread };
        el('assignment-status').textContent = value ? '\u5df2\u6307\u6d3e' : '\u5df2\u89e3\u9664\u6307\u6d3e';
      }
      await loadAgents();
      await loadThreads();
      if (activeThreadId() === threadId) updateAssignmentControls();
    } catch (error) {
      if (activeThreadId() === threadId) {
        el('assignment-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
        renderAgentPicker();
        updateAssignmentActions();
      }
    } finally {
      state.assigning.delete(threadId);
      if (activeThreadId() === threadId) updateAssignmentActions();
    }
  }

  async function claimThread() {
    if (!state.active || !canClaimThread()) return;
    const threadId = activeThreadId();
    el('assignment-status').textContent = '\u63a5\u624b\u4e2d...';
    try {
      const result = await api.claimThread(threadId);
      if (activeThreadId() === threadId) {
        state.active = { ...state.active, ...result.data.thread };
        el('assignment-status').textContent = '\u5df2\u63a5\u624b';
      }
      await loadAgents();
      await loadThreads();
      if (activeThreadId() === threadId) updateAssignmentControls();
    } catch (error) {
      if (activeThreadId() === threadId) el('assignment-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
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
    updateComposer(true, '\u63a5\u624b\u4e2d...');
    try {
      const result = await api.sendThreadMessage(threadId, { type: 'text', text: messageText, client_request_id: requestId });
      state.sending.delete(threadId);
      if (activeThreadId() === threadId) {
        el('reply-text').value = '';
        el('reply-status').textContent = result.duplicate ? '\u5df2\u5ffd\u7565\u91cd\u8907\u9001\u51fa\u3002' : '\u5df2\u9001\u51fa\u3002';
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

  function renderEnvironmentBadge() {
    const badge = el('staging-badge');
    if (!badge) return;
    const explicit = ['staging', 'true', '1'].includes(String(params.get('app_env') || params.get('env') || '').toLowerCase());
    const stagingHost = /(^|[.-])staging([.-]|$)/i.test(location.hostname) || /travelkeeper-staging/i.test(location.hostname);
    const show = explicit || stagingHost;
    badge.hidden = !show;
    badge.classList.toggle('hidden', !show);
  }
  async function init() {
    renderEnvironmentBadge();
    try {
      const session = await page.initLiffSession({ fallbackLiffId: '2009367829-BDZCGti8', requireContext: true });
      state.role = session.context?.role || '';
      state.userUid = session.context?.userUid || session.profile?.userId || params.get('dev_uid') || '';
      el('tenant-label').textContent = 'Tenant ' + page.tenantSlug + ' | Role ' + state.role;
      const query = keepQuery();
      el('settings-link').href = `line-channel-settings.html?${query}`;
      el('crm-link').href = `crm.html?${query}`;
      el('dashboard-link').href = `dashboard.html?${query}`;
      updateComposer(false);
      renderAgentPicker();
      await loadAgents();
      await loadThreads();
      if (params.get('thread')) await openThread(params.get('thread'));
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
      updateComposer(false, '\u7121\u6cd5\u8f09\u5165\u804a\u5929\u5ba4\u3002');
    }
  }

  let searchTimer;
  let agentSearchTimer;
  el('search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    state.search = event.target.value;
    searchTimer = setTimeout(loadThreads, 250);
  });
  el('agent-search').addEventListener('input', event => {
    clearTimeout(agentSearchTimer);
    state.agentSearch = event.target.value;
    agentSearchTimer = setTimeout(loadAgents, 250);
  });
  el('assignee-filter').addEventListener('change', event => {
    state.assigneeFilter = event.target.value;
    loadThreads();
  });
  el('assignee-picker').addEventListener('change', updateAssignmentActions);
  el('sla-filter').addEventListener('change', event => { state.slaStatus = event.target.value; loadThreads(); });
  el('priority-filter').addEventListener('change', event => { state.priorityFilter = event.target.value; loadThreads(); });
  el('waiting-only').addEventListener('change', event => { state.waitingOnly = event.target.checked; loadThreads(); });
  el('breached-only').addEventListener('change', event => { state.breachedOnly = event.target.checked; loadThreads(); });
  el('priority').addEventListener('change', updatePriority);
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
  el('assign-thread').addEventListener('click', () => assignThread(el('assignee-picker').value));
  el('unassign-thread').addEventListener('click', () => assignThread(null));
  el('claim-thread').addEventListener('click', claimThread);
  el('mark-read').addEventListener('click', markRead);
  init();
})(window);
