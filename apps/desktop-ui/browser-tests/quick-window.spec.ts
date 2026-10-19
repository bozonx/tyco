import { StartMode } from '@tyco/shared'

import { expect, test } from './support/fixtures'
import { installQuickWindow } from './support/quick-window'

test.use({ windowLabel: 'quick' })

test.describe('quick input', () => {
  test.use({ startMode: StartMode.WRITE })

  test('recalls a discarded draft when the quick window opens again', async ({
    page,
    desktop,
  }) => {
    const quick = installQuickWindow(desktop)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Enter text...' })
    await input.fill('A draft to recall')
    await page.keyboard.press('Escape')
    await expect
      .poll(() => desktop.callsOf('hide_window').length)
      .toBeGreaterThan(0)
    await quick.reopen()
    await expect(input).toHaveValue('')
    await input.focus()
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveValue('A draft to recall')
  })

  test('restores a draft after focus loss and a new activation', async ({
    page,
    desktop,
  }) => {
    const quick = installQuickWindow(desktop)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Enter text...' })
    await input.fill('Keep the dismissed draft')
    await desktop.setWindowFocus(false)
    await expect
      .poll(() => desktop.callsOf('dismiss_quick_window').length)
      .toBeGreaterThan(0)
    await quick.reopen()
    await expect(input).toHaveValue('Keep the dismissed draft')
  })
})

test.describe('command launcher', () => {
  test.use({ startMode: StartMode.COMMAND_LAUNCHER })

  test('runs a command from the quick launcher and shows its result', async ({
    page,
    desktop,
  }) => {
    installQuickWindow(desktop)
    desktop.userConfig.commands = [
      {
        id: 'browser-command',
        name: 'Browser command',
        toolId: 'script',
        toolConfig: { command: 'printf browser', workingDirectory: '' },
        phrases: [],
        isEnabled: true,
        isVoiceEnabled: false,
        isLlmArgumentParsingEnabled: false,
        outputAction: 'showMenu',
        isOutputLogged: false,
        isAvailableExternally: false,
      },
    ]
    desktop.userConfig.launcherPages[0]!.slots.q = 'browser-command'
    desktop.handle('log_command_run', () => undefined)
    desktop.handle('execute_script_action', () => ({
      success: true,
      running: false,
      exitCode: 0,
      stdout: 'Browser command result',
      stderr: '',
    }))
    await page.goto('/')
    await page.getByRole('button', { name: /Browser command/ }).click()
    await expect(
      page.getByText('Browser command result', { exact: true })
    ).toBeVisible()
    await expect
      .poll(() => desktop.callsOf('execute_script_action').length)
      .toBe(1)
  })
})
