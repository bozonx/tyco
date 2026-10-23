import enUS from './locales/en-US.json'
import esAR from './locales/es-AR.json'
import ruRU from './locales/ru-RU.json'
import trTR from './locales/tr-TR.json'

export const DEFAULT_UI_LOCALE = 'en-US'

export const messages = {
  'ru-RU': ruRU,
  'en-US': enUS,
  'es-AR': esAR,
  'tr-TR': trTR,
}

export type UiLocale = keyof typeof messages
