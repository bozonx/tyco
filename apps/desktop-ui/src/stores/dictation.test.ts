import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => {}),
  create: vi.fn(),
}))
vi.mock('../lib/stt/live-dictation', () => ({
  createLiveDictation: mocks.create,
}))
import { useDictationStore } from './dictation'

describe('dictation store lifetime', () => {
  it('shares a session within Pinia and isolates separate app instances', () => {
    mocks.create.mockImplementation(() => ({
      start: vi.fn(async () => {}),
      finish: vi.fn(async () => ''),
      cancel: mocks.cancel,
    }))
    const first = createPinia()
    const second = createPinia()
    const session = useDictationStore(first)
    expect(useDictationStore(first)).toBe(session)
    expect(useDictationStore(second)).not.toBe(session)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    disposePinia(first)
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    disposePinia(second)
    expect(mocks.cancel).toHaveBeenCalledTimes(2)
  })
})
