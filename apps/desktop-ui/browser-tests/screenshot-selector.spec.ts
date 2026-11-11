import { DESKTOP_EVENTS } from '@tyco/shared'

import { expect, test } from './support/fixtures'
import { installQuickWindow } from './support/quick-window'

test.use({ windowLabel: 'quick', viewport: { width: 1024, height: 768 } })

test('selects at every screen edge, reverses direction and keeps controls visible', async ({
  page,
  desktop,
}) => {
  installQuickWindow(desktop)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  )
  desktop.handle('read_chat_image', () => Uint8Array.from(png).buffer)
  await page.goto('/')
  await expect(page.locator('.quick-overlay-card')).toBeVisible()
  await desktop.emit(DESKTOP_EVENTS.SCREENSHOT_SELECT_AREA, {
    selectionId: 1,
    imageId: 'screen',
    mediaType: 'image/png',
    screenX: 0,
    screenY: 0,
    width: 2048,
    height: 1536,
    scaleFactor: 2,
  })
  const selector = page.locator('.screenshot-selector-root')
  await expect(selector.locator('img')).toBeVisible()
  await expect
    .poll(() =>
      selector
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(1)
  const confirm = selector.locator('.selection-confirm')
  const badge = selector.locator('.selection-badge')

  for (const [x, y] of [
    [0, 0],
    [1023, 0],
    [0, 767],
    [1023, 767],
  ]) {
    await page.mouse.move(512, 384)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 5 })
    await expect(badge).toBeVisible()
    await page.mouse.move(600, 500, { steps: 5 })
    await expect(badge).toHaveText('176 × 232 px')
    await page.mouse.move(x, y, { steps: 5 })
    await page.mouse.up()
    for (const element of [confirm, badge]) {
      const bounds = await element.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768)
    }
  }
  for (const [from, to] of [
    [
      [0, 0],
      [4, 4],
    ],
    [
      [1023, 767],
      [1019, 763],
    ],
  ] as const) {
    await page.mouse.move(from[0], from[1])
    await page.mouse.down()
    await page.mouse.move(to[0], to[1])
    await page.mouse.up()
    for (const element of [confirm, badge]) {
      const bounds = await element.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768)
    }
  }
  // Clicking confirmation must work without scrolling the frozen image.
  await confirm.click()
  await expect
    .poll(() => desktop.callsOf('confirm_screenshot_crop'))
    .toEqual([
      { selectionId: 1, crop: { x: 2038, y: 1526, width: 8, height: 8 } },
    ])
  expect(
    await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  ).toEqual({ x: 0, y: 0 })
})
