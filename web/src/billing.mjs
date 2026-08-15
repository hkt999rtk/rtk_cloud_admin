export const AUTO_TOPUP_CONSENT_TEXT = '我同意在餘額嚴格低於設定門檻時，依每日次數、每日金額與冷卻限制，自動使用所選付款方式加值。';

export const AUTO_TOPUP_CONSENT = Object.freeze({
  accepted: true,
  text_version: 'auto-topup-zh-TW-v1',
  text_sha256: '6e2c0ba41a08fd9affb9016e01e4f712d84a09a53405537cd1680554712ecefa',
  locale: 'zh-TW',
});

export function formatMinorAmount(amountMinor, currency = 'TWD', locale = 'zh-TW') {
  const value = Number(amountMinor);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100);
}

export function paymentMethodLabel(method) {
  if (!method) return '未設定付款方式';
  const brand = String(method.card_brand || method.provider || 'Payment method').trim();
  const lastFour = /^\d{4}$/.test(String(method.last_four || '')) ? ` •••• ${method.last_four}` : '';
  return `${brand}${lastFour}`;
}

export function autoTopUpAssessment(policy) {
  if (!policy) return { tone: 'neutral', label: '尚未設定', detail: '設定付款方式後才能啟用自動加值。' };
  if (!policy.enabled) return { tone: 'neutral', label: '已停用', detail: '低餘額不會觸發扣款。' };
  if (!policy.armed) return { tone: 'warning', label: '等待重新啟動', detail: '餘額需先回到門檻以上，才會再次監看低餘額 crossing。' };
  return { tone: 'good', label: '監看中', detail: '只有餘額嚴格低於門檻時才建立一次加值意圖。' };
}

export function paymentIntentState(state) {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'succeeded') return { tone: 'good', label: '成功' };
  if (['failed', 'declined', 'canceled'].includes(normalized)) return { tone: 'danger', label: '失敗' };
  if (['unknown', 'requires_action'].includes(normalized)) return { tone: 'warning', label: normalized === 'unknown' ? '待對帳' : '需要操作' };
  return { tone: 'neutral', label: normalized === 'processing' ? '處理中' : '等待處理' };
}

export function billingErrorMessage(error) {
  const code = String(error?.code || '');
  const known = {
    PAYMENT_CAPABILITY_UNSUPPORTED: '目前付款服務尚未完成自動扣款資格驗證，因此不會送出扣款。',
    PAYMENT_PROVIDER_NOT_CONFIGURED: '付款服務尚未設定。',
    PAYMENT_PROVIDER_UNAVAILABLE: '付款服務暫時無法使用，請稍後再試。',
    PAYMENT_METHOD_INACTIVE: '選取的付款方式已失效。',
    AUTO_TOPUP_POLICY_CONFLICT: '設定已被其他操作更新，請重新整理後再試。',
    PAYMENT_AMOUNT_INVALID: '加值金額不符合規則。',
  };
  return known[code] || '帳務操作未完成，沒有送出或重複執行扣款。';
}
