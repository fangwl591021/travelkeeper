import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceFlex } from '../lib/workspace-flex.js';

const routes = {
  orders: 'https://example.com/orders',
  pendingItineraries: 'https://example.com/pending',
  lineMonitor: 'https://example.com/line-monitor',
  customers: 'https://example.com/customers',
  promotions: 'https://example.com/promotions',
  reservations: 'https://example.com/reservations',
  itineraries: 'https://example.com/itineraries',
  support: 'https://example.com/support'
};

const expected = {
  admin_dashboard: {
    title: '旅遊管家管理工作台',
    labels: ['訂單管理', '待審行程', 'LINE OA監看'],
    urls: [routes.orders, routes.pendingItineraries, routes.lineMonitor]
  },
  partner_workspace: {
    title: '旅遊管家業務工作台',
    labels: ['我的訂單', '我的客戶', '推廣行程'],
    urls: [routes.orders, routes.customers, routes.promotions]
  },
  traveler_workspace: {
    title: '旅遊管家旅客中心',
    labels: ['我的預約', '查看行程', '聯絡客服'],
    urls: [routes.reservations, routes.itineraries, routes.support]
  }
};

for (const [intent, expectation] of Object.entries(expected)) {
  test(`builds ${intent} Flex with three URI buttons`, () => {
    const result = buildWorkspaceFlex({ targetIntent: intent, routes });
    const { message, fallbackText } = result;
    const contents = message.contents;
    const buttons = contents.footer.contents;

    assert.equal(message.type, 'flex');
    assert.equal(contents.type, 'bubble');
    assert.equal(contents.body.contents[0].text, expectation.title);
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((button) => button.action.label), expectation.labels);
    assert.deepEqual(buttons.map((button) => button.action.uri), expectation.urls.map((url) => new URL(url).toString()));
    assert.ok(message.altText);
    assert.notEqual(message.altText, '工作台');
    assert.ok(fallbackText);

    for (const button of buttons) {
      assert.equal(button.action.type, 'uri');
      assert.equal(button.type, 'button');
    }
  });
}

for (const badUrl of ['', 'http://example.com', 'javascript:alert(1)', 'data:text/plain,blocked']) {
  test(`rejects unsafe or empty URL: ${badUrl || '(empty)'}`, () => {
    assert.throws(() => buildWorkspaceFlex({
      targetIntent: 'admin_dashboard',
      routes: { ...routes, orders: badUrl }
    }), /HTTPS|Invalid/);
  });
}

test('rejects missing required route', () => {
  const incompleteRoutes = { ...routes };
  delete incompleteRoutes.lineMonitor;
  assert.throws(() => buildWorkspaceFlex({ targetIntent: 'admin_dashboard', routes: incompleteRoutes }), /Missing required HTTPS route/);
});

for (const intent of ['generic_workspace', 'unknown', 'other', null, undefined]) {
  test(`rejects unsupported intent: ${String(intent)}`, () => {
    assert.throws(() => buildWorkspaceFlex({ targetIntent: intent, routes }), /Unsupported workspace intent/);
  });
}

test('rejects null or undefined input safely', () => {
  assert.throws(() => buildWorkspaceFlex(null), /Unsupported workspace intent/);
  assert.throws(() => buildWorkspaceFlex(undefined), /Unsupported workspace intent/);
});
