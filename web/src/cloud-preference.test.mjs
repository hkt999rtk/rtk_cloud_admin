import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUD_PREFERENCE_COOKIE,
  cloudPreferenceCookie,
  forgetCloudPreference,
  membershipCloudIDs,
  preferredCloudID,
  readCloudPreference,
  rememberCloudPreference,
} from './cloud-preference.mjs';

const cloudA = '11111111-1111-4111-8111-111111111111';
const cloudB = '22222222-2222-4222-8222-222222222222';
const me = { memberships: [{ organization_id: cloudA }, { id: cloudB }, { organization_id: cloudA }, { id: 'not-a-cloud' }] };

test('cloud preference parser accepts only the named UUID cookie', () => {
  assert.equal(readCloudPreference(`session=abc; ${CLOUD_PREFERENCE_COOKIE}=${cloudB}; theme=dark`), cloudB);
  assert.equal(readCloudPreference(`${CLOUD_PREFERENCE_COOKIE}=not-a-cloud`), '');
  assert.equal(readCloudPreference(`${CLOUD_PREFERENCE_COOKIE}=%E0%A4%A`), '');
  assert.equal(readCloudPreference('unrelated=value'), '');
});

test('remembered membership wins and a stale preference falls back to the first ordered membership', () => {
  assert.deepEqual(membershipCloudIDs(me), [cloudA, cloudB]);
  assert.equal(preferredCloudID(me, cloudB), cloudB);
  assert.equal(preferredCloudID(me, '33333333-3333-4333-8333-333333333333'), cloudA);
  assert.equal(preferredCloudID({ memberships: [] }, cloudB), '');
});

test('cookie writer uses one-year same-site navigation storage and secure HTTPS', () => {
  assert.equal(cloudPreferenceCookie('invalid'), '');
  assert.match(cloudPreferenceCookie(cloudA), new RegExp(`^${CLOUD_PREFERENCE_COOKIE}=${cloudA}; Path=/; Max-Age=31536000; SameSite=Lax$`));
  assert.match(cloudPreferenceCookie(cloudA, { secure: true }), /; Secure$/);
  const documentRef = { cookie: '' };
  assert.equal(rememberCloudPreference(cloudB, documentRef, { protocol: 'https:' }), true);
  assert.match(documentRef.cookie, new RegExp(`^${CLOUD_PREFERENCE_COOKIE}=${cloudB}.*; Secure$`));
  assert.equal(forgetCloudPreference(documentRef, { protocol: 'https:' }), true);
  assert.match(documentRef.cookie, new RegExp(`^${CLOUD_PREFERENCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure$`));
});
