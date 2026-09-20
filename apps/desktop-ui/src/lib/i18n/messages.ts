import en_US from './locales/en_US.json'
import es_AR from './locales/es_AR.json'
import ru_RU from './locales/ru_RU.json'
import tr_TR from './locales/tr_TR.json'

export const DEFAULT_UI_LOCALE = 'en_US'

export const messages = { ru_RU, en_US, es_AR, tr_TR }

export type UiLocale = keyof typeof messages
