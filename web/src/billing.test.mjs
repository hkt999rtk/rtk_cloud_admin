import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_TOPUP_CONSENT,
  PAYMENT_METHOD_CONSENT,
  autoTopUpAssessment,
  billingErrorMessage,
  formatMinorAmount,
  paymentIntentState,
  paymentMethodLabel,
} from './billing.mjs';

test('billing money treats TWD as a zero-decimal currency', () => {
  assert.match(formatMinorAmount(1250, 'TWD'), /1,250/);
  assert.equal(formatMinorAmount(Number.NaN), '—');
});

test('payment method display exposes only safe metadata', () => {
  assert.equal(paymentMethodLabel({ provider: 'newebpay', card_brand: 'VISA', last_four: '4242' }), 'VISA •••• 4242');
  assert.equal(paymentMethodLabel({ provider: 'newebpay', last_four: 'raw-reference' }), 'newebpay');
});

test('automatic top-up copy reflects crossing and armed state', () => {
  assert.equal(autoTopUpAssessment(null).label, 'Not configured');
  assert.equal(autoTopUpAssessment({ enabled: true, armed: true }).label, 'Monitoring');
  assert.equal(autoTopUpAssessment({ enabled: true, armed: true, consecutive_failure_count: 2 }).label, 'Retrying charge');
  assert.match(autoTopUpAssessment({ enabled: true, armed: false }).detail, /above the threshold/);
});

test('intent states and payment failures are normalized for customers', () => {
  assert.equal(paymentIntentState('succeeded').tone, 'good');
  assert.equal(paymentIntentState('unknown').label, 'Reconciliation pending');
  assert.match(billingErrorMessage({ code: 'PAYMENT_CAPABILITY_UNSUPPORTED' }), /no charge was submitted/i);
  assert.doesNotMatch(billingErrorMessage({ code: 'RAW_PROVIDER_SECRET', message: 'secret' }), /secret/);
});

test('consent evidence is versioned and digest-shaped', () => {
  assert.equal(AUTO_TOPUP_CONSENT.accepted, true);
  assert.equal(AUTO_TOPUP_CONSENT.locale, 'en');
  assert.match(AUTO_TOPUP_CONSENT.text_version, /-en-v1$/);
  assert.match(AUTO_TOPUP_CONSENT.text_sha256, /^[a-f0-9]{64}$/);
  assert.match(PAYMENT_METHOD_CONSENT.text_sha256, /^[a-f0-9]{64}$/);
});
