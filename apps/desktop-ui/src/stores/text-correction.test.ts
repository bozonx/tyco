import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTextCorrectionStore } from './text-correction'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'

const mocks = vi.hoisted(() => ({
  correctText: vi.fn(async () => 'First result'),
}))
vi.mock('./llm', () => ({ useLlmStore: () => ({ actions: mocks }) }))

let desktop: TestDesktop
beforeEach(async () => {
  desktop = await loadFakeDesktop()
  mocks.correctText.mockClear().mockResolvedValue('First result')
})
afterEach(() => {
  disposePinia(desktop.pinia)
  desktop.dispose()
})
const setCorrectionTask = (
  patch: Partial<
    TestDesktop['backend']['userConfig']['llm']['tasks']['correction']
  >
) => {
  const { llm } = desktop.backend.userConfig
  desktop.setUserConfig({
    llm: {
      ...llm,
      tasks: {
        ...llm.tasks,
        correction: { ...llm.tasks.correction, ...patch },
      },
    },
  })
}

describe('corrector configuration ownership', () => {
  it.each(['rules', 'models'] as const)(
    'invalidates a completed correction immediately when %s change',
    async (setting) => {
      const store = useTextCorrectionStore()
      const signal = new AbortController().signal
      expect(await store.correct('Sample', signal)).toBe('First result')
      mocks.correctText.mockResolvedValue('Updated result')
      if (setting === 'rules') setCorrectionTask({ rule: 'New rules' })
      if (setting === 'models') setCorrectionTask({ modelId: 'another-model' })
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
