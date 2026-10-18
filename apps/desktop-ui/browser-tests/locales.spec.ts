import en_US from '../src/lib/i18n/locales/en_US.json' with { type: 'json' }
import es_AR from '../src/lib/i18n/locales/es_AR.json' with { type: 'json' }
import ru_RU from '../src/lib/i18n/locales/ru_RU.json' with { type: 'json' }
import tr_TR from '../src/lib/i18n/locales/tr_TR.json' with { type: 'json' }

import { expect, test } from './support/fixtures'

const LOCALES = { en_US, es_AR, ru_RU, tr_TR }

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
