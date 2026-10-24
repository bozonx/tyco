import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '../lib/llm/llm-client'
import { useLlmStore } from './llm'
import { useDesktopStore } from './desktop'

const mocks = vi.hoisted(() => ({
  run: vi.fn(async () => 'Answer'),
  stream: vi.fn(async function* () {
    yield { type: 'text', text: 'Answer' }
    yield {
      type: 'finish',
      finishReason: 'stop',
      text: 'Answer',
      responseMessages: [],
    }
  }),
  dictation: vi.fn(() => {
    throw new Error('Dictation must not be initialized')
  }),
  translation: vi.fn(() => {
    throw new Error('Translation must not be initialized')
  }),
}))
vi.mock(import('../lib/llm/llm-client'), async (importOriginal) => ({
  ...(await importOriginal()),
  createLlmClient: () =>
    ({ run: mocks.run, stream: mocks.stream }) as unknown as LlmClient,
}))
vi.mock('./dictation', () => ({ useDictationStore: mocks.dictation }))
vi.mock('./translation', () => ({ useTranslationStore: mocks.translation }))
afterEach(() => vi.clearAllMocks())

describe('LLM store service wiring', () => {
  it('runs correction and chat without initializing dictation or translation', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    try {
      const store = useLlmStore()
      const desktop = useDesktopStore()
      expect(await store.actions.correctText('Sample')).toBe('Answer')
      desktop.desktopState.userConfig.llm.tasks.chat.rule = 'Current chat rules'
      expect(
        (
          await store.actions.sendChatMessage('Question', [], undefined, {
            modelId: 'chosen',
            onUpdate: () => undefined,
          })
        ).content
      ).toBe('Answer')
      expect(mocks.stream).toHaveBeenLastCalledWith(
        'chat',
        expect.objectContaining({ messages: expect.any(Array) }),
        expect.objectContaining({ modelId: 'chosen' })
      )
      expect(mocks.dictation).not.toHaveBeenCalled()
      expect(mocks.translation).not.toHaveBeenCalled()
    } finally {
      disposePinia(pinia)
    }
  })

  it('owns separate application services for separate Pinia instances', () => {
    const first = createPinia()
    const second = createPinia()
    try {
      expect(useLlmStore(first).actions).not.toBe(useLlmStore(second).actions)
    } finally {
      disposePinia(first)
      disposePinia(second)
    }
  })
})
