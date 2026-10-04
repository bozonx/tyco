import { describe, expect, it, vi } from 'vitest'

import { APP_ROUTES } from '../navigation/routes'
import { type ChatStoreDeps, createChatStoreModel } from './chat-store'

function createDeps(overrides: Partial<ChatStoreDeps> = {}): ChatStoreDeps {
  return {
    sendChatMessage: vi.fn(async () => 'Assistant reply'),
    generateChatTitle: vi.fn(async () => ''),
    saveChatHistory: vi.fn(),
    renameChat: vi.fn(),
    loadChatHistoryItem: vi.fn(async () => null),
    navigateTo: vi.fn(),
    notifyError: vi.fn(),
    emptyMessageError: () => 'No text selected',
    chatNotFoundError: () => 'Chat not found',
    messageTooLongError: () => 'Message too long',
    noModelError: () => 'No model',
    createId: vi.fn(() => 'chat-id-1'),
    nowIso: vi.fn(() => '2026-04-22T00:00:00.000Z'),
    saveLocalState: vi.fn(),
    getLastChatId: vi.fn(() => null),
    getChatModel: vi.fn(() => ({ id: 'model-1', budgetCharacters: 100_000 })),
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
      title: 'Hello',
      attachments: ['file-a'],
    }

    const result = await store.sendMessage('Hello', ['file-a'])

    expect(result).toBe('Assistant reply')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[0]?.role).toBe('user')
    expect(store.messages.value[1]?.role).toBe('assistant')
    expect(deps.sendChatMessage).toHaveBeenCalledOnce()
    // the question first, then the whole turn
    expect(deps.saveChatHistory).toHaveBeenCalledTimes(2)
    expect(deps.saveChatHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: 'Hello',
        messages: [
          { role: 'user', content: 'Hello', attachments: ['file-a'] },
          { role: 'assistant', content: 'Assistant reply' },
        ],
      })
    )
    expect(store.newChatParams.value.attachments).toEqual([])
  })

  it('adds developer instructions from the first message', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)

    await store.sendMessage('First question')

    expect(deps.sendChatMessage).toHaveBeenCalledWith(
      'First question',
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({
        modelId: 'model-1',
        signal: expect.any(AbortSignal),
        onChunk: expect.any(Function),
      })
    )
  })

  it('persists the complete chat state after follow-up messages', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)
    store.newChatParams.value = { id: 'chat-id-1', title: 'First question' }
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

    await store.startChat({ attachments: ['context'] })

    expect(store.newChatParams.value).toEqual({
      attachments: ['context'],
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

  it('marks an interrupted partial response and can retry the turn', async () => {
    const sendChatMessage = vi
      .fn()
      .mockImplementationOnce(
        async (_message, _previous, _instructions, options) => {
          options?.onChunk?.('Partial')
          throw new Error('Stream interrupted')
        }
      )
      .mockResolvedValueOnce('Complete answer')
    const store = createChatStoreModel(createDeps({ sendChatMessage }))

    await store.sendMessage('Question')
    expect(store.messages.value.at(-1)).toMatchObject({
      content: 'Partial',
      status: 'stopped',
    })

    await store.retryLastTurn()
    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Complete answer' },
    ])
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
      title: 'Saved prompt',
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

  it('ignores a late answer after starting another chat', async () => {
    let resolveRequest!: (value: string) => void
    const sendChatMessage = vi.fn(
      () => new Promise<string>((resolve) => (resolveRequest = resolve))
    )
    const deps = createDeps({ sendChatMessage })
    const store = createChatStoreModel(deps)

    const pending = store.sendMessage('Old chat')
    await store.startChat({})
    resolveRequest('Late answer')
    await pending

    expect(store.messages.value).toEqual([])
    // only the question was written, before the answer came
    expect(deps.saveChatHistory).toHaveBeenCalledOnce()
    expect(deps.saveChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Old chat' }],
      })
    )
  })

  it('reserves context space for the current message', async () => {
    const deps = createDeps({
      getChatModel: () => ({ id: 'model-1', budgetCharacters: 20 }),
    })
    const store = createChatStoreModel(deps)
    store.messages.value = [
      { role: 'user', content: '1234567890' },
      { role: 'assistant', content: '1234567890' },
    ]

    await store.sendMessage('1234567890')

    expect(deps.sendChatMessage).toHaveBeenCalledWith(
      '1234567890',
      [],
      expect.any(String),
      expect.any(Object)
    )
  })

  it('keeps an in-memory answer when persistence fails', async () => {
    const deps = createDeps({
      saveChatHistory: vi.fn().mockRejectedValue(new Error('Disk full')),
    })
    const store = createChatStoreModel(deps)

    await expect(store.sendMessage('Hello')).resolves.toBe('Assistant reply')
    expect(store.messages.value.at(-1)?.content).toBe('Assistant reply')
    expect(deps.saveLocalState).not.toHaveBeenCalled()
    expect(deps.generateChatTitle).not.toHaveBeenCalled()
  })

  it('refuses to send without a model', async () => {
    const deps = createDeps({ getChatModel: () => null })
    const store = createChatStoreModel(deps)

    await expect(store.sendMessage('Hello')).resolves.toBe('')
    expect(deps.notifyError).toHaveBeenCalledWith('No model')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
  })

  it('gives a new chat a draft title, then a generated one', async () => {
    const deps = createDeps({
      generateChatTitle: vi.fn(async () => 'Greeting'),
    })
    const store = createChatStoreModel(deps)

    await store.sendMessage('Hello there')
    expect(deps.saveChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Hello there' })
    )
    await vi.waitFor(() =>
      expect(deps.renameChat).toHaveBeenCalledWith('chat-id-1', 'Greeting')
    )
    expect(deps.generateChatTitle).toHaveBeenCalledWith(
      'Hello there',
      'Assistant reply',
      'model-1'
    )
    expect(store.newChatParams.value.title).toBe('Greeting')

    await store.sendMessage('And more')
    expect(deps.generateChatTitle).toHaveBeenCalledOnce()
  })

  it('keeps a title the user gave while it was being generated', async () => {
    let resolveTitle!: (title: string) => void
    const deps = createDeps({
      generateChatTitle: vi.fn(
        () => new Promise<string>((resolve) => (resolveTitle = resolve))
      ),
    })
    const store = createChatStoreModel(deps)

    await store.sendMessage('Hello there')
    await vi.waitFor(() => expect(deps.generateChatTitle).toHaveBeenCalled())
    store.setTitle('chat-id-1', 'Mine')
    resolveTitle('Greeting')
    await Promise.resolve()

    expect(store.newChatParams.value.title).toBe('Mine')
    expect(deps.renameChat).not.toHaveBeenCalled()
  })

  it('writes the question even when no answer comes', async () => {
    const deps = createDeps({
      sendChatMessage: vi.fn().mockRejectedValue(new Error('Offline')),
    })
    const store = createChatStoreModel(deps)

    await store.sendMessage('Hello')
    await store.whenSaved()

    expect(deps.saveChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Hello',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )
  })

  it('sends a failed turn again with its context', async () => {
    const sendChatMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce('Answer')
    const store = createChatStoreModel(createDeps({ sendChatMessage }))

    await store.sendMessage('Question', ['context'])
    await store.sendMessage('Question')

    expect(store.messages.value[0]).toEqual({
      role: 'user',
      content: 'Question',
      attachments: ['context'],
    })
    expect(store.messages.value).toHaveLength(2)
  })

  it('does not touch the chat when a new one starts without an answer running', async () => {
    const deps = createDeps()
    const store = createChatStoreModel(deps)
    await store.sendMessage('Hello')
    await store.whenSaved()
    vi.mocked(deps.saveChatHistory).mockClear()

    await store.startChat({})

    expect(deps.saveChatHistory).not.toHaveBeenCalled()
  })

  it('gives a text to the empty current chat, to a new one otherwise', async () => {
    let id = 0
    const deps = createDeps({ createId: () => `chat-${++id}` })
    const store = createChatStoreModel(deps)
    await store.startChat({})

    await store.attachToChat('first')
    expect(store.newChatParams.value).toMatchObject({
      id: 'chat-1',
      attachments: ['first'],
    })

    await store.sendMessage('Question', ['first'])
    await store.attachToChat('second')
    expect(store.messages.value).toEqual([])
    expect(store.newChatParams.value).toMatchObject({
      id: 'chat-2',
      attachments: ['second'],
    })
  })

  it('abandons a chat without writing it again', async () => {
    let resolveRequest!: (value: string) => void
    const deps = createDeps({
      sendChatMessage: vi.fn(
        async (_message, _previous, _instructions, options) => {
          options?.onChunk?.('Part')
          return new Promise<string>((resolve) => (resolveRequest = resolve))
        }
      ),
    })
    const store = createChatStoreModel(deps)
    const pending = store.sendMessage('Hello')
    await store.whenSaved()
    vi.mocked(deps.saveChatHistory).mockClear()

    store.abandonChat()
    resolveRequest('Part and more')
    await pending
    await store.whenSaved()

    expect(store.messages.value).toEqual([])
    expect(deps.saveChatHistory).not.toHaveBeenCalled()
  })

  it('opens a new chat when the last one is gone', async () => {
    const deps = createDeps({ getLastChatId: () => 'gone' })
    const store = createChatStoreModel(deps)

    await store.openLastOrNewChat()

    expect(deps.notifyError).not.toHaveBeenCalled()
    expect(store.newChatParams.value.id).toBe('chat-id-1')
  })
})
