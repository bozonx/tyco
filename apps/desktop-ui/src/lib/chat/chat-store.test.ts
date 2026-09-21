import { describe, expect, it, vi } from 'vitest'

import { APP_ROUTES } from '../navigation/routes'
import { type ChatStoreDeps, createChatStoreModel } from './chat-store'

function createDeps(overrides: Partial<ChatStoreDeps> = {}): ChatStoreDeps {
  return {
    sendChatMessage: vi.fn(async () => 'Assistant reply'),
    saveChatHistory: vi.fn(),
    loadChatHistoryItem: vi.fn(async () => null),
    navigateTo: vi.fn(),
    notifyError: vi.fn(),
    emptyMessageError: () => 'No text selected',
    chatNotFoundError: () => 'Chat not found',
    createId: vi.fn(() => 'chat-id-1'),
    nowIso: vi.fn(() => '2026-04-22T00:00:00.000Z'),
    saveLocalState: vi.fn(),
    getLastChatId: vi.fn(() => null),
    ...overrides,
  }
}

describe('chat-store', () => {
  it('rejects empty messages and notifies the user', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)

    const result = await store.sendMessage('   ')

    expect(result).toBeUndefined()
    expect(deps.notifyError).toHaveBeenCalledWith('No text selected')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
  })

  it('sends a message, appends assistant response, and saves history', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)
    store.newChatParams.value = {
      id: 'chat-id-1',
      initialMessage: 'Hello',
      attachments: ['file-a'],
    }

    const result = await store.sendMessage('Hello', ['file-a'], 'Be concise')

    expect(result).toBe('Assistant reply')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[0]?.role).toBe('user')
    expect(store.messages.value[1]?.role).toBe('assistant')
    expect(deps.sendChatMessage).toHaveBeenCalledOnce()
    expect(deps.saveChatHistory).toHaveBeenCalledOnce()
    expect(store.newChatParams.value.attachments).toEqual([])
  })

  it('adds developer instructions for follow-up messages', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)
    store.messages.value.push({ role: 'assistant', content: 'Earlier answer' })

    await store.sendMessage('Next question')

    expect(deps.sendChatMessage).toHaveBeenCalledWith(
      'Next question',
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onChunk: expect.any(Function),
        onProgress: expect.any(Function),
      })
    )
  })

  it('persists the complete chat state after follow-up messages', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)
    store.newChatParams.value = {
      id: 'chat-id-1',
      initialMessage: 'First question',
    }
    store.messages.value = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ]

    await store.sendMessage('Second question')

    expect(deps.saveChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chat-id-1',
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Second question' },
          { role: 'assistant', content: 'Assistant reply' },
        ],
      })
    )
  })

  it('updates assistant content from streamed chunks', async () => {
    const deps = createDeps({
      sendChatMessage: vi.fn(
        async (_message, _prevMessages, _devInstructions, options) => {
          options?.onChunk?.('Hello')
          options?.onChunk?.('!')
          return 'Hello!'
        }
      ),
    })
    const store = createChatStoreModel(deps)

    const result = await store.sendMessage('Hi')

    expect(result).toBe('Hello!')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[1]?.content).toBe('Hello!')
  })

  it('starts a chat with generated id and navigates to chat page', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)

    await store.startChat({ initialMessage: 'Start here' })

    expect(store.newChatParams.value).toEqual({
      initialMessage: 'Start here',
      id: 'chat-id-1',
    })
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
  })

  it('rolls back optimistic user message when request returns no content', async () => {
    const deps = createDeps({ sendChatMessage: vi.fn(async () => '') })
    const store = createChatStoreModel(deps)

    const result = await store.sendMessage('Hello')

    expect(result).toBe('')
    expect(store.messages.value).toEqual([])
  })

  it('keeps a failed user turn and retries it', async () => {
    const sendChatMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce('Recovered answer')
    const store = createChatStoreModel(createDeps({ sendChatMessage }))

    await store.sendMessage('Keep this question')

    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Keep this question' },
    ])
    expect(store.error.value).toBe('Provider unavailable')

    await store.retryLastTurn()

    expect(store.messages.value.at(-1)?.content).toBe('Recovered answer')
    expect(store.error.value).toBe('')
  })

  it('regenerates an assistant turn from its user message', async () => {
    const store = createChatStoreModel(createDeps())
    store.messages.value = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Old answer' },
    ]

    await store.regenerateMessage(1)

    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Assistant reply' },
    ])
  })

  it('opens a stored chat and navigates to chat page', async () => {
    const deps = createDeps({
      loadChatHistoryItem: vi.fn(async () => ({
        id: 'chat-7',
        description: 'Saved prompt',
        lastMsgDate: '2026-04-22T00:00:00.000Z',
        messages: [
          { role: 'user' as const, content: 'Saved prompt' },
          { role: 'assistant' as const, content: 'Saved reply' },
        ],
      })),
    })
    const store = createChatStoreModel(deps)

    await store.openChat('chat-7')

    expect(store.newChatParams.value).toEqual({
      id: 'chat-7',
      initialMessage: 'Saved prompt',
      attachments: [],
    })
    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Saved prompt' },
      { role: 'assistant', content: 'Saved reply' },
    ])
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
  })

  it('adds and removes attachments', () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)

    store.addAttachment('attachment 1')
    store.addAttachment('attachment 2')
    store.addAttachment('attachment 1') // duplicate should not be added
    store.addAttachment('   ') // empty should be ignored

    expect(store.newChatParams.value.attachments).toEqual([
      'attachment 1',
      'attachment 2',
    ])

    store.removeAttachment(0)
    expect(store.newChatParams.value.attachments).toEqual(['attachment 2'])

    store.removeAttachment(5) // invalid index does nothing
    expect(store.newChatParams.value.attachments).toEqual(['attachment 2'])
  })
})
