import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeWorkspaceIntent } from '../lib/workspace-permission.js';

const identity = (roles, extra = {}) => ({
  authenticated: true,
  workspaceRoles: roles,
  ...extra
});

test('allows platform_admin and tenant_admin to open admin dashboard', () => {
  assert.equal(authorizeWorkspaceIntent({ intent: 'admin_dashboard', identity: identity(['platform_admin']) }).allowed, true);
  assert.equal(authorizeWorkspaceIntent({ intent: 'admin_dashboard', identity: identity(['tenant_admin']) }).allowed, true);
});

test('allows only partner identity to open partner workspace', () => {
  assert.equal(authorizeWorkspaceIntent({ intent: 'partner_workspace', identity: identity(['partner']) }).allowed, true);
  assert.equal(authorizeWorkspaceIntent({ intent: 'partner_workspace', identity: identity(['platform_admin']) }).reason, 'role_not_allowed');
  assert.equal(authorizeWorkspaceIntent({ intent: 'partner_workspace', identity: identity(['tenant_admin']) }).reason, 'role_not_allowed');
});

test('allows only traveler identity to open traveler workspace', () => {
  assert.equal(authorizeWorkspaceIntent({ intent: 'traveler_workspace', identity: identity(['traveler']) }).allowed, true);
  assert.equal(authorizeWorkspaceIntent({ intent: 'traveler_workspace', identity: identity(['partner']) }).reason, 'role_not_allowed');
});

test('returns login_required for guest or missing authentication', () => {
  assert.deepEqual(authorizeWorkspaceIntent({ intent: 'admin_dashboard', identity: { authenticated: false } }), {
    allowed: false,
    decision: 'login_required',
    targetIntent: '',
    reason: 'authentication_required'
  });
  assert.deepEqual(authorizeWorkspaceIntent({ intent: 'admin_dashboard' }), {
    allowed: false,
    decision: 'login_required',
    targetIntent: '',
    reason: 'authentication_required'
  });
});

test('returns no_workspace_role for authenticated unassigned identity', () => {
  assert.deepEqual(authorizeWorkspaceIntent({
    intent: 'generic_workspace',
    identity: identity([], { identityStatus: 'unassigned' })
  }), {
    allowed: false,
    decision: 'forbidden',
    targetIntent: '',
    reason: 'no_workspace_role'
  });
});

test('does not upgrade finance and reports unavailable workspace', () => {
  assert.deepEqual(authorizeWorkspaceIntent({
    intent: 'generic_workspace',
    identity: identity(['finance'])
  }), {
    allowed: false,
    decision: 'workspace_not_available',
    targetIntent: '',
    reason: 'workspace_not_available'
  });
  assert.equal(authorizeWorkspaceIntent({ intent: 'admin_dashboard', identity: identity(['finance']) }).allowed, false);
});

test('routes generic workspace by fixed role priority', () => {
  assert.deepEqual(authorizeWorkspaceIntent({ intent: 'generic_workspace', identity: identity(['platform_admin', 'partner', 'traveler']) }), {
    allowed: true,
    decision: 'allow',
    targetIntent: 'admin_dashboard',
    reason: ''
  });
  assert.equal(authorizeWorkspaceIntent({ intent: 'generic_workspace', identity: identity(['tenant_admin', 'partner']) }).targetIntent, 'admin_dashboard');
  assert.equal(authorizeWorkspaceIntent({ intent: 'generic_workspace', identity: identity(['partner', 'traveler']) }).targetIntent, 'partner_workspace');
  assert.equal(authorizeWorkspaceIntent({ intent: 'generic_workspace', identity: identity(['traveler']) }).targetIntent, 'traveler_workspace');
});

test('rejects unknown intent', () => {
  assert.deepEqual(authorizeWorkspaceIntent({ intent: 'something_else', identity: identity(['traveler']) }), {
    allowed: false,
    decision: 'unknown_intent',
    targetIntent: '',
    reason: ''
  });
});

test('handles null, undefined, and empty objects safely', () => {
  assert.equal(authorizeWorkspaceIntent(null).decision, 'login_required');
  assert.equal(authorizeWorkspaceIntent(undefined).decision, 'login_required');
  assert.equal(authorizeWorkspaceIntent({}).decision, 'login_required');
});

test('supports the identity resolver roles field without broadening permissions', () => {
  assert.equal(authorizeWorkspaceIntent({
    intent: 'generic_workspace',
    identity: { authenticated: true, roles: ['traveler'] }
  }).targetIntent, 'traveler_workspace');
  assert.equal(authorizeWorkspaceIntent({
    intent: 'partner_workspace',
    identity: { authenticated: true, roles: ['administrator'] }
  }).allowed, false);
});
