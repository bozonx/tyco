import csCZ from '../src/lib/i18n/locales/cs-CZ.json' with { type: 'json' }
import deDE from '../src/lib/i18n/locales/de-DE.json' with { type: 'json' }
import elGR from '../src/lib/i18n/locales/el-GR.json' with { type: 'json' }
import enUS from '../src/lib/i18n/locales/en-US.json' with { type: 'json' }
import es from '../src/lib/i18n/locales/es.json' with { type: 'json' }
import frFR from '../src/lib/i18n/locales/fr-FR.json' with { type: 'json' }
import hrHR from '../src/lib/i18n/locales/hr-HR.json' with { type: 'json' }
import huHU from '../src/lib/i18n/locales/hu-HU.json' with { type: 'json' }
import itIT from '../src/lib/i18n/locales/it-IT.json' with { type: 'json' }
import jaJP from '../src/lib/i18n/locales/ja-JP.json' with { type: 'json' }
import kaGE from '../src/lib/i18n/locales/ka-GE.json' with { type: 'json' }
import kkKZ from '../src/lib/i18n/locales/kk-KZ.json' with { type: 'json' }
import koKR from '../src/lib/i18n/locales/ko-KR.json' with { type: 'json' }
import plPL from '../src/lib/i18n/locales/pl-PL.json' with { type: 'json' }
import ptBR from '../src/lib/i18n/locales/pt-BR.json' with { type: 'json' }
import roRO from '../src/lib/i18n/locales/ro-RO.json' with { type: 'json' }
import ruRU from '../src/lib/i18n/locales/ru-RU.json' with { type: 'json' }
import trTR from '../src/lib/i18n/locales/tr-TR.json' with { type: 'json' }
import ukUA from '../src/lib/i18n/locales/uk-UA.json' with { type: 'json' }
import zhCN from '../src/lib/i18n/locales/zh-CN.json' with { type: 'json' }
import zhTW from '../src/lib/i18n/locales/zh-TW.json' with { type: 'json' }

import { expect, test } from './support/fixtures'

const LOCALES = {
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

// Missing keys fail through the vue-i18n warnings the fixture collects.
for (const [locale, messages] of Object.entries(LOCALES)) {
  test(`main pages render in ${locale}`, async ({ page, desktop }) => {
    desktop.userConfig.language.ui = locale
    await page.goto('/')
    const banner = page.getByRole('banner')

    await expect(
      page.getByRole('textbox', { name: messages.editor.inputLabel })
    ).toBeVisible()

    await banner.getByRole('button', { name: messages.nav.history }).click()
    await expect(
      page.getByRole('searchbox', {
        name: messages.input.historySearchPlaceholder,
      })
    ).toBeVisible()

    await banner.getByRole('button', { name: messages.nav.settings }).click()
    await expect(
      page.getByRole('radiogroup', { name: messages.settings.theme })
    ).toBeVisible()
  })
}
