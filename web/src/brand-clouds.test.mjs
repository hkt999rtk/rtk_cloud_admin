import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brandCloudKPIs,
  brandCloudQuotaLabel,
  brandCloudStatusLabel,
  brandCloudUserStatus,
  filterBrandClouds,
  userFacingBrandCloudError,
} from './brand-clouds.mjs';

const brands = [
  { id: 'brand-001', name: 'Realtek Connect+', status: 'active', tier: 'Evaluation', evaluation_device_quota: 200, metadata: { owner_email: 'ops@example.com' } },
  { id: 'brand-002', name: 'Acme Vision', status: 'setup_required', tier: 'Commercial', metadata: { brandname: 'ACME' } },
  { id: 'brand-003', name: 'Disabled Demo', status: 'disabled', metadata: { device_count: 4, device_quota: 10 } },
];

test('summarizes Brand Clouds by operational status', () => {
  assert.deepEqual(brandCloudKPIs(brands), {
    total: 3,
    active: 1,
    setupRequired: 1,
    disabled: 1,
  });
});

test('maps low-level Brand Cloud status and quota fields to UI labels', () => {
  assert.equal(brandCloudStatusLabel({ status: 'pending_verification' }), 'Setup Required');
  assert.equal(brandCloudStatusLabel({ status: 'suspended' }), 'Disabled');
  assert.equal(brandCloudQuotaLabel(brands[0]), '200 devices');
  assert.equal(brandCloudQuotaLabel(brands[2]), '4 / 10');
});

test('filters Brand Clouds across name id owner metadata status and tier', () => {
  assert.deepEqual(filterBrandClouds(brands, { query: 'ops' }).map((brand) => brand.id), ['brand-001']);
  assert.deepEqual(filterBrandClouds(brands, { query: 'ACME' }).map((brand) => brand.id), ['brand-002']);
  assert.deepEqual(filterBrandClouds(brands, { status: 'disabled' }).map((brand) => brand.id), ['brand-003']);
  assert.deepEqual(filterBrandClouds(brands, { tier: 'commercial' }).map((brand) => brand.id), ['brand-002']);
});

test('maps Brand Cloud user activation states for platform review', () => {
  assert.deepEqual(brandCloudUserStatus({}), { key: 'active', label: 'Active' });
  assert.deepEqual(brandCloudUserStatus({ signup_pending_verification: true }), { key: 'pending_verification', label: 'Pending Activation' });
  assert.deepEqual(brandCloudUserStatus({ disabled_at: '2026-06-11T00:00:00Z', signup_pending_verification: true }), { key: 'disabled', label: 'Disabled' });
});

test('Brand Clouds errors are stable and do not expose upstream payload details', () => {
  assert.equal(
    userFacingBrandCloudError(new Error('ACCOUNT_MANAGER_BASE_URL is not configured')),
    'Brand Clouds requires Account Manager Platform Admin login.',
  );
  assert.equal(
    userFacingBrandCloudError({ status: 403, message: 'forbidden' }),
    'This platform admin session cannot perform that Brand Clouds action.',
  );
  assert.equal(
    userFacingBrandCloudError(new Error('upstream returned {"access_token":"secret"}')),
    'Brand Clouds action failed. Please try again.',
  );
});
