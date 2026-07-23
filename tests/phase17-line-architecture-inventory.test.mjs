import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, sanitizeInventory, summarizeRows } from '../scripts/phase17-line-architecture-inventory.mjs';

test('sanitizeInventory redacts credentials and private content', () => {
  const result = sanitizeInventory({ token: 'abc', secret: 'def', content: 'private', replyToken: 'rt', count: 3 });
  assert.equal(result.token, '[REDACTED]');
  assert.equal(result.secret, '[REDACTED]');
  assert.equal(result.content, '[REDACTED]');
  assert.equal(result.replyToken, '[REDACTED]');
  assert.equal(result.count, 3);
});

test('sanitizeInventory never emits a UID list', () => {
  const result = sanitizeInventory({ uid_list: ['U123', 'U456'] });
  assert.equal(result.uid_list, '[REDACTED]');
});

test('summarizeRows outputs aggregates only', () => {
  const uid = `U${'a'.repeat(32)}`;
  const report = summarizeRows([
    { line_user_uid: uid, webhook_event_id: 'e1', thread_id: 't1', message_type: 'text', created_at: '2026-01-01', reply_token: 'secret' },
    { line_user_uid: uid, webhook_event_id: 'e1', thread_id: '', message_type: 'image', created_at: '2026-01-02', reply_token: '' },
    { line_user_uid: '', webhook_event_id: '', thread_id: 't2', message_type: 'text', created_at: '2026-01-03' },
  ]);
  assert.deepEqual(report, {
    count: 3,
    distinct_line_uid: 1,
    duplicate_event_id: 1,
    null_invalid_uid: 1,
    orphan_messages: 1,
    message_type_distribution: { text: 2, image: 1 },
    earliest_created_at: '2026-01-01',
    latest_created_at: '2026-01-03',
    reply_token_non_empty: 1,
  });
});

test('buildReport includes unknown quarantine rule', () => {
  const report = buildReport({ production_legacy: { counts: { line_threads: 1 } } });
  assert.match(report.tenant_resolution.unknown, /quarantine/i);
  assert.equal(report.production_legacy.counts.line_threads, 1);
});
