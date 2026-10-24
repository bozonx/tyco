import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTextCorrectionStore } from './text-correction'
import { useDesktopStore } from './desktop'

const mocks = vi.hoisted(() => ({
  correctText: vi.fn(async () => 'First result'),
}))
vi.mock('./llm', () => ({ useLlmStore: () => ({ actions: mocks }) }))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  mocks.correctText.mockClear().mockResolvedValue('First result')
})
afterEach(() => disposePinia(pinia))

describe('corrector configuration ownership', () => {
  it.each(['rules', 'models'] as const)(
    'invalidates a completed correction immediately when %s change',
    async (setting) => {
      const store = useTextCorrectionStore()
      const desktop = useDesktopStore()
      const signal = new AbortController().signal
      expect(await store.correct('Sample', signal)).toBe('First result')
      mocks.correctText.mockResolvedValue('Updated result')
      if (setting === 'rules')
        desktop.desktopState.userConfig.llm.tasks.correction.rule = 'New rules'
      if (setting === 'models')
        desktop.desktopState.userConfig.llm.tasks.correction.modelId =
          'another-model'
      expect(store.getCachedCorrection('Sample')).toBeUndefined()
      expect(await store.correct('Sample', signal)).toBe('Updated result')
      expect(mocks.correctText).toHaveBeenCalledTimes(2)
    }
  )
})

describe('corrector disposal', () => {
  it('drops the completed cache and refuses requests after disposal', async () => {
    const store = useTextCorrectionStore()
    const signal = new AbortController().signal
    await store.correct('Sample', signal)
    store.$dispose()
    expect(store.getCachedCorrection('Sample')).toBeUndefined()
    await expect(store.correct('Sample', signal)).rejects.toThrow(
      'Correction aborted'
    )
    store.schedulePrecorrection('Another')
    expect(mocks.correctText).toHaveBeenCalledOnce()
  })
})
