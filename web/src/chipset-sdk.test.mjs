import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chipsetVendors,
  compactHash,
  filterChipsets,
  filterProviders,
  formatProviderTimestamp,
  providerEndpointCount,
  providerKPIs,
  providerSyncHealth,
  vendorInitials,
} from './chipset-sdk.mjs';

const providers = [
  { id: 'ameba', name: 'Ameba IoT', status: 'published', chipset_count: 1, sdk_release_count: 2, last_successful_refresh_at: '2026-07-19T02:00:00Z', stale: true },
  { id: 'realtek', name: 'Realtek', status: 'published', chipset_count: 3, sdk_release_count: 5, last_successful_refresh_at: '2026-07-19T03:00:00Z' },
  { id: 'partner', name: 'Partner Lab', status: 'draft', unavailable: true },
];
const chipsets = [{ name: 'AmebaPro2', vendor: 'Realtek', family: 'Ameba', sdk_releases: [{ name: 'Arduino', version: '4.0.8', recommended: true, supported_models: ['AMB82-Mini'], endpoints: [{}, {}] }] }];

test('provider dashboard helpers compute and filter design data', () => {
  assert.deepEqual(providerKPIs(providers), { total: 3, published: 2, publishedChipsets: 4, publishedSDKs: 7, lastSuccess: '2026-07-19T03:00:00Z', needsAttention: 2 });
  assert.equal(filterProviders(providers, 'ameba', 'published').length, 1);
  assert.equal(filterProviders(providers, '', 'stale')[0].id, 'ameba');
  assert.equal(providerSyncHealth(providers[0]).key, 'stale');
  assert.equal(providerSyncHealth(providers[2]).key, 'unavailable');
  assert.equal(compactHash('1234567890abcdef'), '12345678…');
  assert.equal(formatProviderTimestamp('2026-07-19T03:04:05Z'), '2026-07-19 03:04 UTC');
  assert.equal(formatProviderTimestamp(''), '—');
});

test('developer catalog helpers filter releases and summarize cards', () => {
  assert.deepEqual(chipsetVendors(chipsets), ['Realtek']);
  assert.equal(filterChipsets(chipsets, 'AMB82', 'Realtek', true).length, 1);
  assert.equal(filterChipsets(chipsets, 'missing', 'all', false).length, 0);
  assert.equal(providerEndpointCount(chipsets), 2);
  assert.equal(vendorInitials(chipsets[0]), 'AME');
});
