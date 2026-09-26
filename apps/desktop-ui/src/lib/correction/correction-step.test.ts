import { describe, expect, it, vi } from 'vitest'

import {
  MenuModals,
  createMenuModalsStoreModel,
} from '../modals/menu-modals-store'
import { createCorrectionStep } from './correction-step'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(overrides: Record<string, unknown> = {}) {
  const menu = createMenuModalsStoreModel()
  const request = deferred<string>()
  let signal: AbortSignal | undefined
  const deps = {
    correct: vi.fn((_text: string, s: AbortSignal) => {
      signal = s
      return request.promise
    }),
    openStep: (params: Record<string, unknown>) =>
      menu.nextModal(MenuModals.INSERT, params),
    updateStep: menu.updateStep,
    saveResult: vi.fn().mockResolvedValue(undefined),
    reportError: vi.fn(() => 'failed'),
    ...overrides,
  }
  const step = createCorrectionStep(deps)
  return { menu, request, deps, step, signal: () => signal }
}

describe('createCorrectionStep', () => {
  it('shows the step at once and fills in the correction', async () => {
    const { menu, request, deps, step } = setup()
    menu.nextModal(MenuModals.INSERT, { text: 'helo' })

    const done = step.start('helo')

    expect(menu.menuBreadcrumbs.value).toHaveLength(2)
    expect(menu.currentModalParams.value).toMatchObject({
      correction: true,
      text: 'helo',
      oldText: '',
      originalText: 'helo',
      correcting: true,
    })

    request.resolve('hello')
    await done

    expect(menu.currentModalParams.value).toMatchObject({
      text: 'hello',
      oldText: 'helo',
      originalText: 'helo',
      correcting: false,
      correctionUnchanged: false,
    })
    expect(deps.saveResult).toHaveBeenCalledWith('helo', 'hello')
  })

  it('opens a correction made in advance without waiting', async () => {
    const { menu, deps, step } = setup({ peek: () => 'hello' })

    await step.start('helo')

    expect(deps.correct).not.toHaveBeenCalled()
    expect(menu.currentModalParams.value).toMatchObject({
      text: 'hello',
      oldText: 'helo',
      correcting: false,
    })
    expect(deps.saveResult).toHaveBeenCalledWith('helo', 'hello')
  })

  it('marks a text that needed no changes', async () => {
    const { menu, request, step } = setup()

    const done = step.start('hello')
    request.resolve('hello')
    await done

    expect(menu.currentModalParams.value).toMatchObject({
      text: 'hello',
      oldText: '',
      correctionUnchanged: true,
    })
  })

  it('aborts the correction when the user goes back', async () => {
    const { menu, request, deps, step, signal } = setup()
    menu.nextModal(MenuModals.INSERT, { text: 'helo' })

    const done = step.start('helo')
    menu.back()

    expect(signal()?.aborted).toBe(true)
    request.resolve('hello')
    await done

    expect(menu.currentModalParams.value).toEqual({ text: 'helo' })
    expect(deps.saveResult).not.toHaveBeenCalled()
  })

  it('keeps the text and shows the error when the correction fails', async () => {
    const { menu, request, deps, step } = setup()

    const done = step.start('helo')
    request.reject(new Error('offline'))
    await done

    expect(deps.reportError).toHaveBeenCalledOnce()
    expect(menu.currentModalParams.value).toMatchObject({
      text: 'helo',
      correcting: false,
      correctionError: 'failed',
    })
  })

  it('stops waiting quietly when the correction is aborted elsewhere', async () => {
    const { menu, request, deps, step } = setup({ isAborted: () => true })

    const done = step.start('helo')
    request.reject(new Error('aborted'))
    await done

    expect(deps.reportError).not.toHaveBeenCalled()
    expect(menu.currentModalParams.value).toMatchObject({
      text: 'helo',
      correcting: false,
    })
    expect(menu.currentModalParams.value.correctionError).toBeUndefined()
  })

  it('passes extra params to the step', () => {
    const { menu, step } = setup()

    void step.start('helo', { toEditorVisible: true })

    expect(menu.currentModalParams.value.toEditorVisible).toBe(true)
  })

  describe('with setPending and clearPending', () => {
    function setupPending() {
      const menu = createMenuModalsStoreModel()
      const request = deferred<string>()
      let signal: AbortSignal | undefined
      const deps = {
        correct: vi.fn((_text: string, s: AbortSignal) => {
          signal = s
          return request.promise
        }),
        openStep: (params: Record<string, unknown>) =>
          menu.nextModal(MenuModals.INSERT, params),
        setPending: (params: Record<string, unknown>) =>
          menu.setPendingModal(params),
        clearPending: () => menu.clearPendingModal(),
        saveResult: vi.fn().mockResolvedValue(undefined),
        reportError: vi.fn(() => 'failed'),
      }
      const step = createCorrectionStep(deps)
      return { menu, request, deps, step, signal: () => signal }
    }

    it('shows pending overlay while correcting and opens diff on success', async () => {
      const { menu, request, deps, step } = setupPending()
      menu.nextModal(MenuModals.INSERT, { text: 'helo' })

      const done = step.start('helo')

      expect(menu.pendingModal.value).toMatchObject({ correction: true })
      expect(menu.menuBreadcrumbs.value).toHaveLength(1)

      request.resolve('hello')
      await done

      expect(menu.pendingModal.value).toBeNull()
      expect(menu.menuBreadcrumbs.value).toHaveLength(2)
      expect(menu.currentModalParams.value).toMatchObject({
        text: 'hello',
        oldText: 'helo',
        originalText: 'helo',
        correction: true,
      })
      expect(deps.saveResult).toHaveBeenCalledWith('helo', 'hello')
    })

    it('aborts and clears pending when user cancels without opening a new step', async () => {
      const { menu, request, deps, step, signal } = setupPending()
      menu.nextModal(MenuModals.INSERT, { text: 'helo' })

      const done = step.start('helo')

      expect(menu.pendingModal.value).toMatchObject({ correction: true })
      menu.cancelPending()

      expect(signal()?.aborted).toBe(true)
      expect(menu.pendingModal.value).toBeNull()
      expect(menu.menuBreadcrumbs.value).toHaveLength(1)
      expect(menu.currentModalParams.value).toEqual({ text: 'helo' })

      request.resolve('hello')
      await done
      expect(deps.saveResult).not.toHaveBeenCalled()
    })

    it('clears pending and reports error without leaving a failed step on error', async () => {
      const { menu, request, deps, step } = setupPending()
      menu.nextModal(MenuModals.INSERT, { text: 'helo' })

      const done = step.start('helo')
      expect(menu.pendingModal.value).toMatchObject({ correction: true })

      request.reject(new Error('offline'))
      await done

      expect(deps.reportError).toHaveBeenCalledOnce()
      expect(menu.pendingModal.value).toBeNull()
      expect(menu.menuBreadcrumbs.value).toHaveLength(1)
      expect(menu.currentModalParams.value).toEqual({ text: 'helo' })
    })
  })
})
