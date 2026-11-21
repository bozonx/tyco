import { describe, expect, it, vi } from 'vitest'

import {
  createSelectionAction,
  SelectionActionAbortedError,
  type SelectionActionDependencies,
} from './selection-action'

const action = { kind: 'correction' as const }

function fixture() {
  const deps: SelectionActionDependencies = {
    correct: vi.fn(async () => ({ ok: true, content: 'Corrected' })),
    history: {
      saveSource: vi.fn(async () => 'source'),
      saveSourceResult: vi.fn(async () => undefined),
      saveOutput: vi.fn(async () => 'output'),
    },
    t: (key) => key,
    reportError: vi.fn(),
  }
  return {
    deps,
    model: createSelectionAction(deps),
    signal: new AbortController().signal,
  }
}

describe('selection action', () => {
  it('corrects text and records its source and inserted result', async () => {
    const { deps, model, signal } = fixture()
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
  })

  it('distinguishes tool cancellation from a failure', async () => {
    const { deps, model, signal } = fixture()
    vi.mocked(deps.correct)
      .mockResolvedValueOnce({ ok: false, cancelled: true })
      .mockResolvedValueOnce({ ok: false, message: 'Unavailable' })
    await expect(model.run(action, 'Text', signal)).rejects.toBeInstanceOf(
      SelectionActionAbortedError
    )
    await expect(model.run(action, 'Text', signal)).rejects.toThrow(
      'Unavailable'
    )
    expect(model.isAborted(new SelectionActionAbortedError())).toBe(true)
    expect(model.isAborted(new Error())).toBe(false)
  })

  it('reports a history failure without failing insertion', async () => {
    const { deps, model } = fixture()
    vi.mocked(deps.history.saveOutput).mockRejectedValueOnce(
      new Error('History failed')
    )
    await model.saveResult(action, 'Text', 'Result')
    expect(deps.reportError).toHaveBeenCalledOnce()
  })
})
