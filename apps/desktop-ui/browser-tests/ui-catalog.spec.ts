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
      await expect(page.locator('.catalog-standard-controls')).toHaveScreenshot(
        `standard-controls-${theme.toLowerCase()}-${width}.png`
      )
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

test('navigation, disclosures and field messages retain their accessible relationships', async ({
  page,
}) => {
  const navigation = page.getByRole('navigation', {
    name: 'Example navigation',
  })
  const plugin = navigation.getByRole('button', { name: 'Example plugin' })
  await plugin.click()
  await expect(plugin).toHaveAttribute('aria-current', 'page')
  await expect(
    navigation.getByRole('button', { name: 'General' })
  ).not.toHaveAttribute('aria-current')

  const disclosure = page.getByRole('button', { name: /Connection settings/ })
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#catalog-details')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#catalog-details')).toHaveCount(0)

  const field = page.getByRole('textbox', {
    name: 'Multiple errors',
    exact: true,
  })
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription(
    'A value is required The value must be unique'
  )
  await expect(
    page.getByRole('textbox', { name: 'Warnings', exact: true })
  ).toHaveAccessibleDescription(
    'Inherited from plugin settings Check the selected value'
  )
  await expect(
    page.getByRole('textbox', { name: 'Disabled compact field', exact: true })
  ).toBeDisabled()
})

test('grouped fields, compact notices and preview scroll ownership', async ({
  page,
}) => {
  const group = page.getByRole('group', { name: 'Connection endpoints' })
  await expect(group).toBeVisible()
  await expect(
    group.getByRole('textbox', { name: 'Primary endpoint' })
  ).toBeDisabled()
  await expect(
    group.getByRole('textbox', { name: 'Secondary endpoint' })
  ).toBeDisabled()
  await expect(
    group.getByRole('textbox', { name: 'Primary endpoint' })
  ).toHaveAccessibleDescription('Both addresses are required')
  await expect(
    page.getByRole('status').filter({ hasText: 'Connection verified' })
  ).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Attachment needs attention' })
  ).toBeVisible()
  await expect(page.getByText('Passive guidance')).not.toHaveAttribute('role')

  const preview = page.locator('.catalog-preview pre.is-plain')
  expect(
    await preview.evaluate((el) => getComputedStyle(el).borderTopWidth)
  ).toBe('0px')
  expect(
    await preview.evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true)
  await preview.evaluate((el) => {
    el.scrollTop = 100
  })
  expect(await preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(
    await page
      .locator('.catalog-preview pre:not(.is-plain)')
      .evaluate((el) => getComputedStyle(el).borderTopWidth)
  ).toBe('1px')
  await expect(page.locator('.audio-waveform-container.is-inline')).toHaveCount(
    2
  )
})

test('standard controls distinguish selection, switching and interactive help', async ({
  page,
}) => {
  const section = page.locator('.catalog-standard-controls')
  await section.getByRole('checkbox', { name: 'Select this item' }).check()
  await expect(
    section.getByRole('checkbox', { name: 'Select this item' })
  ).toBeChecked()
  await section.getByRole('switch', { name: 'Enable this feature' }).check()
  await expect(
    section.getByRole('switch', { name: 'Enable this feature' })
  ).toBeChecked()

  const input = section.getByRole('textbox', {
    name: 'Small input',
    exact: true,
  })
  await input.focus()
  await section
    .getByRole('button', { name: 'Enter Run 0', exact: true })
    .click()
  await expect(input).toBeFocused()
  await expect(
    section.getByRole('button', { name: 'Enter Run 1', exact: true })
  ).toBeVisible()

  const help = section.getByRole('button', {
    name: 'Interactive help',
    exact: true,
  })
  await help.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Interactive help' })
  const copy = panel.getByRole('button', { name: 'Copy command 0' })
  await expect(panel).toBeVisible()
  await expect(copy).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    panel.getByRole('button', { name: 'Copy command 1' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(help).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Tab')
  await expect(help).toBeFocused()
  await expect(panel).not.toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(
    section.getByRole('button', { name: 'After help' })
  ).toBeFocused()
  await expect(panel).not.toBeVisible()
})

test('embedded controls adapt to container width on a wide viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 1000 })
  const section = page
    .locator('.catalog-section')
    .filter({
      has: page.getByRole('heading', { name: 'Navigation and menus' }),
    })
  const navigation = page.getByRole('navigation', {
    name: 'Example navigation',
  })
  await navigation.evaluate((el) => {
    ;(el as HTMLElement).style.width = '100px'
  })
  await expect(navigation.locator('.navigation-label').first()).toBeHidden()
  await navigation.evaluate((el) => {
    ;(el as HTMLElement).style.width = '300px'
  })
  await expect(navigation.locator('.navigation-label').first()).toBeVisible()
  const segmented = section.getByRole('radiogroup', { name: 'Value selection' })
  await expect(segmented).toBeVisible()
  const preview = page.locator('.split-preview-container').first()
  await preview.evaluate((el) => {
    ;(el as HTMLElement).style.width = '300px'
  })
  expect(
    await preview
      .locator('.split-panes')
      .evaluate((el) => getComputedStyle(el).flexDirection)
  ).toBe('column')
})
