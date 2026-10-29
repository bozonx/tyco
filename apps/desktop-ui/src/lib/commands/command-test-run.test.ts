import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig, ScriptExecutionResult } from '@tyco/shared'

import { testTools } from '../tools/testing'
import { createCommand } from './command-config'
import { canTestCommand, runCommandTest } from './command-test-run'

const script = (
  toolConfig: Record<string, unknown>,
  extra: Partial<CommandConfig> = {}
): CommandConfig => ({
  ...createCommand('script', 'sc1'),
  name: 'Echo',
  ...extra,
  toolConfig: { command: 'echo {{TEXT}}', ...toolConfig },
})

const finished: ScriptExecutionResult = {
  success: false,
  exitCode: 2,
  stdout: 'out',
  stderr: 'oops',
  running: false,
}

const deps = (
  executeScriptAction = vi.fn().mockResolvedValue(finished),
  cancelScriptAction = vi.fn().mockResolvedValue(true),
  saveCommand = vi.fn(async (): Promise<CommandConfig | undefined> => saved)
) => ({
  executeScriptAction,
  cancelScriptAction,
  newRunId: () => 'run-1',
  saveCommand,
})

/** What the editor saves before a test run: the command it shows */
let saved: CommandConfig | undefined

const testScript = async (command: CommandConfig, d = deps(), text = 'hi') => {
  saved = command
  return runCommandTest(
    command,
    text,
    testTools(),
    d,
    new AbortController().signal
  )
}

describe('runCommandTest', () => {
  it('waits for a script and keeps its exit code and stderr', async () => {
    const d = deps()
    const command = script({ timeoutSec: 5 }, { isOutputLogged: true })
    const result = await testScript(command, d)
    expect(result).toEqual({ kind: 'script', result: finished })
    expect(d.saveCommand).toHaveBeenCalledWith('sc1')
    expect(d.executeScriptAction).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'sc1',
        text: 'hi',
        captureOutput: true,
        // a test run stays out of the log
        logOutput: false,
        runId: 'run-1',
      })
    )
  })

  it('gives no text to a script that takes none', async () => {
    const d = deps()
    await testScript(script({ command: 'backup.sh' }), d)
    expect(d.executeScriptAction.mock.calls[0][0].text).toBe('')
  })

  it('runs only the script as it is saved', async () => {
    for (const savedCommand of [
      undefined,
      script({ command: 'echo other' }),
      script({ workingDirectory: '/tmp' }),
    ]) {
      const d = deps(
        undefined,
        undefined,
        vi.fn().mockResolvedValue(savedCommand)
      )
      const result = await runCommandTest(
        script({}),
        'hi',
        testTools(),
        d,
        new AbortController().signal
      )
      expect(result).toEqual({
        kind: 'error',
        messageKey: 'commands.testNeedsSave',
      })
      expect(d.executeScriptAction).not.toHaveBeenCalled()
    }
  })

  it('does not run a script without a command', async () => {
    const d = deps()
    const result = await runCommandTest(
      script({ command: ' ' }),
      '',
      testTools(),
      d,
      new AbortController().signal
    )
    expect(result).toEqual({
      kind: 'error',
      messageKey: 'commands.errorNoCommand',
    })
    expect(d.executeScriptAction).not.toHaveBeenCalled()
  })

  it('stops the script when the run is cancelled', async () => {
    const controller = new AbortController()
    const d = deps(
      vi.fn(async () => {
        controller.abort()
        throw new Error('Cancelled')
      })
    )
    saved = script({})
    const result = await runCommandTest(
      script({}),
      '',
      testTools(),
      d,
      controller.signal
    )
    expect(result).toEqual({ kind: 'cancelled' })
    expect(d.cancelScriptAction).toHaveBeenCalledWith('run-1')
  })

  it('reports a script that could not run', async () => {
    const d = deps(vi.fn().mockRejectedValue(new Error('No such dir')))
    expect(await testScript(script({}), d, '')).toEqual({
      kind: 'error',
      message: 'No such dir',
    })
  })

  it('returns the response of a webhook', async () => {
    const executeWebhook = vi.fn().mockResolvedValue('{"text":"done"}')
    const webhook: CommandConfig = {
      ...createCommand('webhook', 'wh1'),
      name: 'Hook',
      toolConfig: { url: 'https://x.test/?q={{TEXT}}' },
    }
    const result = await runCommandTest(
      webhook,
      'hi',
      testTools({ executeWebhook }),
      deps(),
      new AbortController().signal
    )
    expect(result).toEqual({ kind: 'output', output: 'done' })
    expect(executeWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hook', isOutputLogged: false }),
      'hi',
      expect.anything()
    )
  })

  it('pre-transforms text before testing a webhook', async () => {
    const executeWebhook = vi.fn().mockResolvedValue('done')
    const webhook: CommandConfig = {
      ...createCommand('webhook', 'wh1'),
      name: 'Hook',
      toolConfig: { url: 'https://x.test/?q={{TEXT}}' },
      isLlmPreTransformEnabled: true,
      llmPreTransformPrompt: 'Uppercase',
    }
    const transformTextWithLlm = vi.fn().mockResolvedValue('HI')
    const result = await runCommandTest(
      webhook,
      'hi',
      testTools({ executeWebhook }),
      { ...deps(), transformTextWithLlm },
      new AbortController().signal
    )
    expect(result).toEqual({ kind: 'output', output: 'done' })
    expect(transformTextWithLlm).toHaveBeenCalledWith(
      'Uppercase',
      'hi',
      expect.anything()
    )
    expect(executeWebhook).toHaveBeenCalledWith(
      expect.anything(),
      'HI',
      expect.anything()
    )
  })

  it('fails test run when pre-transformation prompt is missing', async () => {
    const webhook: CommandConfig = {
      ...createCommand('webhook', 'wh1'),
      name: 'Hook',
      toolConfig: { url: 'https://x.test/?q={{TEXT}}' },
      isLlmPreTransformEnabled: true,
      llmPreTransformPrompt: '   ',
    }
    const result = await runCommandTest(
      webhook,
      'hi',
      testTools(),
      deps(),
      new AbortController().signal
    )
    expect(result).toEqual({
      kind: 'error',
      messageKey: 'commands.errorNoPrompt',
    })
  })

  it('reports a failed webhook', async () => {
    const executeWebhook = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    const webhook: CommandConfig = {
      ...createCommand('webhook', 'wh1'),
      toolConfig: { url: 'https://x.test' },
    }
    expect(
      await runCommandTest(
        webhook,
        '',
        testTools({ executeWebhook }),
        deps(),
        new AbortController().signal
      )
    ).toEqual({
      kind: 'error',
      messageKey: 'toast.webhookFailed',
      message: 'HTTP 500',
    })
  })
})

describe('canTestCommand', () => {
  it('tests scripts and webhooks only', () => {
    expect(canTestCommand(createCommand('script', 's'))).toBe(true)
    expect(canTestCommand(createCommand('webhook', 'w'))).toBe(true)
    expect(canTestCommand(createCommand('core.translate', 't'))).toBe(false)
  })
})
