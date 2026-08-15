import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const invitePageUrl = new URL('../partner-invite.html', import.meta.url);
const pageClientUrl = new URL('../js/tenant-page-client.js', import.meta.url);

test('partner invite page generates signed pit registration links only', async () => {
  const source = await readFile(invitePageUrl, 'utf8');
  assert.match(source, /\/api\/v2\/partner-invites/);
  assert.match(source, /data\.partner_invite_token/);
  assert.match(source, /url\.searchParams\.set\('tenant', tenantSlug\)/);
  assert.match(source, /url\.searchParams\.set\('pit', token\)/);
  assert.doesNotMatch(source, /searchParams\.set\('r'/);
  assert.doesNotMatch(source, /searchParams\.set\('ref_uid'/);
  assert.doesNotMatch(source, /searchParams\.set\('uid'/);
});

test('partner invite page requires verified sales/editor tenant context', async () => {
  const source = await readFile(invitePageUrl, 'utf8');
  assert.match(source, /await liff\.init\(\{ liffId \}\)/);
  assert.match(source, /await liff\.getProfile\(\)/);
  assert.match(source, /await api\('\/api\/v2\/tenant\/context'\)/);
  assert.match(source, /\['sales', 'editor'\]\.includes/);
  assert.match(source, /throw new Error\('TENANT_ROLE_DENIED'\)/);
});

test('dashboard recruit entry is bounded to dashboard and active sales/editor roles', async () => {
  const source = await readFile(pageClientUrl, 'utf8');
  assert.match(source, /function isDashboardPage\(\)/);
  assert.match(source, /path\.endsWith\('\/dashboard\.html'\)/);
  assert.match(source, /role === 'sales' \|\| role === 'editor'/);
  assert.match(source, /createPartnerInviteEntry\(\)/);
  assert.match(source, /withTenant\('partner-invite\.html'\)/);
  assert.doesNotMatch(source, /role === 'tenant_admin'.*createPartnerInviteEntry/s);
});

test('dashboard recruit entry is a bounded DOM append and does not rewrite dashboard markup', async () => {
  const source = await readFile(pageClientUrl, 'utf8');
  assert.match(source, /document\.createElement\('a'\)/);
  assert.match(source, /document\.body\.appendChild\(link\)/);
  assert.doesNotMatch(source, /document\.body\.innerHTML\s*=/);
  assert.doesNotMatch(source, /outerHTML\s*=/);
});
