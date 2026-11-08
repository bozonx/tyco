import { describe, expect, it, vi } from 'vitest'

import {
  isQuickWindowModeSwitchingAction,
  waitForCapturedSelection,
  type WaitForSelectionDependencies,
} from './custom-action-executor'

describe('custom-action-executor', () => {
  describe('isQuickWindowModeSwitchingAction', () => {
    it('returns true for actionPage', () => {
      expect(
        isQuickWindowModeSwitchingAction({ type: 'actionPage', pageIndex: 1 })
      ).toBe(true)
    })

    it('returns true for quick-window mode-switching standard actions', () => {
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'standard',
          actionId: 'voiceInput',
        })
      ).toBe(true)
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'standard',
          actionId: 'screenshotQuickAiRequest',
        })
      ).toBe(true)
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'standard',
          actionId: 'voiceScreenshotQuickAiRequest',
        })
      ).toBe(true)
    })

    it('returns true for quick-window mode-switching profile actions', () => {
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'profile',
          profileId: 'p1',
          action: 'screenshotQuickAiRequest',
        })
      ).toBe(true)
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'profile',
          profileId: 'p1',
          action: 'voiceScreenshotQuickAiRequest',
        })
      ).toBe(true)
    })

    it('returns false for actions that do not switch quick-window modes', () => {
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'standard',
          actionId: 'copyToClipboard',
        })
      ).toBe(false)
      expect(
        isQuickWindowModeSwitchingAction({ type: 'command', commandId: 'cmd1' })
      ).toBe(false)
      expect(
        isQuickWindowModeSwitchingAction({
          type: 'translation',
          language: 'es',
        })
      ).toBe(false)
      expect(isQuickWindowModeSwitchingAction(null)).toBe(false)
    })
  })

  describe('waitForCapturedSelection', () => {
    it('resolves immediately if text is already present', async () => {
      const deps: WaitForSelectionDependencies = {
        getSelectedText: () => 'initial text',
        getRevision: () => 1,
        getActivationId: () => 42,
        watchState: vi.fn(),
      }

      const result = await waitForCapturedSelection(deps, 42, 1)
      expect(result).toBe('initial text')
      expect(deps.watchState).not.toHaveBeenCalled()
    })

    it('resolves when text arrives via state update', async () => {
      let stateCallback:
        | ((params: {
            selectedText: string | null | undefined
            revision: number
            activationId: number
          }) => void)
        | undefined
      let currentText: string | null = null

      const deps: WaitForSelectionDependencies = {
        getSelectedText: () => currentText,
        getRevision: () => 1,
        getActivationId: () => 42,
        watchState: (cb) => {
          stateCallback = cb
          return vi.fn()
        },
      }

      const promise = waitForCapturedSelection(deps, 42, 1, 1000)
      currentText = 'captured hello'
      stateCallback?.({
        selectedText: 'captured hello',
        revision: 2,
        activationId: 42,
      })

      const result = await promise
      expect(result).toBe('captured hello')
    })

    it('resolves when revision changes even if text is empty (capture finished with no selection)', async () => {
      let stateCallback:
        | ((params: {
            selectedText: string | null | undefined
            revision: number
            activationId: number
          }) => void)
        | undefined

      const deps: WaitForSelectionDependencies = {
        getSelectedText: () => null,
        getRevision: () => 1,
        getActivationId: () => 42,
        watchState: (cb) => {
          stateCallback = cb
          return vi.fn()
        },
      }

      const promise = waitForCapturedSelection(deps, 42, 1, 1000)
      stateCallback?.({ selectedText: null, revision: 2, activationId: 42 })

      const result = await promise
      expect(result).toBe('')
    })

    it('resolves empty string if activationId drifts', async () => {
      let stateCallback:
        | ((params: {
            selectedText: string | null | undefined
            revision: number
            activationId: number
          }) => void)
        | undefined
      let currentText: string | null = null

      const deps: WaitForSelectionDependencies = {
        getSelectedText: () => currentText,
        getRevision: () => 1,
        getActivationId: () => 42,
        watchState: (cb) => {
          stateCallback = cb
          return vi.fn()
        },
      }

      const promise = waitForCapturedSelection(deps, 42, 1, 1000)
      currentText = 'some text for next activation'
      stateCallback?.({
        selectedText: 'some text for next activation',
        revision: 2,
        activationId: 43,
      })

      const result = await promise
      expect(result).toBe('')
    })

    it('resolves on timeout if nothing updates', async () => {
      vi.useFakeTimers()
      const deps: WaitForSelectionDependencies = {
        getSelectedText: () => null,
        getRevision: () => 1,
        getActivationId: () => 42,
        watchState: () => vi.fn(),
      }

      const promise = waitForCapturedSelection(deps, 42, 1, 50)
      vi.advanceTimersByTime(60)

      const result = await promise
      expect(result).toBe('')
      vi.useRealTimers()
    })
  })
})
