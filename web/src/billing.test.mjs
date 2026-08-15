import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_TOPUP_CONSENT,
  autoTopUpAssessment,
  billingErrorMessage,
  formatMinorAmount,
  paymentIntentState,
  paymentMethodLabel,
} from './billing.mjs';

test('billing money remains integer minor units at the boundary', () => {
  assert.match(formatMinorAmount(125000, 'TWD'), /1,250/);
  assert.equal(formatMinorAmount(Number.NaN), '—');
});

test('payment method display exposes only safe metadata', () => {
  assert.equal(paymentMethodLabel({ provider: 'newebpay', card_brand: 'VISA', last_four: '4242' }), 'VISA •••• 4242');
  assert.equal(paymentMethodLabel({ provider: 'newebpay', last_four: 'raw-reference' }), 'newebpay');
});

test('automatic top-up copy reflects crossing and armed state', () => {
  assert.equal(autoTopUpAssessment(null).label, '尚未設定');
  assert.equal(autoTopUpAssessment({ enabled: true, armed: true }).label, '監看中');
  assert.match(autoTopUpAssessment({ enabled: true, armed: false }).detail, /門檻以上/);
});

test('intent states and payment failures are normalized for customers', () => {
  assert.equal(paymentIntentState('succeeded').tone, 'good');
  assert.equal(paymentIntentState('unknown').label, '待對帳');
  assert.match(billingErrorMessage({ code: 'PAYMENT_CAPABILITY_UNSUPPORTED' }), /不會送出扣款/);
  assert.doesNotMatch(billingErrorMessage({ code: 'RAW_PROVIDER_SECRET', message: 'secret' }), /secret/);
});

test('consent evidence is versioned and digest-shaped', () => {
  assert.equal(AUTO_TOPUP_CONSENT.accepted, true);
  assert.match(AUTO_TOPUP_CONSENT.text_sha256, /^[a-f0-9]{64}$/);
});
