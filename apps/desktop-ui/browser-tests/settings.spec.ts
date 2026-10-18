import type { Page } from '@playwright/test'

import { FakeDesktopError } from './support/fake-desktop'
import { expect, test } from './support/fixtures'

// the radio input is visually hidden behind its label
const themeOption = (page: Page, label: string) =>
  page
    .getByRole('radiogroup', { name: 'Theme' })
    .getByText(label, { exact: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
})

test('saves a changed setting and applies it', async ({ page, desktop }) => {
  await themeOption(page, 'Dark').click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('status')).toHaveText('Saved')
  expect(desktop.userConfig.appearance.theme).toBe('dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
  await expect(
    page.getByRole('radio', { name: 'Dark', exact: true })
  ).toBeChecked()
})

test('reports a failed save', async ({ page, desktop }) => {
  desktop.handle('save_user_config', () => {
    throw new FakeDesktopError({ code: 'ioError', message: 'Disk is full' })
  })

  await themeOption(page, 'Dark').click()

  await expect(page.getByText('Settings could not be saved')).toBeVisible()
  expect(desktop.userConfig.appearance.theme).toBe('auto')
})

test('retries a failed save and keeps the saved value after reload', async ({
  page,
  desktop,
}) => {
  let canSave = false
  desktop.handle('save_user_config', ({ userConfig }) => {
    if (!canSave)
      throw new FakeDesktopError({
        code: 'invalidInput',
        message: 'Save rejected for browser test',
      })
    desktop.userConfig = structuredClone(userConfig)
    return { ...desktop.snapshot(), revision: 2 }
  })
  await themeOption(page, 'Dark').click()
  await expect(page.getByText('Settings could not be saved')).toBeVisible()
  canSave = true
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await expect.poll(() => desktop.userConfig.appearance.theme).toBe('dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
