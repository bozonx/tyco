import { ActivationMode, DESKTOP_EVENTS } from '@tyco/shared'

import { expect, test } from './support/fixtures'
import { FakeDesktop } from './support/fake-desktop'
import { installLlm } from './support/llm'
import { installQuickWindow } from './support/quick-window'
import { installVoice } from './support/voice'

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

  test('keeps a discarded draft only in the history', async ({
    page,
    desktop,
  }) => {
    const quick = installQuickWindow(desktop)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Enter text...' })
    await input.fill('A discarded draft')
    await page.keyboard.press('Escape')
    await expect
      .poll(() => desktop.callsOf('hide_window').length)
      .toBeGreaterThan(0)
    await expect
      .poll(() =>
        desktop.history.some(
          (item) => item.kind === 'draft' && item.text === 'A discarded draft'
        )
      )
      .toBe(true)
    await quick.reopen()
    await expect(input).toHaveValue('')
    await input.focus()
    // no recall of earlier input: the history is its only store
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveValue('')
  })

  test('keeps quick input open after focus loss and a new activation', async ({
    page,
    desktop,
  }) => {
    const quick = installQuickWindow(desktop)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: 'Enter text...' })
    await input.fill('Keep the dismissed draft')
    await desktop.setWindowFocus(false)
    await expect
      .poll(() => desktop.callsOf('hide_quick_window_on_blur'))
      .toEqual([])
    await quick.reopen()
    await expect(input).toHaveValue('Keep the dismissed draft')
  })
})

test.describe('action menu', () => {
  test.use({ startMode: ActivationMode.SELECTION_ACTIONS })

  for (const isLateCapture of [false, true]) {
    test(`shows selected context in voice commands (${isLateCapture ? 'late' : 'ready'} capture)`, async ({
      page,
      desktop,
    }) => {
      installQuickWindow(desktop)
      const voice = installVoice(desktop)
      const selectedText = 'Selected context for voice commands'
      desktop.activation.selectedText = isLateCapture ? null : selectedText
      desktop.userConfig.actionPages[0]!.slots.q = {
        type: 'standard',
        actionId: 'voiceCommands',
      }
      await page.goto('/')
      await page.getByRole('button', { name: /Voice commands/ }).click()
      await voice.partial('Ask in chat explain this')
      if (isLateCapture) {
        const state = desktop.snapshot()
        await desktop.emit(DESKTOP_EVENTS.STATE_CHANGED, {
          ...state,
          revision: state.revision + 1,
          activation: { ...state.activation, selectedText },
        })
      }
      const preview = page.locator('.voice-main pre')
      await expect(preview).toHaveText(selectedText)
      await expect(preview).toBeVisible()
      const box = await preview.boundingBox()
      expect(box!.height).toBeGreaterThan(40)
      await page.keyboard.press('Escape')
    })
  }

  test('runs a command from the action menu and shows its result', async ({
    page,
    desktop,
  }) => {
    installQuickWindow(desktop)
    desktop.userConfig.commands = [
      {
        id: 'browser-command',
        name: 'Browser command',
        description: '',
        toolId: 'script',
        toolConfig: { command: 'printf browser', workingDirectory: '' },
        phrases: [],
        isEnabled: true,
        isVoiceEnabled: false,
        isLlmArgumentParsingEnabled: false,
        outputAction: 'showMenu',
        isOutputLogged: false,
        isAvailableExternally: false,
        externalTimeoutSec: 120,
      },
    ]
    desktop.userConfig.actionPages[0]!.slots.q = {
      type: 'command',
      commandId: 'browser-command',
    }
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

  test('creates a command, assigns an action slot and executes it', async ({
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
    const createModal = page.locator('.create-command-modal')
    await createModal
      .getByRole('combobox')
      .selectOption({ label: 'Script / Command' })
    await createModal
      .getByRole('button', { name: 'Confirm', exact: true })
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
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
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
      .poll(() => desktop.userConfig.actionPages[0]?.slots.q)
      .toEqual({ type: 'command', commandId })
    const launcherDesktop = new FakeDesktop({
      mode: ActivationMode.SELECTION_ACTIONS,
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
