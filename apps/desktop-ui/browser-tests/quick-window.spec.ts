import { ActivationMode } from '@tyco/shared'

import { expect, test } from './support/fixtures'
import { FakeDesktop } from './support/fake-desktop'
import { installLlm } from './support/llm'
import { installQuickWindow } from './support/quick-window'

test.use({ windowLabel: 'quick' })

test.describe('quick input', () => {
  test.use({ startMode: ActivationMode.QUICK_INPUT })

  test('corrects submitted text, saves it and inserts it into the target', async ({
    page,
    desktop,
  }) => {
    const quick = installQuickWindow(desktop)
    const llm = installLlm(desktop)
    desktop.handle('paste_into_target_and_hide', () => undefined)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Enter text...' })
    await input.fill('A sentense to insert.')
    await page.getByRole('button', { name: /Correct and insert/ }).click()
    await llm.answer('A sentence to insert.')
    await expect
      .poll(() => desktop.callsOf('paste_into_target_and_hide'))
      .toEqual([
        {
          activationId: desktop.snapshot().activation.activationId,
          text: 'A sentence to insert.',
        },
      ])
    await expect
      .poll(() =>
        desktop.history.some(
          (item) =>
            item.kind === 'output' && item.text === 'A sentence to insert.'
        )
      )
      .toBe(true)
    await quick.reopen()
    await expect(input).toHaveValue('')
  })

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
      .poll(() => desktop.callsOf('hide_quick_window_on_blur').length)
      .toBeGreaterThan(0)
    await quick.reopen()
    await expect(input).toHaveValue('Keep the dismissed draft')
  })
})

test.describe('command launcher', () => {
  test.use({ startMode: ActivationMode.COMMAND_LAUNCHER })

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

test.describe('command configuration', () => {
  test.use({ windowLabel: 'main', startMode: ActivationMode.EDITOR })

  test('creates a command, assigns a launcher slot and executes it', async ({
    page,
    desktop,
  }) => {
    installQuickWindow(desktop)
    desktop.handle('log_command_run', () => undefined)
    desktop.handle('execute_script_action', () => ({
      success: true,
      running: false,
      exitCode: 0,
      stdout: 'Configured command result',
      stderr: '',
    }))
    await page.goto('/')
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Settings' })
      .click()
    await page.getByRole('button', { name: 'Commands', exact: true }).click()
    await page
      .getByRole('button', { name: 'Create a command', exact: true })
      .click()
    await page
      .locator('.tool-picker')
      .getByRole('button', { name: /Script \/ Command/ })
      .click()
    const command = page.locator('.command-card').last()
    await command
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Configured command')
    await command
      .getByRole('textbox', { name: 'Command', exact: true })
      .fill('printf configured')
    await command.getByRole('button', { name: 'Advanced', exact: true }).click()
    await command
      .getByRole('combobox', { name: 'Action', exact: true })
      .selectOption({ label: 'Show result' })
    await page
      .getByRole('button', { name: 'Quick commands', exact: true })
      .click()
    const slot = page.locator('.shortcut-slot').first()
    await slot.getByRole('button', { name: 'Add', exact: true }).click()
    await expect
      .poll(() =>
        desktop.userConfig.commands.some(
          (item) => item.name === 'Configured command'
        )
      )
      .toBe(true)
    const commandId = desktop.userConfig.commands.find(
      (item) => item.name === 'Configured command'
    )!.id
    await slot
      .getByRole('combobox')
      .selectOption({ label: 'Configured command' })
    await expect
      .poll(() => desktop.userConfig.launcherPages[0]?.slots.q)
      .toBe(commandId)
    await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
    const launcherDesktop = new FakeDesktop({
      mode: ActivationMode.COMMAND_LAUNCHER,
      userConfig: desktop.userConfig,
    })
    installQuickWindow(launcherDesktop)
    launcherDesktop.handle('log_command_run', () => undefined)
    launcherDesktop.handle('execute_script_action', () => ({
      success: true,
      running: false,
      exitCode: 0,
      stdout: 'Configured command result',
      stderr: '',
    }))
    const launcher = await page.context().newPage()
    await launcherDesktop.attach(launcher, 'quick')
    await launcher.goto('/')
    await launcher.getByRole('button', { name: /Configured command/ }).click()
    await expect(
      launcher.getByText('Configured command result', { exact: true })
    ).toBeVisible()
    expect(launcherDesktop.callsOf('execute_script_action')).toEqual([
      { request: expect.objectContaining({ commandId, captureOutput: true }) },
    ])
    expect([...launcherDesktop.unhandledCommands]).toEqual([])
    expect(
      launcherDesktop
        .callsOf('log_client_message')
        .filter(({ level }) => level === 'error')
    ).toEqual([])
  })
})
