(function (global) {
  'use strict';

  const page = global.TravelKeeperTenantPage;
  if (!page) throw new Error('TravelKeeperTenantPage is required before tenant-crm-client.js');

  const apiCall = (path, options = {}) => page.apiCall(path, options);

  const client = {
    tenantSlug: page.tenantSlug,

    async load() {
      return apiCall('/api/v2/crm');
    },

    async getProfile(profileId) {
      return apiCall(`/api/v2/crm/profiles/${encodeURIComponent(profileId)}`);
    },

    async saveProfile(data = {}, profileId = '') {
      const path = profileId
        ? `/api/v2/crm/profiles/${encodeURIComponent(profileId)}`
        : '/api/v2/crm/profiles';
      return apiCall(path, { method: 'POST', body: data });
    },

    async listThreads() {
      return apiCall('/api/v2/crm/threads');
    },

    async saveThread(data = {}) {
      return apiCall('/api/v2/crm/threads', { method: 'POST', body: data });
    },

    async listRecords(profileId = '') {
      const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : '';
      return apiCall(`/api/v2/crm/records${query}`);
    },

    async saveRecord(data = {}, recordId = '') {
      const path = recordId
        ? `/api/v2/crm/records/${encodeURIComponent(recordId)}`
        : '/api/v2/crm/records';
      return apiCall(path, { method: 'POST', body: data });
    },

    async deleteRecord(recordId) {
      return apiCall(`/api/v2/crm/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    },
  };

  global.TravelKeeperTenantCrm = client;
})(window);
