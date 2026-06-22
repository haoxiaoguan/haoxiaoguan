import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCNCommon from '../locales/zh-CN/common.json';
import zhCNNav from '../locales/zh-CN/nav.json';
import zhCNDashboard from '../locales/zh-CN/dashboard.json';
import zhCNTranslation from '../locales/zh-CN/translation.json';
import zhCNAccounts from '../locales/zh-CN/accounts.json';
import zhCNOnboarding from '../locales/zh-CN/onboarding.json';
import zhCNProxy from '../locales/zh-CN/proxy.json';
import zhCNAnalytics from '../locales/zh-CN/analytics.json';

import enCommon from '../locales/en/common.json';
import enNav from '../locales/en/nav.json';
import enDashboard from '../locales/en/dashboard.json';
import enTranslation from '../locales/en/translation.json';
import enAccounts from '../locales/en/accounts.json';
import enOnboarding from '../locales/en/onboarding.json';
import enProxy from '../locales/en/proxy.json';
import enAnalytics from '../locales/en/analytics.json';

import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';

/** Supported languages */
export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/**
 * Detect the user's preferred language from the OS.
 * Falls back to 'en' if the OS language is not supported.
 */
function detectOSLanguage(): string {
  const nav = navigator.language || navigator.languages?.[0] || 'en';
  // Normalize: zh-CN, zh-TW → zh-CN; en-US, en-GB → en
  const normalized = nav.toLowerCase();

  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('ko')) return 'ko';
  if (normalized.startsWith('de')) return 'de';
  if (normalized.startsWith('es')) return 'es';
  if (normalized.startsWith('fr')) return 'fr';
  if (normalized.startsWith('en')) return 'en';

  // Default to English if not in supported list
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      translation: zhCNTranslation,
      common: zhCNCommon,
      nav: zhCNNav,
      dashboard: zhCNDashboard,
      accounts: zhCNAccounts,
      onboarding: zhCNOnboarding,
      proxy: zhCNProxy,
      analytics: zhCNAnalytics,
    },
    en: {
      translation: enTranslation,
      common: enCommon,
      nav: enNav,
      dashboard: enDashboard,
      accounts: enAccounts,
      onboarding: enOnboarding,
      proxy: enProxy,
      analytics: enAnalytics,
    },
    ja: { translation: ja },
    ko: { translation: ko },
    de: { translation: de },
    es: { translation: es },
    fr: { translation: fr },
  },
  lng: detectOSLanguage(),
  fallbackLng: 'zh-CN',
  defaultNS: 'common',
  ns: ['common', 'nav', 'dashboard', 'translation', 'accounts', 'onboarding', 'proxy'],
  fallbackNS: 'translation',
  interpolation: {
    escapeValue: false, // React already escapes
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;

/**
 * Change the current language.
 * Call this from the settings store when the user switches language.
 */
export function changeLanguage(lang: string): Promise<void> {
  return i18n.changeLanguage(lang).then(() => undefined);
}
