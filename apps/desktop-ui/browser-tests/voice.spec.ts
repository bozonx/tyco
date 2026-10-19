import { expect, test } from './support/fixtures'
import { installVoice } from './support/voice'

test('shows live speech and inserts the final transcript into the editor', async ({
  page,
  desktop,
}) => {
  const voice = installVoice(desktop)
  await page.goto('/')
  await page.getByRole('button', { name: 'Voice input', exact: true }).click()
  await voice.partial('A spoken draft')
  await expect(page.getByText('A spoken draft', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      desktop
        .callsOf('send_socket_binary')
        .some(({ bytes }) => bytes.byteLength > 320)
    )
    .toBe(true)
  await page.keyboard.press('Enter')
  await voice.finish('A spoken sentence.')
  await expect(page.getByRole('textbox', { name: 'Text editor' })).toHaveText(
    'A spoken sentence.'
  )
})

test('cancels recording without changing the editor', async ({
  page,
  desktop,
}) => {
  const voice = installVoice(desktop)
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Text editor' })
  await editor.fill('Keep this text')
  await page.getByRole('button', { name: 'Voice input', exact: true }).click()
  await voice.partial('Discard this speech')
  await expect(
    page.getByText('Discard this speech', { exact: true })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveText('Keep this text')
  await expect
    .poll(() => desktop.callsOf('stop_voice_capture'))
    .toContainEqual({ sessionId: 7 })
  await expect(
    page.getByText('Discard this speech', { exact: true })
  ).toHaveCount(0)
})

test('reports a disconnected speech server and releases the microphone', async ({
  page,
  desktop,
  expectDesktopError,
}) => {
  expectDesktopError(
    /Speech recognition session failed.*Speech server disconnected/s
  )
  const voice = installVoice(desktop)
  await page.goto('/')
  await page.getByRole('button', { name: 'Voice input', exact: true }).click()
  await voice.partial('Incomplete speech')
  await expect(
    page.getByText('Incomplete speech', { exact: true })
  ).toBeVisible()
  await voice.fail()
  await expect(page.getByText(/Speech server disconnected/)).toBeVisible()
  await expect
    .poll(() => desktop.callsOf('stop_voice_capture'))
    .toContainEqual({ sessionId: 7 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Text editor' })).toBeVisible()
})
