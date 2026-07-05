import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    // Only load essential namespaces eagerly; others are lazy-loaded on
    // demand by HttpBackend when components call useTranslation().
    ns: ['common', 'nav'],
    partialBundledLanguages: true,
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'i18nextLng',
    },
    backend: {
      // import.meta.env.BASE_URL tracks the Vite `base` config (the app is
      // served under /admin/), so this resolves correctly in dev and build.
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: true,
    },
  });

export default i18n;
