import { FORMAT_LOCALE, translate } from './i18n/index.mjs';

export const AUTO_TOPUP_CONSENT_TEXT = 'I agree that when the balance falls strictly below the configured threshold, the selected payment method may be used to add funds automatically, subject to the daily attempt, daily amount, and cooldown limits.';

export const AUTO_TOPUP_CONSENT = Object.freeze({
  accepted: true,
  text_version: 'auto-topup-en-v1',
  text_sha256: 'c4e3c7ef15e96b8cdf93c92ff310e80ff91bea4e55dc2518365528379648cce8',
  locale: 'en',
});

export const PAYMENT_METHOD_CONSENT_TEXT = 'I agree that the payment service may store simulated payment-method identifiers for automatic top-up testing. Real card numbers and CVV values are never entered or stored.';

export const PAYMENT_METHOD_CONSENT = Object.freeze({
  accepted: true,
  text_version: 'payment-method-simulator-en-v1',
  text_sha256: '2d851f4c26e114749c428c7bfb68584d689bf989f45b9417b99934a11dcd3f18',
  locale: 'en',
});

export const BILLING_CONSENTS = Object.freeze({
  en: Object.freeze({
    autoTopUp: Object.freeze({ text: AUTO_TOPUP_CONSENT_TEXT, evidence: AUTO_TOPUP_CONSENT }),
    paymentMethod: Object.freeze({ text: PAYMENT_METHOD_CONSENT_TEXT, evidence: PAYMENT_METHOD_CONSENT }),
  }),
});

export function formatMinorAmount(amountMinor, currency = 'TWD', locale = FORMAT_LOCALE) {
  const value = Number(amountMinor);
  if (!Number.isFinite(value)) return '—';
  const zeroDecimal = currency === 'TWD';
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(zeroDecimal ? value : value / 100);
}

export function paymentMethodLabel(method) {
  if (!method) return translate('No payment method configured');
  const brand = String(method.card_brand || method.provider || 'Payment method').trim();
  const lastFour = /^\d{4}$/.test(String(method.last_four || '')) ? ` •••• ${method.last_four}` : '';
  return `${brand}${lastFour}`;
}

export function autoTopUpAssessment(policy) {
  if (!policy) return { tone: 'neutral', label: translate('Not configured'), detail: translate('Configure a payment method before enabling automatic top-up.') };
  if (!policy.enabled) return { tone: 'neutral', label: translate('Disabled'), detail: translate('A low balance will not trigger a charge.') };
  if (Number(policy.consecutive_failure_count) > 0) return { tone: 'warning', label: translate('Retrying charge'), detail: translate('The charge has failed {{count}} consecutive times and will be disabled after the third failure.', { count: policy.consecutive_failure_count }) };
  if (!policy.armed) return { tone: 'warning', label: translate('Waiting to re-arm'), detail: translate('The balance must first return above the threshold before low-balance monitoring resumes.') };
  return { tone: 'good', label: translate('Monitoring'), detail: translate('A top-up intent is created only when the balance falls strictly below the threshold.') };
}

export function paymentIntentState(state) {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'succeeded') return { tone: 'good', label: translate('Succeeded') };
  if (['failed', 'declined', 'canceled'].includes(normalized)) return { tone: 'danger', label: translate('Failed') };
  if (['unknown', 'requires_action'].includes(normalized)) return { tone: 'warning', label: normalized === 'unknown' ? translate('Reconciliation pending') : translate('Action required') };
  return { tone: 'neutral', label: normalized === 'processing' ? translate('Processing') : translate('Pending') };
}

export function billingErrorMessage(error) {
  const code = String(error?.code || '');
  const known = {
    PAYMENT_CAPABILITY_UNSUPPORTED: translate('The payment service has not completed automatic-charge eligibility verification, so no charge was submitted.'),
    PAYMENT_PROVIDER_NOT_CONFIGURED: translate('The payment service is not configured.'),
    PAYMENT_PROVIDER_UNAVAILABLE: translate('The payment service is temporarily unavailable. Please try again later.'),
    PAYMENT_METHOD_INACTIVE: translate('The selected payment method is inactive.'),
    AUTO_TOPUP_POLICY_CONFLICT: translate('The settings were changed by another operation. Refresh and try again.'),
    PAYMENT_AMOUNT_INVALID: translate('The top-up amount does not meet the configured rules.'),
  };
  return known[code] || translate('The billing operation did not complete. No charge was submitted or repeated.');
}
