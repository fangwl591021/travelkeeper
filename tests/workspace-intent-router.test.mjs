import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWorkspaceIntent } from '../lib/workspace-intent-router.js';

const cases = [
  ['儀表板', 'admin_dashboard'],
  ['仪表板', 'admin_dashboard'],
  ['管理工作台', 'admin_dashboard'],
  ['業務專區', 'partner_workspace'],
  ['业务专区', 'partner_workspace'],
  ['夥伴專區', 'partner_workspace'],
  ['伙伴专区', 'partner_workspace'],
  ['分銷商專區', 'partner_workspace'],
  ['分销商专区', 'partner_workspace'],
  ['我的行程', 'traveler_workspace'],
  ['旅客中心', 'traveler_workspace'],
  ['會員中心', 'traveler_workspace'],
  ['会员中心', 'traveler_workspace'],
  ['工作台', 'generic_workspace'],
  ['我的工作台', 'generic_workspace']
];

for (const [trigger, intent] of cases) {
  test(`routes exact trigger: ${trigger}`, () => {
    assert.deepEqual(routeWorkspaceIntent(trigger), { matched: true, intent, trigger });
  });
}

test('normalizes surrounding and full-width whitespace', () => {
  assert.deepEqual(routeWorkspaceIntent('\u3000 儀表板 \u3000'), {
    matched: true,
    intent: 'admin_dashboard',
    trigger: '儀表板'
  });
  assert.deepEqual(routeWorkspaceIntent('  我的\t行程  '), {
    matched: false,
    intent: 'unknown',
    trigger: ''
  });
});

test('normalizes English letter case without enabling partial matches', () => {
  assert.deepEqual(routeWorkspaceIntent('WORK台'), {
    matched: false,
    intent: 'unknown',
    trigger: ''
  });
});

for (const input of [null, undefined, 123, '', '   ']) {
  test(`returns unknown for invalid or empty input: ${String(input)}`, () => {
    assert.deepEqual(routeWorkspaceIntent(input), { matched: false, intent: 'unknown', trigger: '' });
  });
}

for (const input of ['請幫我開啟儀表板', '我想去日本旅遊', '儀表板其他內容']) {
  test(`rejects non-exact input: ${input}`, () => {
    assert.deepEqual(routeWorkspaceIntent(input), { matched: false, intent: 'unknown', trigger: '' });
  });
}
