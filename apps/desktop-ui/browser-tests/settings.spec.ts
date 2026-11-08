import type { Page } from '@playwright/test'

import { installLlm } from './support/llm'
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
  await expect.poll(() => desktop.userConfig.appearance.theme).toBe('dark')

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
  await expect.poll(() => desktop.userConfig.appearance.theme).toBe('dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('configures a connection and model through settings and uses them in chat', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop, false)
  desktop.userConfig.llm.models = []
  desktop.userConfig.llm.tasks.chat.modelId = ''
  await page.reload()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'LLM', exact: true }).click()
  await page
    .getByRole('button', { name: 'Add connection', exact: true })
    .click()
  const connection = page.locator('.connection-card').last()
  await connection
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Browser connection')
  await connection
    .getByRole('textbox', { name: 'Base URL', exact: true })
    .fill('http://llm.invalid/v1')
  await connection
    .getByRole('button', { name: 'Add model', exact: true })
    .click()
  const model = connection.locator('.model-row')
  await model
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Browser model')
  await model
    .getByRole('textbox', { name: 'Model ID', exact: true })
    .fill('browser-model')
  await expect
    .poll(() =>
      desktop.userConfig.llm.models.some(
        (item) => item.providerModelId === 'browser-model'
      )
    )
    .toBe(true)
  await page.reload()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Enter text...' })
    .fill('Use the saved connection')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.start()
  expect(JSON.parse(llm.requests[0]!.body).model).toBe('browser-model')
  await llm.chunk('The saved model works.')
  await llm.finish()
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'The saved model works.' })
  ).toBeVisible()
})

test('creates a project with Enter and explains invalid edits', async ({
  page,
  desktop,
}) => {
  desktop.userConfig.isInDevelopment = true
  desktop.handle('create_ai_project', () => {})
  desktop.handle('save_ai_project', () => {})
  await page.reload()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'AI Profiles', exact: true }).click()
  await page.getByRole('button', { name: 'New Project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog
    .getByRole('textbox', { name: 'Project Name' })
    .fill('Browser project')
  await dialog.getByRole('textbox', { name: 'Project Name' }).press('Enter')
  const name = page.getByRole('textbox', { name: 'Project Name' })
  await expect(name).toHaveValue('Browser project')
  await name.fill('')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(
    page.getByText('Enter a name; changes are not saved until then.')
  ).toBeVisible()
  expect(desktop.callsOf('save_ai_project')).toHaveLength(0)
  await name.fill('Renamed project')
  await expect.poll(() => desktop.callsOf('save_ai_project').length).toBe(1)
  expect(desktop.callsOf('create_ai_project')).toHaveLength(1)
})
