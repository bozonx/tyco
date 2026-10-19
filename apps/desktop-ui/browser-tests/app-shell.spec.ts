import { DESKTOP_EVENTS } from '@tyco/shared'

import { expect, test } from './support/fixtures'

test('starts from the desktop state without unknown commands', async ({
  page,
  desktop,
}) => {
  await page.goto('/')

  await expect(page.getByRole('textbox', { name: 'Text editor' })).toBeVisible()
  expect(desktop.callsOf('get_desktop_state')).toHaveLength(1)
  expect([...desktop.unhandledCommands]).toEqual([])
})

test('navigates between the main pages', async ({ page }) => {
  await page.goto('/')
  const banner = page.getByRole('banner')

  await banner.getByRole('button', { name: 'History' }).click()
  await expect(
    page.getByRole('searchbox', { name: 'Search history...' })
  ).toBeVisible()

  await banner.getByRole('button', { name: 'Settings' }).click()
  await expect(
    page.getByRole('heading', { name: 'General', level: 1 })
  ).toBeVisible()

  await banner.getByRole('button', { name: 'Editor' }).click()
  await expect(page.getByRole('textbox', { name: 'Text editor' })).toBeVisible()
})

// WebKit cannot grant clipboard-write; verify the real clipboard in Chromium.
test.describe('copying', { tag: '@chromium' }, () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('copies the editor text and records it in the history', async ({
    page,
    desktop,
  }) => {
    await page.goto('/')
    await page.getByRole('textbox', { name: 'Text editor' }).click()
    await page.keyboard.type('Hello from the editor')

    await page.getByRole('button', { name: 'Copy', exact: true }).click()

    await expect(page.getByText('Copied')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Hello from the editor'
    )
    await expect
      .poll(() => desktop.history.map(({ text, kind }) => ({ text, kind })))
      .toEqual([{ text: 'Hello from the editor', kind: 'output' }])
  })
})

test('opens text the desktop sends to the main editor', async ({
  page,
  desktop,
}) => {
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'History' })
    .click()

  await desktop.emit(DESKTOP_EVENTS.OPEN_MAIN_EDITOR, {
    text: 'Text from another window',
  })

  await expect(page.getByRole('textbox', { name: 'Text editor' })).toHaveText(
    'Text from another window'
  )
})

test('applies a config changed by another window', async ({
  page,
  desktop,
}) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Text editor' })).toBeVisible()
  desktop.userConfig.appearance.theme = 'eInk'

  await desktop.emit(DESKTOP_EVENTS.STATE_CHANGED, {
    ...desktop.snapshot(),
    revision: 100,
  })

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'eInk')
})
