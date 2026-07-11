(function (global) {
  'use strict';
  const page = global.TravelKeeperTenantPage;
  const api = global.TravelKeeperTenantLine;
  if (!page || !api) throw new Error('Tenant page and LINE clients are required');

  const params = new URLSearchParams(location.search);
  const state = { threads: [], active: null, status: 'all', search: '' };
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = value => value ? new Date(value).toLocaleString('zh-TW') : '';
  const keepQuery = () => {
    const q = new URLSearchParams();
    ['tenant', 'worker', 'dev_uid'].forEach(key => { if (params.get(key)) q.set(key, params.get(key)); });
    return q.toString();
  };

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
        <div class="pills"><span>${esc(thread.status)}</span><span>${esc(thread.risk)}</span><span>${thread.message_count} 則</span></div>`;
      button.addEventListener('click', () => openThread(thread.id));
      box.appendChild(button);
    });
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
    el('save').disabled = false;

    const box = el('messages');
    box.innerHTML = '';
    if (!data.messages.length) {
      box.innerHTML = '<div class="empty-card">尚無訊息。</div>';
      return;
    }
    data.messages.forEach(message => {
      const row = document.createElement('div');
      row.className = `message-row ${message.direction === 'outbound' ? 'outbound' : ''}`;
      row.innerHTML = `<div class="message-bubble"><p>${esc(message.content || `[${message.event_type || message.message_type || 'event'}]`)}</p><small>${esc(message.message_type || message.event_type)}｜${esc(fmt(message.created_at || message.event_timestamp))}${message.redelivery ? '｜redelivery' : ''}</small></div>`;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function loadThreads() {
    try {
      const result = await api.listThreads({ status: state.status, search: state.search, limit: 200 });
      state.threads = result.data || [];
      renderThreads();
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
    }
  }

  async function openThread(id) {
    try {
      const result = await api.getThreadMessages(id);
      renderThread(result.data);
    } catch (error) {
      state.active = null;
      renderThreads();
      el('chat-name').textContent = '無法開啟聊天室';
      el('chat-meta').textContent = '請確認權限或聊天室是否存在。';
      el('messages').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
      el('save').disabled = true;
    }
  }

  async function saveThread() {
    if (!state.active) return;
    el('save').disabled = true;
    el('save-status').textContent = '儲存中…';
    try {
      const result = await api.updateThread(state.active.id, {
        status: el('status').value,
        risk: el('risk').value,
        summary: el('summary').value,
        note: el('note').value,
        tags: el('tags').value.split(',').map(item => item.trim()).filter(Boolean),
      });
      renderThread(result.data);
      el('save-status').textContent = '已儲存';
    } catch (error) {
      el('save-status').textContent = page.friendlyError ? page.friendlyError(error) : error.message;
    } finally {
      el('save').disabled = false;
    }
  }

  async function init() {
    try {
      const session = await page.initLiffSession({ fallbackLiffId: '2009367829-BDZCGti8', requireContext: true });
      el('tenant-label').textContent = `租戶 ${page.tenantSlug}｜角色 ${session.context?.role || ''}`;
      const query = keepQuery();
      el('settings-link').href = `line-channel-settings.html?${query}`;
      el('crm-link').href = `crm.html?${query}`;
      el('dashboard-link').href = `dashboard.html?${query}`;
      await loadThreads();
      if (params.get('thread')) await openThread(params.get('thread'));
    } catch (error) {
      el('thread-list').innerHTML = `<div class="error-card">${esc(page.friendlyError ? page.friendlyError(error) : error.message)}</div>`;
    }
  }

  let searchTimer;
  el('search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    state.search = event.target.value;
    searchTimer = setTimeout(loadThreads, 250);
  });
  document.querySelectorAll('[data-status]').forEach(button => {
    button.addEventListener('click', () => {
      state.status = button.dataset.status;
      document.querySelectorAll('[data-status]').forEach(item => item.classList.toggle('active-filter', item === button));
      loadThreads();
    });
  });
  el('save').addEventListener('click', saveThread);
  init();
})(window);
