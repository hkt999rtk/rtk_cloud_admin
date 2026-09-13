import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en.mjs';
import { zhTW } from './zh-TW.mjs';
import { zhCN } from './zh-CN.mjs';

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = Object.freeze(['en', 'zh-TW', 'zh-CN']);
export const LOCALE_LABELS = Object.freeze({ en: 'English', 'zh-TW': '繁體中文', 'zh-CN': '简体中文' });
const storageKey = 'rtk-console-locale';
const formatLocales = Object.freeze({ en: 'en-US', 'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN' });

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
  return formatLocales[activeLocale()] || formatLocales.en;
}

export async function changeLocale(locale) {
  const next = normalizeLocale(locale);
  await i18n.changeLanguage(next);
  try { window.localStorage.setItem(storageKey, next); } catch { /* preference remains in memory */ }
  if (globalThis.document) document.documentElement.lang = next === 'zh-TW' ? 'zh-Hant' : next === 'zh-CN' ? 'zh-Hans' : 'en';
  return next;
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: { en, 'zh-TW': zhTW, 'zh-CN': zhCN },
      lng: initialLocale(),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
}

export function translate(message, options) {
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
