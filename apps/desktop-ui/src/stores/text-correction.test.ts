import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTextCorrectionStore } from './text-correction'
import { useIpcStore } from './ipc'

const mocks = vi.hoisted(() => ({
  correctText: vi.fn(async () => 'First result'),
}))
vi.mock('../composables/use-llm-actions', () => ({
  useLlmActions: () => mocks,
}))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  mocks.correctText.mockClear().mockResolvedValue('First result')
})
afterEach(() => disposePinia(pinia))

describe('corrector configuration ownership', () => {
  it.each(['rules', 'models', 'instructions', 'prefix'] as const)(
    'invalidates a completed correction immediately when %s change',
    async (setting) => {
      const store = useTextCorrectionStore()
      const ipc = useIpcStore()
      const signal = new AbortController().signal
      expect(await store.correct('Sample', signal)).toBe('First result')
      mocks.correctText.mockResolvedValue('Updated result')
      if (setting === 'rules')
        ipc.desktopState.userConfig.aiRules = {
          ...ipc.desktopState.userConfig.aiRules,
          correction: 'New rules',
        }
      if (setting === 'models')
        ipc.desktopState.userConfig.llm.tasks.correction = ['another-model']
      // Simulate a new backend instruction snapshot; production defaults have literal types.
      if (setting === 'instructions')
        Reflect.set(
          ipc.desktopState.appConfig.aiInstructions,
          'correction',
          'New instructions'
        )
      if (setting === 'prefix')
        Reflect.set(ipc.desktopState.appConfig, 'rulePrefix', 'New prefix')
      expect(store.peek('Sample')).toBeUndefined()
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
    expect(store.peek('Sample')).toBeUndefined()
    await expect(store.correct('Sample', signal)).rejects.toThrow(
      'Correction aborted'
    )
    store.speculate('Another')
    expect(mocks.correctText).toHaveBeenCalledOnce()
  })
})
