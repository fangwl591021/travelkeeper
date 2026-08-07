import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEligibleWorkspaceWebhookEvent } from '../lib/workspace-webhook-event-eligibility.js';

function textEvent(overrides = {}) {
  return {
    type: 'message',
    replyToken: 'do-not-return-this',
    source: { type: 'user', userId: 'U1234567890' },
    message: { type: 'text', text: '  工作台  ' },
    ...overrides
  };
}

test('selects only the first eligible user text event', () => {
  const result = selectEligibleWorkspaceWebhookEvent({
    events: [
      { type: 'follow', source: { type: 'user', userId: 'U-follow' } },
      textEvent(),
      textEvent({ message: { type: 'text', text: '第二則' } })
    ]
  });

  assert.deepEqual(result, {
    eligible: true,
    event: {
      eligible: true,
      eventIndex: 1,
      verifiedUserUid: 'U1234567890',
      text: '工作台'
    }
  });
});

test('rejects empty text, missing user ID, and non-user sources', () => {
  const candidates = [
    textEvent({ message: { type: 'text', text: '  ' } }),
    textEvent({ source: { type: 'user', userId: '' } }),
    textEvent({ source: { type: 'group', userId: 'U-group' } })
  ];

  assert.deepEqual(selectEligibleWorkspaceWebhookEvent({ events: candidates }), {
    eligible: false,
    event: null
  });
});

test('rejects non-text event forms and redeliveries', () => {
  const events = [
    textEvent({ type: 'postback', message: undefined }),
    textEvent({ message: { type: 'image' } }),
    textEvent({ deliveryContext: { isRedelivery: true } })
  ];

  assert.deepEqual(selectEligibleWorkspaceWebhookEvent({ events }), {
    eligible: false,
    event: null
  });
});

test('fails closed for malformed and credential-shaped input', () => {
  for (const input of [
    null,
    {},
    { events: {} },
    { events: [], replyToken: 'secret' },
    { events: [], channelAccessToken: 'secret' },
    { events: [], request: {} }
  ]) {
    assert.deepEqual(selectEligibleWorkspaceWebhookEvent(input), {
      eligible: false,
      event: null
    });
  }
});

test('output never contains reply token, event payload, or credentials', () => {
  const result = selectEligibleWorkspaceWebhookEvent({
    events: [textEvent({
      webhookEventId: 'event-private',
      message: { type: 'text', text: 'x'.repeat(800) }
    })]
  });

  assert.equal(result.event.text.length, 500);
  assert.doesNotMatch(JSON.stringify(result), /do-not-return-this|event-private|replyToken|channelAccessToken/i);
});
