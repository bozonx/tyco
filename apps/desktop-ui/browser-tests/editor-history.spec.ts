import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures'

test.beforeEach(async ({ page, desktop }) => {
  const now = Date.now()
  desktop.history = [
    { id: 'sent', text: 'Sent text', kind: 'output', createdAt: now - 60_000 },
    {
      id: 'draft',
      text: 'Draft text',
      kind: 'draft',
      createdAt: now - 120_000,
    },
  ]
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'History' })
    .click()
})

const historyItem = (page: Page, id: string) =>
  page.locator(`[data-history-id="${id}"]`)

// item actions appear on hover, as for a mouse user
const itemAction = async (page: Page, id: string, name: string) => {
  const item = historyItem(page, id)
  await item.hover()
  return item.getByRole('button', { name })
}

test('lists the stored texts and filters them', async ({ page }) => {
  await expect(historyItem(page, 'sent')).toContainText('Sent text')
  await expect(historyItem(page, 'draft')).toContainText('Draft text')

  await page.getByRole('searchbox', { name: 'Search history...' }).fill('draft')

  await expect(historyItem(page, 'draft')).toBeVisible()
  await expect(historyItem(page, 'sent')).toHaveCount(0)
})

test('removes an item and restores it on undo', async ({ page, desktop }) => {
  await (await itemAction(page, 'draft', 'Remove from history')).click()

  await expect(historyItem(page, 'draft')).toHaveCount(0)
  await expect
    .poll(() => desktop.callsOf('delete_editor_history_item'))
    .toEqual([{ id: 'draft' }])

  await page.getByRole('button', { name: 'Undo' }).click()

  await expect(historyItem(page, 'draft')).toBeVisible()
  expect(desktop.history.map((item) => item.id)).toContain('draft')
})

test('puts an item into the editor', async ({ page }) => {
  await (await itemAction(page, 'sent', 'Put into editor')).click()

  await expect(page.getByRole('textbox', { name: 'Text editor' })).toHaveText(
    'Sent text'
  )
})
