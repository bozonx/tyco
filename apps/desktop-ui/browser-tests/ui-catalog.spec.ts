import { browserTest as test, expect } from './support/fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('/ui-catalog.html')
  await expect(
    page.getByRole('heading', { name: 'TyCo UI catalog' })
  ).toBeVisible()
})

test('menus preserve keyboard focus and nested navigation', async ({
  page,
}) => {
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
})

test('native dialogs contain focus and close one layer at a time', async ({
  page,
}) => {
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
    test(
      `${theme} at ${width}px and 150% scale`,
      { tag: '@visual' },
      async ({ page }, testInfo) => {
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
        await expect(page.locator('html')).toHaveCSS('font-size', '24px')
        await expect
          .poll(() =>
            page
              .locator('.ui-catalog')
              .evaluate((el) => el.scrollWidth > el.clientWidth)
          )
          .toBe(false)
        if (theme === 'E-ink') {
          await expect(page.locator('.catalog-quick-surface')).toHaveCSS(
            'backdrop-filter',
            'none'
          )
        }
        await expect(
          page.locator('.catalog-standard-controls')
        ).toHaveScreenshot(
          `standard-controls-${theme.toLowerCase()}-${width}.png`
        )
        await expect(
          page
            .locator('.catalog-section')
            .filter({
              has: page.getByRole('heading', {
                name: 'Navigation and menus',
                exact: true,
              }),
            })
        ).toHaveScreenshot(`navigation-${theme.toLowerCase()}-${width}.png`)
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
      }
    )
  }
}

test('navigation and disclosures respond to keyboard input', async ({
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
})

test('preview scroll ownership', async ({ page }) => {
  const preview = page.locator('.catalog-preview pre.is-plain')
  await expect(preview).toHaveCSS('border-top-width', '0px')
  expect(
    await preview.evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true)
  await preview.evaluate((el) => {
    el.scrollTop = 100
  })
  expect(await preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.catalog-preview pre:not(.is-plain)')).toHaveCSS(
    'border-top-width',
    '1px'
  )
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
  await expect(preview.locator('.split-panes')).toHaveCSS(
    'flex-direction',
    'column'
  )
})

test('floating menus stay in the viewport and resume the trigger Tab order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 900 })
  const trigger = page.getByRole('button', {
    name: 'Edge actions',
    exact: true,
  })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Edge actions' })
  await expect(menu).toBeVisible()
  await expect(async () => {
    const bounds = await menu.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
  }).toPass()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'After edge menu', exact: true })
  ).toBeFocused()
  await expect(menu).not.toBeVisible()
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+Tab')
  await expect(trigger).toBeFocused()
})

test('a menu in a native dialog stays interactive and Escape closes one layer', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open nested dialogs' }).click()
  const dialog = page.getByRole('dialog', { name: 'Outer dialog', exact: true })
  const trigger = dialog.getByRole('button', { name: 'Dialog actions' })
  await trigger.click()
  await expect(
    dialog.getByRole('menuitem', { name: 'Dialog action', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(dialog.getByRole('menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('disclosure panels link their body and shared text controls preserve selection', async ({
  page,
}) => {
  const trigger = page.getByRole('button', {
    name: 'Connection with a long descriptive name',
  })
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const bodyId = await trigger.getAttribute('aria-controls')
  await expect(page.locator(`[id="${bodyId}"]`)).toBeVisible()
  const invalid = page.getByRole('textbox', { name: 'Connection URL' })
  await expect(invalid).toHaveAttribute('aria-invalid', 'true')
  await expect(invalid).toHaveAccessibleDescription(
    'The connection URL is invalid'
  )
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  const draft = page.getByRole('textbox', { name: 'Plain draft' })
  await draft.fill('Hello world')
  await draft.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.type('Y')
  await expect(draft).toHaveValue('Yello world')
})

test('a teleported child menu keeps its parent popover open', async ({
  page,
}) => {
  const help = page.getByRole('button', { name: 'Nested help', exact: true })
  await help.click()
  const popover = page.getByRole('dialog', { name: 'Nested help' })
  const trigger = popover.getByRole('button', {
    name: 'Help actions',
    exact: true,
  })
  await trigger.click()
  await expect(
    page.getByRole('menuitem', { name: 'Help action', exact: true })
  ).toBeFocused()
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
  await expect(help).toBeFocused()
})
