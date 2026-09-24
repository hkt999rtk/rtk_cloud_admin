import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources.generated.mjs';
import { configuredLocales, localeByCode, localeConfig } from '../../localization/config.mjs';

export const DEFAULT_LOCALE = localeConfig.defaultLocale;
export const SUPPORTED_LOCALES = configuredLocales;
export const LOCALE_LABELS = Object.freeze(Object.fromEntries(localeConfig.locales.map(({ code, label }) => [code, label])));
const storageKey = localeConfig.storageKey;

function syncLocaleCookie(locale) {
  if (globalThis.document) document.cookie = `${localeConfig.cookieKey}=${encodeURIComponent(locale)}; Path=/; SameSite=Lax`;
}

export function normalizeLocale(value) {
  const candidate = String(value || '').replace('_', '-');
  if (SUPPORTED_LOCALES.includes(candidate)) return candidate;
  if (candidate.toLowerCase().startsWith('zh-tw') || candidate.toLowerCase().startsWith('zh-hant')) return 'zh-TW';
  if (candidate.toLowerCase().startsWith('zh')) return 'zh-CN';
  return DEFAULT_LOCALE;
}

function initialLocale() {
  try {
    const saved = globalThis.window?.localStorage?.getItem(storageKey);
    if (saved) return normalizeLocale(saved);
  } catch { /* storage can be unavailable in private browsing */ }
  return normalizeLocale(globalThis.navigator?.languages?.[0] || globalThis.navigator?.language);
}

export function activeLocale() {
  return normalizeLocale(i18n.resolvedLanguage || i18n.language);
}

export function formatLocale() {
  return localeByCode[activeLocale()]?.formatLocale || localeByCode[DEFAULT_LOCALE].formatLocale;
}

export async function changeLocale(locale) {
  const next = normalizeLocale(locale);
  await i18n.changeLanguage(next);
  try { window.localStorage.setItem(storageKey, next); } catch { /* preference remains in memory */ }
  if (globalThis.document) document.documentElement.lang = localeByCode[next].htmlLang;
  syncLocaleCookie(next);
  return next;
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: initialLocale(),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
}

syncLocaleCookie(activeLocale());
if (globalThis.document) document.documentElement.lang = localeByCode[activeLocale()].htmlLang;

export function translate(message, options) {
  const status = typeof message === 'string' && /^unexpected status (\d+)$/i.exec(message);
  if (status) return i18n.t('Unexpected status {{status}}', { status: status[1], ...options });
  return i18n.t(message, options);
}

export function formatNumber(value, options) {
  return new Intl.NumberFormat(formatLocale(), options).format(value);
}

export function formatCurrency(value, currency, options = {}) {
  return new Intl.NumberFormat(formatLocale(), {
    style: 'currency',
    currency,
    ...options,
  }).format(value);
}

export function formatDateTime(value, options) {
  return new Intl.DateTimeFormat(formatLocale(), options).format(new Date(value));
}

export default i18n;
