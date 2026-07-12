import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_TABLE_MAPPING, SCHEMA_MAPPING } from '../scripts/phase17-line-architecture-inventory.mjs';

test('route mapping covers required webhook families', () => {
  const routes = ROUTE_TABLE_MAPPING.map(item => item.route);
  assert.ok(routes.includes('/line-webhook'));
  assert.ok(routes.includes('/line-webhook/{tenant}'));
  assert.ok(routes.includes('/api/v2/line/webhook/{tenant_slug}'));
  assert.ok(routes.includes('/platform-line-webhook'));
});

test('tenant-v2 webhook maps to tenant CRM tables', () => {
  const route = ROUTE_TABLE_MAPPING.find(item => item.route.includes('/api/v2/line/webhook'));
  assert.deepEqual(route.tables, ['tenant_crm_profiles', 'tenant_crm_threads', 'tenant_crm_messages']);
});

test('schema mapping covers all Phase 17 fields', () => {
  const fields = new Set(SCHEMA_MAPPING.map(item => item[0]));
  for (const field of ['LINE UID','display_name','picture_url','thread ID','status','risk','note','tags','message type','text','event ID','created_at','owner_uid','assignee','unread','direction','send status','SLA','tenant_slug']) assert.ok(fields.has(field), field);
});
