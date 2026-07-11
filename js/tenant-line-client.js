(function (global) {
  'use strict';

  const tenantPage = global.TravelKeeperTenantPage;
  if (!tenantPage) throw new Error('TravelKeeperTenantPage is required before tenant-line-client.js');

  function api(path, options = {}) {
    return tenantPage.apiCall(path, options);
  }

  const client = {
    tenantSlug: tenantPage.tenantSlug,

    async listThreads(params = {}) {
      const query = new URLSearchParams(params);
      const response = await api(`/api/v2/line/threads?${query.toString()}`);
      return response;
    },

    async listLineAgents(params = {}) {
      const query = new URLSearchParams(params);
      return api(`/api/v2/tenant/line-agents?${query.toString()}`);
    },

    async getThreadMessages(threadId, limit = 200) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}/messages?limit=${encodeURIComponent(limit)}`);
    },

    async updateThread(threadId, data = {}) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}`, {
        method: 'POST',
        body: data,
      });
    },

    async assignThread(threadId, data = {}) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}/assignment`, {
        method: 'PATCH',
        body: data,
      });
    },

    async claimThread(threadId) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}/claim`, { method: 'POST' });
    },

    async markThreadRead(threadId) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}/read`, { method: 'POST' });
    },

    async sendThreadMessage(threadId, data = {}) {
      return api(`/api/v2/line/threads/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        body: data,
      });
    },
    async getChannel() {
      return api('/api/v2/line/channel');
    },

    async saveChannel(data = {}) {
      return api('/api/v2/line/channel', {
        method: 'POST',
        body: data,
      });
    },
  };

  global.TravelKeeperTenantLine = client;
})(window);
