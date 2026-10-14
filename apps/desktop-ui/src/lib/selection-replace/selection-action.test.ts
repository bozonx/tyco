import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../commands/command-config'
import {
  createSelectionAction,
  SelectionActionAbortedError,
  type SelectionActionDependencies,
} from './selection-action'

function fixture() {
  const command = { ...createCommand('script', 'command'), name: 'Transform' }
  const deps: SelectionActionDependencies = {
    commands: () => [command],
    correct: vi.fn(async () => ({ ok: true, content: 'Corrected' })),
    transform: vi.fn(async () => ({ ok: true, content: 'Transformed' })),
    logRun: vi.fn(async () => undefined),
    history: {
      saveSource: vi.fn(async () => 'source'),
      saveSourceResult: vi.fn(async () => undefined),
      saveOutput: vi.fn(async () => 'output'),
    },
    t: (key) => key,
    reportError: vi.fn(),
  }
  return {
    command,
    deps,
    model: createSelectionAction(deps),
    signal: new AbortController().signal,
  }
}

describe('selection action', () => {
  it('corrects text and records its source and inserted result', async () => {
    const { deps, model, signal } = fixture()
    const action = { kind: 'correction' as const }
    expect(await model.run(action, 'Original', signal)).toBe('Corrected')
    await model.saveResult(action, 'Original', 'Corrected')
    expect(deps.history.saveSource).toHaveBeenCalledWith(
      'Original',
      'correction'
    )
    expect(deps.history.saveSourceResult).toHaveBeenCalledWith(
      'source',
      'Corrected'
    )
    expect(deps.history.saveOutput).toHaveBeenCalledExactlyOnceWith('Corrected')
    expect(deps.logRun).not.toHaveBeenCalled()
  })

  it('runs and logs a command and records both outgoing texts', async () => {
    const { deps, model, signal, command } = fixture()
    const action = { kind: 'command' as const, commandId: command.id }
    expect(await model.run(action, 'Original', signal)).toBe('Transformed')
    expect(deps.logRun).toHaveBeenCalledWith({
      commandId: command.id,
      name: 'Transform',
      source: 'selection',
      text: 'Original',
      success: true,
    })
    await model.saveResult(action, 'Original', 'Transformed')
    expect(deps.history.saveOutput).toHaveBeenNthCalledWith(1, 'Original')
    expect(deps.history.saveOutput).toHaveBeenNthCalledWith(2, 'Transformed')
  })

  it('rejects missing commands without invoking a tool', async () => {
    const { deps, model, signal } = fixture()
    await expect(
      model.run({ kind: 'command', commandId: 'missing' }, 'Text', signal)
    ).rejects.toThrow('commandLauncher.commandMissing')
    expect(deps.transform).not.toHaveBeenCalled()
  })

  it('distinguishes tool cancellation from a failure', async () => {
    const { deps, model, signal } = fixture()
    vi.mocked(deps.correct)
      .mockResolvedValueOnce({ ok: false, cancelled: true })
      .mockResolvedValueOnce({ ok: false, message: 'Unavailable' })
    await expect(
      model.run({ kind: 'correction' }, 'Text', signal)
    ).rejects.toBeInstanceOf(SelectionActionAbortedError)
    await expect(
      model.run({ kind: 'correction' }, 'Text', signal)
    ).rejects.toThrow('Unavailable')
    expect(model.isAborted(new SelectionActionAbortedError())).toBe(true)
    expect(model.isAborted(new Error())).toBe(false)
  })

  it('reports history and log failures without failing insertion', async () => {
    const { deps, model, signal, command } = fixture()
    vi.mocked(deps.logRun).mockRejectedValueOnce(new Error('Log failed'))
    expect(
      await model.run(
        { kind: 'command', commandId: command.id },
        'Text',
        signal
      )
    ).toBe('Transformed')
    vi.mocked(deps.history.saveOutput).mockRejectedValueOnce(
      new Error('History failed')
    )
    await model.saveResult(
      { kind: 'command', commandId: command.id },
      'Text',
      'Result'
    )
    expect(deps.reportError).toHaveBeenCalledTimes(2)
  })
})
