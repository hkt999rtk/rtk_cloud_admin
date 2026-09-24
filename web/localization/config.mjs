export const localeConfig = Object.freeze({
  defaultLocale: 'en',
  storageKey: 'rtk-console-locale',
  cookieKey: 'rtk-console-locale',
  locales: Object.freeze([
    Object.freeze({ code: 'en', label: 'English', htmlLang: 'en', formatLocale: 'en-US' }),
    Object.freeze({ code: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant', formatLocale: 'zh-TW' }),
    Object.freeze({ code: 'zh-CN', label: '简体中文', htmlLang: 'zh-Hans', formatLocale: 'zh-CN' }),
  ]),
});

export const configuredLocales = Object.freeze(localeConfig.locales.map(({ code }) => code));
export const localeByCode = Object.freeze(Object.fromEntries(localeConfig.locales.map(locale => [locale.code, locale])));
