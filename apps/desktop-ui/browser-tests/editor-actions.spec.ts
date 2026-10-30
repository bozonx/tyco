import { expect, test } from './support/fixtures'
import { installLlm } from './support/llm'

test('reviews a correction and applies the result to the editor', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Text editor' })
  await editor.fill('A sentense with a typo.')
  await page
    .locator('.editor-root')
    .getByRole('button', { name: 'Correction', exact: true })
    .click()
  await llm.answer('A sentence with a typo.')
  await expect(
    page.getByRole('button', { name: /Replace in editor/ })
  ).toBeVisible()
  await page.getByRole('button', { name: /Replace in editor/ }).click()
  await expect(editor).toHaveText('A sentence with a typo.')
  await expect
    .poll(() => desktop.history.find((item) => item.kind === 'source')?.result)
    .toBe('A sentence with a typo.')
})

test('enables a plugin, uses its editor action and disables it', async ({
  page,
  desktop,
}) => {
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'Text case', exact: true }).click()
  await page.getByRole('switch').check()
  await expect
    .poll(() => desktop.userConfig.plugins.TextCase?.isEnabled)
    .toBe(true)
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Editor', exact: true })
    .click()
  const editor = page.getByRole('textbox', { name: 'Text editor' })
  await editor.fill('hello browser')
  await page.getByRole('button', { name: 'Case', exact: true }).click()
  await page.getByRole('menuitem', { name: 'snake_case', exact: true }).click()
  await expect(editor).toHaveText('hello_browser')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'Text case', exact: true }).click()
  await page.getByRole('switch').uncheck()
  await expect
    .poll(() => desktop.userConfig.plugins.TextCase?.isEnabled)
    .toBe(false)
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Editor', exact: true })
    .click()
  await page.getByRole('button', { name: 'Case', exact: true }).click()
  await expect(
    page.getByRole('menuitem', { name: 'snake_case', exact: true })
  ).toHaveCount(0)
  expect(desktop.userConfig.plugins.TextCase).toMatchObject({
    isEnabled: false,
    settings: {},
  })
})

test('translates into a chosen language and applies the result', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  desktop.userConfig.translation.provider = 'llm'
  desktop.userConfig.translation.qualityGate = 'off'
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Text editor' })
  await editor.fill('Good morning, everyone.')
  await page
    .locator('.editor-root')
    .getByRole('button', { name: 'Translation', exact: true })
    .click()
  await page.getByRole('button', { name: /Other language/ }).click()
  await page
    .getByRole('combobox', { name: 'Search the target language…', exact: true })
    .fill('Spanish')
  await page.keyboard.press('Enter')
  await llm.answer('Buenos días a todos.')
  expect(llm.requests[0]!.body).toContain('Good morning, everyone.')
  expect(llm.requests[0]!.body).toMatch(
    /Translate the source_text block to (European Spanish \(es-ES\)|es)/
  )
  await page.getByRole('button', { name: /Replace in editor/ }).click()
  await expect(editor).toHaveText('Buenos días a todos.')
})
