import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@tyco/shared'
import { createChatGenerationModel } from './chat-generation-model'
import type { ChatModelDependencies } from './chat-model-contracts'
import type { ChatState } from './chat-state'

type ChatRequestModel = NonNullable<
  ReturnType<ChatModelDependencies['getChatModel']>
>

describe('createChatGenerationModel', () => {
  const createState = (): ChatState => ({
    messages: ref<ChatMessage[]>([]),
    currentChatParams: ref({ id: 'chat-1', title: 'Test' }),
    isGenerating: ref(false),
    error: ref(''),
    isStopped: ref(false),
    omitHistoryImages: ref(false),
    trimmedTurnCount: ref(0),
    lastFailedTurn: ref(null),
  })

  const sampleModel: ChatRequestModel = {
    id: 'gpt-4o',
    canUseImages: true,
    budgetCharacters: 10000,
  }

  const setup = (
    state = createState(),
    model: ChatRequestModel | null = sampleModel
  ) => {
    const deps = {
      sendChatMessage: vi.fn(
        async (
          _msg,
          _history,
          _instructions,
          options?: { onChunk?: (c: string) => void }
        ) => {
          options?.onChunk?.('Hello ')
          options?.onChunk?.('world!')
          return 'Hello world!'
        }
      ),
      notifyError: vi.fn(),
      emptyMessageError: vi.fn(() => 'Empty message'),
      createId: vi.fn(() => 'id-1'),
      imageTitle: vi.fn(() => 'Image'),
      saveSessionState: vi.fn(async () => {}),
      formatError: vi.fn((e: unknown) =>
        e instanceof Error ? e.message : String(e)
      ),
      getChatModel: vi.fn(() => model),
      noModelError: vi.fn(() => 'No model'),
      imageModelError: vi.fn(() => 'Image error'),
      messageTooLongError: vi.fn(() => 'Too long'),
      imageOmittedText: vi.fn(() => 'Omitted'),
      getChatInstructions: vi.fn(() => 'Instructions'),
    }
    const persist = vi.fn(async () => true)
    const maybeGenerateTitle = vi.fn(async () => {})
    const cancelTitle = vi.fn()

    const generation = createChatGenerationModel(
      deps,
      state,
      persist,
      maybeGenerateTitle,
      cancelTitle
    )

    return { generation, state, deps, persist, maybeGenerateTitle, cancelTitle }
  }

  describe('sendMessage', () => {
    it('notifies error and exits if message and attachments are empty', async () => {
      const { generation, deps } = setup()
      const res = await generation.sendMessage('   ')
      expect(res).toBe('')
      expect(deps.notifyError).toHaveBeenCalledWith('Empty message')
    })

    it('exits if generation is already in progress', async () => {
      const state = createState()
      state.isGenerating.value = true
      const { generation, deps } = setup(state)
      const res = await generation.sendMessage('Hi')
      expect(res).toBe('')
      expect(deps.sendChatMessage).not.toHaveBeenCalled()
    })

    it('reports error if no model is selected', async () => {
      const { generation, deps } = setup(createState(), null)
      const res = await generation.sendMessage('Hi')
      expect(res).toBe('')
      expect(deps.notifyError).toHaveBeenCalledWith('No model')
    })

    it('streams response chunks, updates messages, persists and triggers title generation', async () => {
      const { generation, state, persist, maybeGenerateTitle } = setup()
      const res = await generation.sendMessage('What is the weather?')

      expect(res).toBe('Hello world!')
      expect(state.messages.value).toHaveLength(2)
      expect(state.messages.value[0]).toMatchObject({
        role: 'user',
        content: 'What is the weather?',
      })
      expect(state.messages.value[1]).toMatchObject({
        role: 'assistant',
        content: 'Hello world!',
      })
      expect(state.isGenerating.value).toBe(false)
      expect(persist).toHaveBeenCalled()
      expect(maybeGenerateTitle).toHaveBeenCalledWith('gpt-4o')
    })

    it('handles stream error gracefully with partial chunks, marks assistant message and records lastFailedTurn', async () => {
      const { generation, state, deps } = setup()
      deps.sendChatMessage.mockImplementationOnce(
        async (
          _msg,
          _hist,
          _inst,
          options?: { onChunk?: (c: string) => void }
        ) => {
          options?.onChunk?.('Partial answer')
          throw new Error('Connection reset')
        }
      )

      const res = await generation.sendMessage('Failing request')
      expect(res).toBe('Partial answer')
      expect(state.error.value).toBe('Connection reset')
      expect(state.lastFailedTurn.value).toMatchObject({
        message: 'Failing request',
      })
      expect(state.messages.value.at(-1)?.status).toBe('stopped')
    })

    it('cleans up assistant message when error occurs before any content arrives', async () => {
      const { generation, state, deps } = setup()
      deps.sendChatMessage.mockRejectedValueOnce(new Error('Network error'))

      const res = await generation.sendMessage('No-chunk request')
      expect(res).toBe('')
      expect(state.error.value).toBe('Network error')
      expect(state.lastFailedTurn.value).toMatchObject({
        message: 'No-chunk request',
      })
      expect(
        state.messages.value.find((m) => m.role === 'assistant')
      ).toBeUndefined()
    })
  })

  describe('halt and stopGeneration', () => {
    it('aborts active generation, stops stream and updates status', async () => {
      const { generation, state, cancelTitle, persist } = setup()
      state.isGenerating.value = true
      state.messages.value = [
        { role: 'user', content: 'Tell me a story' },
        { role: 'assistant', content: 'Once upon a time' },
      ]

      generation.halt(true)
      expect(cancelTitle).toHaveBeenCalled()
      expect(state.isGenerating.value).toBe(false)
      expect(state.isStopped.value).toBe(true)
      expect(state.messages.value.at(-1)?.status).toBe('stopped')
      expect(persist).toHaveBeenCalled()
    })
  })

  describe('retryLastTurn and regenerateMessage', () => {
    it('does nothing if no failed turn is recorded', async () => {
      const { generation, deps } = setup()
      const res = await generation.retryLastTurn()
      expect(res).toBe('')
      expect(deps.sendChatMessage).not.toHaveBeenCalled()
    })

    it('retries sending the failed turn message', async () => {
      const state = createState()
      state.lastFailedTurn.value = {
        message: 'Previous question',
        attachments: [],
        images: [],
      }
      state.messages.value = [{ role: 'user', content: 'Previous question' }]
      const { generation } = setup(state)

      const res = await generation.retryLastTurn()
      expect(res).toBe('Hello world!')
      expect(state.lastFailedTurn.value).toBeNull()
    })

    it('regenerates assistant message from the preceding user prompt', async () => {
      const state = createState()
      state.messages.value = [
        { role: 'user', content: 'Generate code' },
        { role: 'assistant', content: 'Old code' },
      ]
      const { generation } = setup(state)

      const res = await generation.regenerateMessage(1)
      expect(res).toBe('Hello world!')
      expect(state.messages.value[1].content).toBe('Hello world!')
    })
  })
})
