import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeBreach,
  calculateSla,
  closeWaitingCycle,
  normalizeSlaSettings,
  pauseWaitingCycle,
  resumeWaitingCycle,
  startWaitingCycle,
} from '../lib/tenant-line-sla.js';

const settings = normalizeSlaSettings({ first_response_sla_minutes: 30, followup_response_sla_minutes: 60, due_soon_percentage: 20, pause_sla_on_pending: 1 });
const at = iso => new Date(iso);

test('fixed clock starts first-response waiting cycle', () => {
  const cycle = startWaitingCycle({ queue_status: 'open', first_response_at: '' }, settings, at('2026-07-11T00:00:00.000Z'));
  assert.equal(cycle.waiting_since, '2026-07-11T00:00:00.000Z');
  assert.equal(cycle.sla_due_at, '2026-07-11T00:30:00.000Z');
  assert.equal(cycle.sla_status, 'waiting');
});

test('follow-up inbound uses follow-up SLA after first response', () => {
  const cycle = startWaitingCycle({ queue_status: 'open', first_response_at: '2026-07-10T23:00:00.000Z' }, settings, at('2026-07-11T00:00:00.000Z'));
  assert.equal(cycle.sla_due_at, '2026-07-11T01:00:00.000Z');
});

test('multiple inbound events do not extend existing deadline', () => {
  const existing = { queue_status: 'open', waiting_since: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' };
  assert.equal(startWaitingCycle(existing, settings, at('2026-07-11T00:10:00.000Z')), null);
});

test('failed or retryable outbound should leave waiting cycle open', () => {
  const thread = { queue_status: 'open', waiting_since: '2026-07-11T00:00:00.000Z', sla_started_at: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' };
  const sla = calculateSla(thread, settings, at('2026-07-11T00:05:00.000Z'));
  assert.equal(sla.sla_status, 'waiting');
  assert.equal(sla.waiting_seconds, 300);
});

test('duplicate outbound is represented by no second close calculation', () => {
  const closed = closeWaitingCycle({ waiting_since: '2026-07-11T00:00:00.000Z', total_customer_wait_seconds: 0 }, at('2026-07-11T00:05:00.000Z'));
  assert.equal(closed.total_customer_wait_seconds, 300);
  assert.equal(closed.sla_status, 'not_applicable');
});

test('pause and resume preserves remaining time', () => {
  const thread = { queue_status: 'open', waiting_since: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' };
  const paused = pauseWaitingCycle(thread, settings, at('2026-07-11T00:10:00.000Z'));
  assert.equal(paused.sla_status, 'paused');
  assert.equal(paused.sla_remaining_seconds, 1200);
  const resumed = resumeWaitingCycle({ ...thread, ...paused }, settings, at('2026-07-11T00:20:00.000Z'));
  assert.equal(resumed.sla_due_at, '2026-07-11T00:40:00.000Z');
});

test('close clears SLA and records wait seconds', () => {
  const closed = closeWaitingCycle({ waiting_since: '2026-07-11T00:00:00.000Z', total_customer_wait_seconds: 30 }, at('2026-07-11T00:02:00.000Z'));
  assert.equal(closed.waiting_since, '');
  assert.equal(closed.last_customer_wait_seconds, 120);
  assert.equal(closed.total_customer_wait_seconds, 150);
});

test('reopened inbound starts a new cycle', () => {
  const cycle = startWaitingCycle({ queue_status: 'closed', status: 'closed', first_response_at: '2026-07-10T23:00:00.000Z' }, settings, at('2026-07-11T00:00:00.000Z'));
  assert.equal(cycle.sla_status, 'waiting');
  assert.equal(cycle.sla_due_at, '2026-07-11T01:00:00.000Z');
});

test('due soon and breached are computed from fixed clock', () => {
  const base = { queue_status: 'open', waiting_since: '2026-07-11T00:00:00.000Z', sla_started_at: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' };
  assert.equal(calculateSla(base, settings, at('2026-07-11T00:25:00.000Z')).sla_status, 'due_soon');
  const breached = calculateSla(base, settings, at('2026-07-11T00:31:00.000Z'));
  assert.equal(breached.sla_status, 'breached');
  assert.equal(breached.overdue_seconds, 60);
});

test('breach acknowledgement only writes first timestamp', () => {
  const patch = acknowledgeBreach({ queue_status: 'open', waiting_since: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' }, settings, at('2026-07-11T00:31:00.000Z'));
  assert.equal(patch.sla_breached_at, '2026-07-11T00:31:00.000Z');
  assert.equal(acknowledgeBreach({ ...patch, waiting_since: '2026-07-11T00:00:00.000Z', sla_due_at: '2026-07-11T00:30:00.000Z' }, settings, at('2026-07-11T00:32:00.000Z')), null);
});
