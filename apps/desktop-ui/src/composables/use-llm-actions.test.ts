import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DESKTOP_VIEW_STATE } from '@tyco/shared'

import { useLlmActions } from './use-llm-actions'

const mocks = vi.hoisted(() => ({
  run: vi.fn(async () => 'Answer'),
  dictation: vi.fn(() => {
    throw new Error('Dictation must not be initialized')
  }),
  translation: vi.fn(() => {
    throw new Error('Translation must not be initialized')
  }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ params: structuredClone(DEFAULT_DESKTOP_VIEW_STATE) }),
}))
vi.mock('../stores/llm', () => ({
  useLlmStore: () => ({ client: { run: mocks.run } }),
}))
vi.mock('../stores/dictation', () => ({ useDictationStore: mocks.dictation }))
vi.mock('../stores/translation', () => ({
  useTranslationStore: mocks.translation,
}))
vi.mock('./use-toast', () => ({
  default: () => ({ toast: vi.fn(), toastText: vi.fn() }),
}))

beforeEach(() => vi.clearAllMocks())
describe('LLM dependency boundaries', () => {
  it('runs correction and chat without creating dictation or translation services', async () => {
    const actions = useLlmActions()
    expect(await actions.correctText('Sample')).toBe('Answer')
    expect(
      await actions.sendChatMessage('Question', [], undefined, {
        modelId: 'chosen',
      })
    ).toBe('Answer')
    expect(mocks.run).toHaveBeenCalledWith(
      'chat',
      expect.any(Object),
      expect.objectContaining({ models: ['chosen'] })
    )
    expect(mocks.dictation).not.toHaveBeenCalled()
    expect(mocks.translation).not.toHaveBeenCalled()
  })
})
