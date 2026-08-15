import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageUrl = new URL('../register.html', import.meta.url);

test('registration page uses tenant V2 authenticated application APIs only', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /tenant-api-client\.js/);
  assert.match(source, /\/api\/v2\/tenant\/public/);
  assert.match(source, /\/api\/v2\/partner-applications\/me/);
  assert.match(source, /\/api\/v2\/partner-applications/);
  assert.doesNotMatch(source, /\/api\/partner\/register/);
  assert.doesNotMatch(source, /checkUserStatus/);
});

test('registration form never submits LINE UID or raw referrer UID', async () => {
  const source = await readFile(pageUrl, 'utf8');
  const submitStart = source.indexOf("form.addEventListener('submit'");
  const submitBlock = source.slice(submitStart);
  assert.ok(submitStart >= 0);
  assert.match(submitBlock, /partner_invite_token:\s*partnerInviteToken/);
  assert.doesNotMatch(submitBlock, /\buid\s*:/);
  assert.doesNotMatch(submitBlock, /\buser_uid\s*:/);
  assert.doesNotMatch(submitBlock, /\bref_uid\s*:/);
});

test('legacy r query is warning-only and signed pit is the attributed invite input', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /params\.get\('pit'\)/);
  assert.match(source, /params\.get\('r'\)/);
  assert.match(source, /舊版.*r.*參數不再建立上線關係/s);
  assert.match(source, /安全招募邀請已帶入/);
  assert.doesNotMatch(source, /ref_uid:\s*legacyRef/);
});

test('registration waits for LIFF login and uses tenant-configured LIFF id', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /const liffId = String\(tenant\.liff_id/);
  assert.match(source, /await liff\.init\(\{ liffId \}\)/);
  assert.match(source, /if \(!liff\.isLoggedIn\(\)\)/);
  assert.match(source, /liff\.login\(\{ redirectUri: location\.href \}\)/);
  assert.match(source, /lineProfile = await liff\.getProfile\(\)/);
});
