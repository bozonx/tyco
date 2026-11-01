import { describe, expect, it, vi } from 'vitest'
import type { ProfileMemoryTopic } from '@tyco/shared'

import { createMemoryTopicsModel } from './memory-topics-model'

const topic: ProfileMemoryTopic = {
  file: 'core.md',
  title: 'Core',
  bytes: 10,
  updatedAt: 1,
}
function setup() {
  const deps = {
    list: vi.fn(async () => [topic]),
    clear: vi.fn(async () => {}),
    reportError: vi.fn(),
    onCleared: vi.fn(),
  }
  return { deps, model: createMemoryTopicsModel(deps) }
}

describe('memory topics', () => {
  it.each(['reset', 'dispose'] as const)(
    'does not restore topics after %s',
    async (action) => {
      const { deps, model } = setup()
      let finish!: (topics: ProfileMemoryTopic[]) => void
      deps.list.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const pending = model.loadTopics('writer')
      model[action]()
      finish([topic])
      await pending
      expect(model.topics.value).toEqual([])
      expect(model.isLoading.value).toBe(false)
      model.dispose()
    }
  )

  it('keeps the latest refresh', async () => {
    const { deps, model } = setup()
    let finish!: (topics: ProfileMemoryTopic[]) => void
    deps.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.loadTopics('old')
    deps.list.mockResolvedValueOnce([])
    await model.loadTopics('new')
    finish([topic])
    await pending
    expect(model.topics.value).toEqual([])
    model.dispose()
  })

  it('refreshes after clearing and reports a failed refresh', async () => {
    const { deps, model } = setup()
    await model.clearMemory('writer')
    expect(deps.clear).toHaveBeenCalledWith('writer')
    expect(model.topics.value).toEqual([topic])
    deps.list.mockRejectedValueOnce(new Error('Denied'))
    await model.loadTopics('writer')
    expect(model.topics.value).toEqual([])
    expect(deps.reportError).toHaveBeenCalledWith(new Error('Denied'))
    model.dispose()
  })
})
