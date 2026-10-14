import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/ui-catalog.html')
  await expect(
    page.getByRole('heading', { name: 'TyCo UI catalog' })
  ).toBeVisible()
})

test('menus, tabs and native dialogs preserve keyboard focus', async ({
  page,
}) => {
  const tabs = page.getByRole('tab')
  await tabs.first().focus()
  await page.keyboard.press('End')
  await expect(tabs.last()).toBeFocused()
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')

  const trigger = page.getByRole('button', { name: 'Actions', exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem').last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  const editorTrigger = page.getByRole('button', { name: 'Open editor menu' })
  await editorTrigger.click()
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('menuitem', { name: 'First action' })
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('menuitem', { name: 'Nested actions' })
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('menuitem', { name: 'Child action' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('menuitem', { name: 'Nested actions' })
  ).toBeFocused()
  await page.keyboard.press('Home')
  await expect(
    page.getByRole('menuitem', { name: 'First action' })
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('menu')).toHaveCount(0)

  const dialogTrigger = page.getByRole('button', {
    name: 'Open dialog',
    exact: true,
  })
  await dialogTrigger.click()
  const dialog = page.getByRole('dialog', { name: 'Delete item?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeFocused()
  await dialogTrigger.evaluate((el) => el.focus())
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(dialogTrigger).toBeFocused()

  const nestedTrigger = page.getByRole('button', {
    name: 'Open nested dialogs',
  })
  await nestedTrigger.click()
  const innerTrigger = page.getByRole('button', { name: 'Open confirmation' })
  await innerTrigger.click()
  await page.keyboard.press('Escape')
  await expect(innerTrigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(nestedTrigger).toBeFocused()
})

for (const theme of ['Light', 'Dark', 'E-ink']) {
  for (const width of [480, 1000]) {
    test(`${theme} at ${width}px and 150% scale`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.getByText(theme, { exact: true }).click()
      await expect(
        page.getByRole('radio', { name: theme, exact: true })
      ).toBeChecked()
      await page.getByLabel('High contrast', { exact: true }).check()
      await page.getByLabel('Reduced motion', { exact: true }).check()
      await page
        .getByLabel('Interface scale', { exact: true })
        .selectOption('2')
      await expect(page.locator('html')).toHaveAttribute(
        'data-motion',
        'reduce'
      )
      expect(
        await page
          .locator('html')
          .evaluate((el) => getComputedStyle(el).fontSize)
      ).toBe('24px')
      const overflow = await page
        .locator('.ui-catalog')
        .evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(overflow).toBe(false)
      if (theme === 'E-ink') {
        expect(
          await page
            .locator('.catalog-quick-surface')
            .evaluate((el) => getComputedStyle(el).backdropFilter)
        ).toBe('none')
      }
      const sections = page.locator('.catalog-section')
      for (let index = 0; index < (await sections.count()); index++) {
        await sections
          .nth(index)
          .screenshot({ path: testInfo.outputPath(`section-${index}.png`) })
      }
      await page.screenshot({
        path: testInfo.outputPath('catalog.png'),
        fullPage: true,
      })
    })
  }
}
