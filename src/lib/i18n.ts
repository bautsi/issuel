import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import zhTW from '@/locales/zh-TW.json'

let language = 'en'
try {
  const saved = window.localStorage.getItem('issuel:language')
  if (saved === 'en' || saved === 'zh-TW') language = saved
} catch {
  // An unavailable preference store must not prevent opening the app.
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'zh-TW': { translation: zhTW } },
  lng: language,
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh-TW'],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
})

document.documentElement.lang = language
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
  try {
    window.localStorage.setItem('issuel:language', language)
  } catch {
    // Switching languages still works for this visit without local storage.
  }
})

export default i18n
