import { describe, expect, it, vi } from 'vitest'

import type { ToolResult } from '../tools/tool-types'
import { MenuModals, createMenuModalsModel } from './menu-modals-model'
import { createMenuStepRun, type MenuStepRunRequest } from './menu-step-run'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setup() {
  const menu = createMenuModalsModel()
  const deps = {
    currentStepId: () => menu.currentStepId.value,
    hasStep: menu.hasStep,
    setPending: menu.setPendingModal,
    clearPending: menu.clearPendingModal,
    saveSource: vi.fn().mockResolvedValue('source-1'),
    saveSourceResult: vi.fn().mockResolvedValue(undefined),
    reportHistoryError: vi.fn(),
    describeResult: (result: ToolResult) => `failed: ${result.message}`,
    reportError: vi.fn(),
  }
  return { menu, deps, run: createMenuStepRun(deps) }
}

function request(
  overrides: Partial<MenuStepRunRequest> = {}
): MenuStepRunRequest {
  return {
    text: 'source',
    operation: 'translate',
    pending: { label: 'Working' },
    invoke: vi.fn().mockResolvedValue({ ok: true, content: 'result' }),
    read: (result) => result.content ?? null,
    show: vi.fn(),
    ...overrides,
  }
}

describe('menu step run', () => {
  it('keeps the source and the result and shows the result', async () => {
    const { deps, run, menu } = setup()
    const show = vi.fn()
    await run(request({ show }))

    expect(deps.saveSource).toHaveBeenCalledWith('source', 'translate')
    expect(deps.saveSourceResult).toHaveBeenCalledWith('source-1', 'result')
    expect(show).toHaveBeenCalledWith('result', { ok: true, content: 'result' })
    expect(menu.pendingModal.value).toBeNull()
  })

  it('shows the pending screen while the tool runs and updates it', async () => {
    const { run, menu } = setup()
    const answer = deferred<ToolResult>()
    const running = run(
      request({
        invoke: (_signal, updatePending) => {
          updatePending({ label: 'Checking' })
          return answer.promise
        },
      })
    )
    await vi.waitFor(() =>
      expect(menu.pendingModal.value?.label).toBe('Checking')
    )
    answer.resolve({ ok: true, content: 'done' })
    await running
    expect(menu.pendingModal.value).toBeNull()
  })

  it('stops quietly once the user cancels the pending screen', async () => {
    const { deps, run, menu } = setup()
    const answer = deferred<ToolResult>()
    const show = vi.fn()
    let signal: AbortSignal | undefined
    const running = run(
      request({
        show,
        invoke: (s) => {
          signal = s
          return answer.promise
        },
      })
    )
    await vi.waitFor(() => expect(signal).toBeDefined())
    menu.cancelPending()
    expect(signal?.aborted).toBe(true)
    answer.resolve({ ok: true, content: 'late' })
    await running

    expect(show).not.toHaveBeenCalled()
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('reports a failed result in the words of the tool', async () => {
    const { deps, run } = setup()
    await run(
      request({
        invoke: vi.fn().mockResolvedValue({ ok: false, message: 'no key' }),
      })
    )
    expect(deps.reportError).toHaveBeenCalledWith('failed: no key')
  })

  it('reports a thrown error', async () => {
    const { deps, run } = setup()
    await run(request({ invoke: vi.fn().mockRejectedValue(new Error('boom')) }))
    expect(deps.reportError).toHaveBeenCalledWith('boom')
  })

  it('leaves an unusable result to the caller', async () => {
    const { deps, run } = setup()
    const show = vi.fn()
    await run(request({ show, read: () => null }))
    expect(show).not.toHaveBeenCalled()
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('keeps the result in the history when the step closed meanwhile', async () => {
    const { deps, run, menu } = setup()
    menu.nextModal(MenuModals.TRANSLATE, { text: 'source' })
    const answer = deferred<ToolResult>()
    const show = vi.fn()
    const running = run(request({ show, invoke: () => answer.promise }))
    await vi.waitFor(() => expect(deps.saveSource).toHaveBeenCalled())
    menu.closeAll()
    answer.resolve({ ok: true, content: 'result' })
    await running

    expect(deps.saveSourceResult).toHaveBeenCalledWith('source-1', 'result')
    expect(show).not.toHaveBeenCalled()
  })

  it('still shows the result when the history fails', async () => {
    const { deps, run } = setup()
    deps.saveSourceResult.mockRejectedValue(new Error('disk'))
    const show = vi.fn()
    await run(request({ show }))
    expect(deps.reportHistoryError).toHaveBeenCalled()
    expect(show).toHaveBeenCalled()
  })
})
