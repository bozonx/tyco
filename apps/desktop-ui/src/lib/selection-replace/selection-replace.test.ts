import { describe, expect, it, vi } from 'vitest'

import {
  PENDING_OVERLAY_DELAY_MS,
  createSelectionReplace,
  keepSurroundingWhitespace,
} from './selection-replace'
import {
  DEFAULT_USER_CONFIG,
  type SelectionRunEvent,
  parseSelectionAction,
  selectionActionId,
} from '@tyco/shared'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function event(overrides: Partial<SelectionRunEvent> = {}): SelectionRunEvent {
  return {
    runId: 1,
    action: 'correction',
    text: 'helo world',
    userConfig: DEFAULT_USER_CONFIG,
    ...overrides,
  }
}

function setup(overrides: Record<string, unknown> = {}) {
  const request = deferred<string>()
  let signal: AbortSignal | undefined
  const deps = {
    run: vi.fn((_action, _text: string, s: AbortSignal) => {
      signal = s
      return request.promise
    }),
    finish: vi.fn().mockResolvedValue('pasted'),
    showOverlay: vi.fn(),
    notify: vi.fn(),
    saveResult: vi.fn().mockResolvedValue(undefined),
    applyUserConfig: vi.fn(),
    t: (key: string) => key,
    describeError: (error: unknown) => String(error),
    ...overrides,
  }
  const model = createSelectionReplace(deps)
  return { request, deps, model, signal: () => signal }
}

describe('selection actions', () => {
  it('parses and formats action ids', () => {
    expect(parseSelectionAction('correction')).toEqual({ kind: 'correction' })
    expect(parseSelectionAction('translate.2')).toEqual({
      kind: 'translate',
      slot: 2,
    })
    expect(parseSelectionAction('aiTask.0')).toEqual({
      kind: 'aiTask',
      slot: 0,
    })
    expect(parseSelectionAction('aiTask.x')).toBeNull()
    expect(parseSelectionAction('other')).toBeNull()
    expect(selectionActionId({ kind: 'translate', slot: 1 })).toBe(
      'translate.1'
    )
  })
})

describe('keepSurroundingWhitespace', () => {
  it('puts the whitespace of the selection around the result', () => {
    expect(keepSurroundingWhitespace('  helo\n', 'Hello.')).toBe('  Hello.\n')
    expect(keepSurroundingWhitespace('helo', '\nHello.\n')).toBe('Hello.')
  })
})

describe('createSelectionReplace', () => {
  it('shows the pending bubble with a delay and pastes the result', async () => {
    const { request, deps, model } = setup()
    const done = model.handleRun(event())

    expect(deps.applyUserConfig).toHaveBeenCalledWith(DEFAULT_USER_CONFIG)
    expect(deps.run).toHaveBeenCalledWith(
      { kind: 'correction' },
      'helo world',
      expect.any(AbortSignal)
    )
    expect(deps.showOverlay).toHaveBeenCalledWith({
      kind: 'pending',
      text: 'selection.working.correction',
      delayMs: PENDING_OVERLAY_DELAY_MS,
    })

    request.resolve('Hello world.')
    await done
    expect(deps.finish).toHaveBeenCalledWith(1, 'Hello world.')
    expect(deps.saveResult).toHaveBeenCalledWith(
      { kind: 'correction' },
      'helo world',
      'Hello world.'
    )
    // only a bubble already on screen confirms the success
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'success', onlyIfVisible: true })
    )
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('pastes nothing when the text did not change', async () => {
    const { request, deps, model } = setup()
    const done = model.handleRun(event())
    request.resolve(' helo world\n')
    await done
    expect(deps.finish).toHaveBeenCalledWith(1, null)
    expect(deps.saveResult).not.toHaveBeenCalled()
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'info',
        text: 'selection.unchanged.correction',
      })
    )
  })

  it('reports a failed request in the bubble and a notification', async () => {
    const { request, deps, model } = setup()
    const done = model.handleRun(event({ action: 'translate.0' }))
    request.reject(new Error('quota'))
    await done
    expect(deps.finish).toHaveBeenCalledWith(1, null)
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'error', text: 'Error: quota' })
    )
    expect(deps.notify).toHaveBeenCalledWith(
      'selection.failed.translate',
      'Error: quota'
    )
  })

  it('treats an empty result as a failure', async () => {
    const { request, deps, model } = setup()
    const done = model.handleRun(event())
    request.resolve('  ')
    await done
    expect(deps.finish).toHaveBeenCalledWith(1, null)
    expect(deps.notify).toHaveBeenCalledWith(
      'selection.failed.correction',
      'selection.emptyResult'
    )
  })

  it('keeps the result in the clipboard when the focus moved', async () => {
    const { request, deps, model } = setup({
      finish: vi.fn().mockResolvedValue('clipboard'),
    })
    const done = model.handleRun(event())
    request.resolve('Hello world.')
    await done
    expect(deps.saveResult).toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledWith(
      'selection.resultInClipboard',
      'selection.focusChanged'
    )
  })

  it('reports a failed paste', async () => {
    const { request, deps, model } = setup({
      finish: vi.fn().mockRejectedValue('ydotoold is not running'),
    })
    const done = model.handleRun(event())
    request.resolve('Hello world.')
    await done
    expect(deps.notify).toHaveBeenCalledWith(
      'selection.failed.correction',
      'ydotoold is not running'
    )
  })

  it('aborts the request on cancellation and drops its result', async () => {
    const { request, deps, model, signal } = setup()
    const done = model.handleRun(event())
    model.handleCancel(1)
    expect(signal()?.aborted).toBe(true)
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'info', text: 'selection.cancelled' })
    )
    request.resolve('partial')
    await done
    expect(deps.finish).not.toHaveBeenCalled()
  })

  it('tells a missing selection apart from a failure', async () => {
    const { deps, model } = setup()
    await model.handleRun(
      event({
        text: undefined,
        error: { code: 'noSelection', message: 'Nothing is selected' },
      })
    )
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.showOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', text: 'selection.noSelection' })
    )

    await model.handleRun(
      event({
        text: undefined,
        error: { code: 'capture', message: 'ydotoold is not running' },
      })
    )
    expect(deps.notify).toHaveBeenCalledWith(
      'selection.failed.correction',
      'ydotoold is not running'
    )
  })

  it('gives the clipboard back for an unknown action', async () => {
    const { deps, model } = setup()
    await model.handleRun(event({ action: 'bogus' }))
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.finish).toHaveBeenCalledWith(1, null)
  })
})
