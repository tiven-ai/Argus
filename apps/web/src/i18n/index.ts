import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import ja from './locales/ja.json'

/**
 * Supported locale codes. Order matters: the first entry is the default the
 * detector falls back to when neither localStorage nor the browser yields a
 * usable match.
 */
export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      ja: { translation: ja },
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      // localStorage > browser navigator. Persist the explicit choice.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'argus.lang',
      caches: ['localStorage'],
    },
  })

export default i18n
