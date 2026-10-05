import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig, ScriptExecutionResult } from '@tyco/shared'

import type { BuiltinToolDependencies } from '../tools/builtin-tools'
import { testTools } from '../tools/testing'
import { TEXT_INPUT_SCHEMA, type ToolDefinition } from '../tools/tool-types'
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

function setup(
  extra: Partial<CommandRunnerDependencies> & BuiltinToolDependencies = {},
  tools: readonly ToolDefinition[] = []
) {
  const {
    executeScriptAction,
    cancelScriptAction,
    executeWebhook,
    newRunId,
    ...rest
  } = extra
  const deps = {
    tools: testTools(
      { executeScriptAction, cancelScriptAction, executeWebhook, newRunId },
      tools
    ),
    showToast: vi.fn(),
    showError: vi.fn(),
    showText: vi.fn(),
    showResultMenu: vi.fn(),
    closeWindow: vi.fn(),
    ...rest,
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
    const outcome = await runner.run(
      script({ workingDir: ' /tmp ' }, { logOutput: true }),
      'input'
    )

    expect(outcome).toEqual({ success: true })

    expect(executeScriptAction).toHaveBeenCalledWith({
      name: 'Echo',
      command: 'echo 123',
      workingDir: '/tmp',
      text: 'input',
      captureOutput: false,
      logOutput: true,
      runId: expect.any(String),
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
    const outcome = await runner.run(script(), 'input')
    expect(outcome).toEqual({ success: false, message: 'bad thing' })
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
    const outcome = await runner.run(script({}, { afterRun: 'showMenu' }), 'x')
    expect(outcome.success).toBe(false)
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
      'x',
      expect.any(AbortSignal)
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
    const outcome = await runner.run(webhook(), 'x')
    expect(outcome).toEqual({ success: false, message: 'HTTP 404' })
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
    const outcome = await runner.run(script({}, { enabled: false }), 'x')
    expect(outcome.success).toBe(false)
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

describe('cancellation', () => {
  it('kills the script of a cancelled run and reports nothing', async () => {
    let fail: (error: Error) => void = () => {}
    const executeScriptAction = vi.fn(
      () =>
        new Promise<ScriptExecutionResult>((_, reject) => {
          fail = reject
        })
    )
    const cancelScriptAction = vi.fn(async () => {
      fail(new Error('Cancelled'))
      return true
    })
    const { deps, runner } = setup({
      executeScriptAction,
      cancelScriptAction,
      newRunId: () => 'run-1',
    })
    const controller = new AbortController()
    const running = runner.run(script(), 'x', { signal: controller.signal })
    await Promise.resolve()
    controller.abort()

    expect(await running).toEqual({
      success: false,
      cancelled: true,
      message: 'Cancelled',
    })
    expect(executeScriptAction).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' })
    )
    expect(cancelScriptAction).toHaveBeenCalledWith('run-1')
    expect(deps.showError).not.toHaveBeenCalled()
    expect(deps.showToast).not.toHaveBeenCalled()
  })

  it('aborts the request of a cancelled webhook', async () => {
    const executeWebhook = vi.fn(
      (_target: unknown, _text: unknown, signal?: AbortSignal) =>
        new Promise<string>((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const { deps, runner } = setup({ executeWebhook })
    const controller = new AbortController()
    const running = runner.run(webhook(), 'x', { signal: controller.signal })
    controller.abort()

    expect(await running).toMatchObject({ success: false, cancelled: true })
    expect(deps.showError).not.toHaveBeenCalled()
  })

  it('does not start a run cancelled already', async () => {
    const executeScriptAction = vi.fn()
    const { runner } = setup({ executeScriptAction })
    const controller = new AbortController()
    controller.abort()
    const outcome = await runner.run(script(), 'x', {
      signal: controller.signal,
    })
    expect(outcome.cancelled).toBe(true)
    expect(executeScriptAction).not.toHaveBeenCalled()
  })
})

describe('plugin tools', () => {
  const noteTool = (extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
    id: 'Notes.write',
    description: 'Writes a note',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: vi.fn(async () => ({ ok: true, messageKey: 'toast.noteSaved' })),
    ...extra,
  })
  const note = (extra: Partial<CommandConfig> = {}): CommandConfig => ({
    ...createCommand('script', 'n-1'),
    name: 'Note',
    toolId: 'Notes.write',
    toolConfig: { dir: '~/work' },
    ...extra,
  })

  it('calls the tool with the text, the settings and the source', async () => {
    const tool = noteTool()
    const { deps, runner } = setup({}, [tool])
    const outcome = await runner.run(note(), 'buy milk', { source: 'launcher' })
    expect(outcome).toEqual({ success: true })
    expect(tool.run).toHaveBeenCalledWith({
      input: { text: 'buy milk' },
      config: { dir: '~/work' },
      source: 'launcher',
      signal: expect.any(AbortSignal),
      command: { id: 'n-1', name: 'Note', logOutput: false },
      wantsOutput: false,
    })
    expect(deps.showToast).toHaveBeenCalledWith('toast.noteSaved', 'success')
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('keeps the window when the tool asks for it', async () => {
    const tool = noteTool({ run: async () => ({ ok: true, keepWindow: true }) })
    const { deps, runner } = setup({}, [tool])
    await runner.run(note(), 'x')
    expect(deps.closeWindow).not.toHaveBeenCalled()
    expect(deps.showToast).not.toHaveBeenCalled()
  })

  it('shows a plain message of the tool as it is', async () => {
    const tool = noteTool({
      run: async () => ({ ok: false, message: 'Folder is read-only' }),
    })
    const { deps, runner } = setup({}, [tool])
    const outcome = await runner.run(note(), 'x')
    expect(outcome).toEqual({ success: false, message: 'Folder is read-only' })
    expect(deps.showText).toHaveBeenCalledWith('Folder is read-only', 'error')
  })

  it('parses the text before the run and stops on a parse error', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const tool = noteTool({
      inputSchema: {
        type: 'object',
        properties: { at: { type: 'string' } },
        required: ['at'],
      },
      parseText: async (text) =>
        text === 'later'
          ? { ok: false, messageKey: 'toast.noTime' }
          : { ok: true, input: { at: text } },
      run,
    })
    const { deps, runner } = setup({}, [tool])
    await runner.run(note(), '15:40')
    expect(run.mock.calls[0]).toEqual([
      expect.objectContaining({ input: { at: '15:40' } }),
    ])

    const outcome = await runner.run(note(), 'later')
    expect(outcome.success).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    expect(deps.showError).toHaveBeenCalledWith('toast.noTime', undefined)
  })

  it('does not run a command of an unavailable tool', async () => {
    const tool = noteTool({ unavailableReason: () => 'commands.noLlm' })
    const { deps, runner } = setup({}, [tool])
    const outcome = await runner.run(note(), 'x')
    expect(outcome).toEqual({ success: false, message: 'commands.noLlm' })
    expect(tool.run).not.toHaveBeenCalled()
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.commandUnavailable',
      'Note'
    )
  })

  it('reports a tool that throws', async () => {
    const tool = noteTool({
      run: async () => {
        throw new Error('boom')
      },
    })
    const { deps, runner } = setup({}, [tool])
    const outcome = await runner.run(note(), 'x')
    expect(outcome).toEqual({ success: false, message: 'boom' })
    expect(deps.showError).toHaveBeenCalledWith('toast.commandFailed', 'boom')
  })
})

describe('the output of a command', () => {
  const echo = (output: string): ToolDefinition => ({
    id: 'Test.echo',
    description: 'Echo',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: vi.fn(async () => ({ ok: true, content: output })),
  })
  const command = (afterRun: CommandConfig['afterRun']): CommandConfig => ({
    ...createCommand('Test.echo', 'e-1'),
    name: 'Echo',
    afterRun,
  })

  it('copies the output and closes the window', async () => {
    const copyText = vi.fn(async () => {})
    const { deps, runner } = setup({ copyText }, [echo('result\n')])
    expect(await runner.run(command('copy'), 'x')).toEqual({ success: true })
    expect(copyText).toHaveBeenCalledWith('result')
    expect(deps.showToast).toHaveBeenCalledWith('toast.copied', 'success')
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('warns when there is no output to copy', async () => {
    const copyText = vi.fn(async () => {})
    const { deps, runner } = setup({ copyText }, [echo(' ')])
    const outcome = await runner.run(command('copy'), 'x')
    expect(outcome.success).toBe(false)
    expect(copyText).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.actionEmptyOutput',
      'warn'
    )
  })

  it('shows the output in the menu when there is no selection to replace', async () => {
    const tool = echo('Hello')
    const { deps, runner } = setup({}, [tool])
    await runner.run(command('replaceSelection'), 'hola')
    expect(deps.showResultMenu).toHaveBeenCalledWith('Hello', 'hola')
    expect(vi.mocked(tool.run).mock.calls[0][0].wantsOutput).toBe(true)
  })

  it('returns the output for a selection run and reports nothing', async () => {
    const { deps, runner } = setup({}, [echo('Hello')])
    expect(
      await runner.transform(command('replaceSelection'), 'hola', {
        source: 'selection',
      })
    ).toEqual({ ok: true, content: 'Hello' })
    expect(
      await runner.transform(
        { ...command('replaceSelection'), enabled: false },
        'hola'
      )
    ).toMatchObject({ ok: false, messageKey: 'toast.commandDisabled' })
    expect(deps.showToast).not.toHaveBeenCalled()
    expect(deps.showResultMenu).not.toHaveBeenCalled()
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })
})
