import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig, ScriptExecutionResult } from '@tyco/shared'

import { createCommand } from './command-config'
import {
  type CommandRunnerDependencies,
  createCommandRunner,
} from './command-runner'

const script = (
  toolConfig: Record<string, unknown> = {},
  extra: Partial<CommandConfig> = {}
): CommandConfig => ({
  ...createCommand('script', 's-1'),
  name: 'Echo',
  toolConfig: { command: 'echo 123', takesText: true, ...toolConfig },
  ...extra,
})

const webhook = (
  toolConfig: Record<string, unknown> = {},
  extra: Partial<CommandConfig> = {}
): CommandConfig => ({
  ...createCommand('webhook', 'wh-1'),
  name: 'My Webhook',
  toolConfig: {
    url: 'https://api.example.com/endpoint',
    takesText: true,
    ...toolConfig,
  },
  ...extra,
})

const result = (
  extra: Partial<ScriptExecutionResult> = {}
): ScriptExecutionResult => ({
  success: true,
  exitCode: 0,
  stdout: '',
  stderr: '',
  running: false,
  ...extra,
})

function setup(extra: Partial<CommandRunnerDependencies> = {}) {
  const deps = {
    showToast: vi.fn(),
    showError: vi.fn(),
    showResultMenu: vi.fn(),
    closeWindow: vi.fn(),
    ...extra,
  }
  return { deps, runner: createCommandRunner(deps) }
}

describe('script commands', () => {
  it('warns when the command is empty', async () => {
    const executeScriptAction = vi.fn()
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script({ command: '  ' }), 'x')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptEmptyCommand',
      'warn'
    )
    expect(executeScriptAction).not.toHaveBeenCalled()
  })

  it('runs the command and closes the window', async () => {
    const executeScriptAction = vi.fn().mockResolvedValue(result())
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(
      script({ workingDir: ' /tmp ' }, { logOutput: true }),
      'input'
    )

    expect(executeScriptAction).toHaveBeenCalledWith({
      name: 'Echo',
      command: 'echo 123',
      workingDir: '/tmp',
      text: 'input',
      captureOutput: false,
      logOutput: true,
    })
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptSuccess',
      'success'
    )
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('gives no text to a command that takes none', async () => {
    const executeScriptAction = vi.fn().mockResolvedValue(result())
    const { runner } = setup({ executeScriptAction })
    await runner.run(script({ takesText: false }), 'ignored')
    expect(executeScriptAction.mock.calls[0][0].text).toBe('')
  })

  it('reports a command left running in the background', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ success: false, running: true }))
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script(), 'input')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptRunning',
      'success'
    )
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('shows why the command failed and keeps the window', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ success: false, stderr: 'bad thing' }))
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script(), 'input')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.scriptFailed',
      'bad thing'
    )
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })

  it('shows an error the backend returned', async () => {
    const executeScriptAction = vi
      .fn()
      .mockRejectedValue(new Error('Working directory `x` does not exist'))
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script(), 'input')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.scriptFailed',
      'Working directory `x` does not exist'
    )
  })

  it('opens the action menu on the output', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ stdout: 'UPPER\n' }))
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script({}, { afterRun: 'showMenu' }), 'upper')
    expect(executeScriptAction.mock.calls[0][0].captureOutput).toBe(true)
    expect(deps.showResultMenu).toHaveBeenCalledWith('UPPER', 'upper')
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })

  it('warns when there is no output to show', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ stdout: '\n' }))
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script({}, { afterRun: 'showMenu' }), 'x')
    expect(deps.showResultMenu).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.actionEmptyOutput',
      'warn'
    )
  })

  it('falls back to the command as the name', async () => {
    const executeScriptAction = vi.fn().mockResolvedValue(result())
    const { runner } = setup({ executeScriptAction })
    await runner.run(script({}, { name: '' }), 'x')
    expect(executeScriptAction.mock.calls[0][0].name).toBe('echo 123')
  })
})

describe('webhook commands', () => {
  it('warns when the url is empty', async () => {
    const { deps, runner } = setup()
    await runner.run(webhook({ url: '' }), 'x')
    expect(deps.showToast).toHaveBeenCalledWith('toast.webhookEmptyUrl', 'warn')
  })

  it('calls the webhook under the id of the command', async () => {
    const executeWebhook = vi.fn().mockResolvedValue('')
    const { deps, runner } = setup({ executeWebhook })
    await runner.run(webhook({ method: 'GET' }, { logOutput: true }), 'x')
    expect(executeWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wh-1',
        name: 'My Webhook',
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        logOutput: true,
      }),
      'x'
    )
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.webhookSuccess',
      'success'
    )
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('sends no text for a webhook that takes none', async () => {
    const executeWebhook = vi.fn().mockResolvedValue('')
    const { runner } = setup({ executeWebhook })
    await runner.run(webhook({ takesText: false }), 'ignored')
    expect(executeWebhook.mock.calls[0][1]).toBeNull()
  })

  it('opens the action menu on the answer', async () => {
    const executeWebhook = vi.fn().mockResolvedValue('{"text":"done"}')
    const { deps, runner } = setup({ executeWebhook })
    await runner.run(webhook({}, { afterRun: 'showMenu' }), 'x')
    expect(deps.showResultMenu).toHaveBeenCalledWith('done', 'x')
  })

  it('shows why the request failed', async () => {
    const executeWebhook = vi.fn().mockRejectedValue(new Error('HTTP 404'))
    const { deps, runner } = setup({ executeWebhook })
    await runner.run(webhook(), 'x')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.webhookFailed',
      'HTTP 404'
    )
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })
})

describe('commands that cannot run', () => {
  it('does not run a disabled command', async () => {
    const executeScriptAction = vi.fn()
    const { deps, runner } = setup({ executeScriptAction })
    await runner.run(script({}, { enabled: false }), 'x')
    expect(executeScriptAction).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith('toast.commandDisabled', 'warn')
  })

  it('reports a tool this build does not know', async () => {
    const { deps, runner } = setup()
    await runner.run(script({}, { toolId: 'notes.write', name: 'Note' }), 'x')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.commandUnavailable',
      'Note'
    )
  })
})
