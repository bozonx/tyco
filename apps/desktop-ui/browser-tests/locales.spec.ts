import enUS from '../src/lib/i18n/locales/en-US.json' with { type: 'json' }
import esAR from '../src/lib/i18n/locales/es-AR.json' with { type: 'json' }
import ruRU from '../src/lib/i18n/locales/ru-RU.json' with { type: 'json' }
import trTR from '../src/lib/i18n/locales/tr-TR.json' with { type: 'json' }

import { expect, test } from './support/fixtures'

const LOCALES = { 'en-US': enUS, 'es-AR': esAR, 'ru-RU': ruRU, 'tr-TR': trTR }

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
