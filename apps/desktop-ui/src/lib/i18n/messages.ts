import csCZ from './locales/cs-CZ.json'
import deDE from './locales/de-DE.json'
import elGR from './locales/el-GR.json'
import enUS from './locales/en-US.json'
import es from './locales/es.json'
import frFR from './locales/fr-FR.json'
import hrHR from './locales/hr-HR.json'
import huHU from './locales/hu-HU.json'
import itIT from './locales/it-IT.json'
import jaJP from './locales/ja-JP.json'
import kaGE from './locales/ka-GE.json'
import kkKZ from './locales/kk-KZ.json'
import koKR from './locales/ko-KR.json'
import plPL from './locales/pl-PL.json'
import ptBR from './locales/pt-BR.json'
import roRO from './locales/ro-RO.json'
import ruRU from './locales/ru-RU.json'
import trTR from './locales/tr-TR.json'
import ukUA from './locales/uk-UA.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

export const DEFAULT_UI_LOCALE = 'en-US'

export const messages = {
  'en-US': enUS,
  'ru-RU': ruRU,
  'de-DE': deDE,
  'fr-FR': frFR,
  es,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pl-PL': plPL,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'cs-CZ': csCZ,
  'hu-HU': huHU,
  'ro-RO': roRO,
  'el-GR': elGR,
  'hr-HR': hrHR,
  'ka-GE': kaGE,
  'kk-KZ': kkKZ,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
}

export type UiLocale = keyof typeof messages
