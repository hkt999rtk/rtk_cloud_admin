import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en.mjs';

export const DEFAULT_LOCALE = 'en';
export const FORMAT_LOCALE = 'en-US';
export const SUPPORTED_LOCALES = Object.freeze([DEFAULT_LOCALE]);

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: { en },
      lng: DEFAULT_LOCALE,
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
  return new Intl.NumberFormat(FORMAT_LOCALE, options).format(value);
}

export function formatCurrency(value, currency, options = {}) {
  return new Intl.NumberFormat(FORMAT_LOCALE, {
    style: 'currency',
    currency,
    ...options,
  }).format(value);
}

export function formatDateTime(value, options) {
  return new Intl.DateTimeFormat(FORMAT_LOCALE, options).format(new Date(value));
}

export default i18n;
