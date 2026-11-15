import type { Page } from '@playwright/test'
import { ActivationMode } from '@tyco/shared'

import { browserTest, expect, test } from './support/fixtures'
import { installLlm } from './support/llm'
import { installQuickWindow } from './support/quick-window'

type RecordedMotion = { className: string; transform: string; duration: number }
type MotionWindow = Window & { feedbackAnimations: RecordedMotion[] }

async function recordMotion(page: Page) {
  await page.evaluate(() => {
    const entries: RecordedMotion[] = []
    ;(window as unknown as MotionWindow).feedbackAnimations = entries
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const duration = typeof options === 'number' ? options : options?.duration
      entries.push({
        className: this.className,
        transform: Array.isArray(frames)
          ? String(frames[0]?.transform ?? '')
          : '',
        duration: typeof duration === 'number' ? duration : 0,
      })
      return animate.call(this, frames, options)
    }
  })
}

const recordedMotion = (page: Page) =>
  page.evaluate(() => (window as unknown as MotionWindow).feedbackAnimations)

browserTest(
  'copy feedback confirms clipboard success without replacing its button @chromium',
  async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/ui-catalog.html')
    const copy = page.getByRole('button', { name: 'Copy command', exact: true })
    await expect(copy).toBeVisible()
    await recordMotion(page)
    const button = await copy.elementHandle()
    await copy.click()
    await expect(
      page.getByRole('button', { name: 'Copied', exact: true })
    ).toBeVisible()
    expect(await button!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'tyco-ctl run notes'
    )
    expect(await recordedMotion(page)).toContainEqual(
      expect.objectContaining({
        className: 'icon-button-symbol',
        duration: 120,
      })
    )
  }
)

test('chat keeps its send button through generation and reveals completed actions', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  desktop.userConfig.llm.models[0]!.canUseTools = true
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Enter text...' })
    .fill('Explain feedback')
  const send = await page
    .getByRole('button', { name: 'Send message', exact: true })
    .elementHandle()
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.start()
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeEnabled()
  expect(
    await send!.evaluate(
      (element) =>
        element.isConnected && element.getAttribute('aria-label') === 'Stop'
    )
  ).toBe(true)
  await llm.chunk('Visible feedback confirms the action.')
  await llm.finish()
  await expect(page.locator('.message-actions.is-completed')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true })
  ).toBeVisible()
  expect(await send!.evaluate((element) => element.isConnected)).toBe(true)
})

test.describe('quick window feedback', () => {
  test.use({
    windowLabel: 'quick',
    startMode: ActivationMode.SELECTION_ACTIONS,
  })
  for (const reduced of [false, true]) {
    test(`moves into a step and back without retaining outgoing controls (reduced motion: ${reduced})`, async ({
      page,
      desktop,
    }) => {
      installQuickWindow(desktop)
      desktop.activation.selectedText = 'Text to translate'
      desktop.userConfig.translation.provider = 'llm'
      await page.goto('/')
      await expect(
        page.getByRole('button', { name: 'Translation T', exact: true })
      ).toBeVisible()
      if (reduced)
        await page.evaluate(() => {
          document.documentElement.dataset.motion = 'reduce'
        })
      await recordMotion(page)
      await page
        .getByRole('button', { name: 'Translation T', exact: true })
        .click()
      await expect(
        page.getByRole('button', { name: /Other language/ })
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(
        page.getByRole('button', { name: 'Translation T', exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Other language/ })
      ).toHaveCount(0)
      const motions = await recordedMotion(page)
      expect(motions).toContainEqual(
        expect.objectContaining({
          className: 'overlay-body',
          transform: reduced ? 'translateX(0px)' : 'translateX(6px)',
          duration: reduced ? 60 : 160,
        })
      )
      expect(motions).toContainEqual(
        expect.objectContaining({
          className: 'quick-mode-layer',
          transform: reduced ? 'translateX(0px)' : 'translateX(-6px)',
          duration: reduced ? 60 : 160,
        })
      )
      await page.screenshot({
        path: `test-results/feedback-quick-${reduced ? 'reduced' : 'normal'}.png`,
      })
    })
  }
})
