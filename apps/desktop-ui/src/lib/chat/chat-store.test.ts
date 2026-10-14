import { describe, expect, it, vi } from 'vitest'

import { APP_ROUTES } from '../navigation/routes'
import { type ChatStoreDependencies, createChatModel } from './chat-store'

function createDeps(
  overrides: Partial<ChatStoreDependencies> = {}
): ChatStoreDependencies {
  return {
    sendChatMessage: vi.fn(async () => 'Assistant reply'),
    generateChatTitle: vi.fn(async () => ''),
    saveChat: vi.fn(),
    renameChat: vi.fn(),
    loadChat: vi.fn(async () => null),
    navigateTo: vi.fn(),
    notifyError: vi.fn(),
    emptyMessageError: () => 'No text selected',
    chatNotFoundError: () => 'Chat not found',
    branchTitle: (title) => `${title} (branch)`,
    messageTooLongError: () => 'Message too long',
    noModelError: () => 'No model',
    createId: vi.fn(() => 'chat-id-1'),
    nowIso: vi.fn(() => '2026-04-22T00:00:00.000Z'),
    saveSessionState: vi.fn(),
    getLastChatId: vi.fn(() => null),
    getChatModel: vi.fn(() => ({ id: 'model-1', budgetCharacters: 100_000 })),
    ...overrides,
  }
}

describe('chat-store', () => {
  it('rejects empty messages and notifies the user', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)

    const result = await store.sendMessage('   ')

    expect(result).toBe('')
    expect(deps.notifyError).toHaveBeenCalledWith('No text selected')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
  })

  it('sends a message, appends assistant response, and saves history', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)
    store.currentChatState.value = {
      id: 'chat-id-1',
      title: 'Hello',
      attachments: [{ text: 'file-a' }],
    }

    const result = await store.sendMessage('Hello', [{ text: 'file-a' }])

    expect(result).toBe('Assistant reply')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[0]?.role).toBe('user')
    expect(store.messages.value[1]?.role).toBe('assistant')
    expect(deps.sendChatMessage).toHaveBeenCalledOnce()
    // the question first, then the whole turn
    expect(deps.saveChat).toHaveBeenCalledTimes(2)
    expect(deps.saveChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Hello',
        messages: [
          { role: 'user', content: 'Hello', attachments: [{ text: 'file-a' }] },
          { role: 'assistant', content: 'Assistant reply' },
        ],
      })
    )
    expect(store.currentChatState.value.attachments).toEqual([])
  })

  it('adds developer instructions from the first message', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)

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
    const store = createChatModel(deps)
    store.currentChatState.value = { id: 'chat-id-1', title: 'First question' }
    store.messages.value = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ]

    await store.sendMessage('Second question')

    expect(deps.saveChat).toHaveBeenCalledWith(
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
    const store = createChatModel(deps)

    const result = await store.sendMessage('Hi')

    expect(result).toBe('Hello!')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[1]?.content).toBe('Hello!')
  })

  it('starts a chat with generated id and navigates to chat page', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)

    await store.startChat({ attachments: [{ text: 'context' }] })

    expect(store.currentChatState.value).toEqual({
      attachments: [{ text: 'context' }],
      id: 'chat-id-1',
    })
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
  })

  it('rolls back optimistic user message when request returns no content', async () => {
    const deps = createDeps({ sendChatMessage: vi.fn(async () => '') })
    const store = createChatModel(deps)

    const result = await store.sendMessage('Hello')

    expect(result).toBe('')
    expect(store.messages.value).toEqual([])
  })

  it('keeps a failed user turn and retries it', async () => {
    const sendChatMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce('Recovered answer')
    const store = createChatModel(createDeps({ sendChatMessage }))

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
    const store = createChatModel(createDeps({ sendChatMessage }))

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
    const store = createChatModel(createDeps())
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
      loadChat: vi.fn(async () => ({
        id: 'chat-7',
        title: 'Saved prompt',
        lastMessageAt: '2026-04-22T00:00:00.000Z',
        messages: [
          { role: 'user' as const, content: 'Saved prompt' },
          { role: 'assistant' as const, content: 'Saved reply' },
        ],
      })),
    })
    const store = createChatModel(deps)

    await store.openChat('chat-7')

    expect(store.currentChatState.value).toEqual({
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
    const store = createChatModel(deps)

    store.addAttachment({ text: 'attachment 1' })
    store.addAttachment({ text: 'attachment 2' })
    store.addAttachment({ text: 'attachment 1' }) // duplicate should not be added
    store.addAttachment({ text: '   ' }) // empty should be ignored

    expect(store.currentChatState.value.attachments).toEqual([
      { text: 'attachment 1' },
      { text: 'attachment 2' },
    ])

    store.removeAttachment(0)
    expect(store.currentChatState.value.attachments).toEqual([
      { text: 'attachment 2' },
    ])

    store.removeAttachment(5) // invalid index does nothing
    expect(store.currentChatState.value.attachments).toEqual([
      { text: 'attachment 2' },
    ])
  })

  it('ignores a late answer after starting another chat', async () => {
    let resolveRequest!: (value: string) => void
    const sendChatMessage = vi.fn(
      () => new Promise<string>((resolve) => (resolveRequest = resolve))
    )
    const deps = createDeps({ sendChatMessage })
    const store = createChatModel(deps)

    const pending = store.sendMessage('Old chat')
    await store.startChat({})
    resolveRequest('Late answer')
    await pending

    expect(store.messages.value).toEqual([])
    // only the question was written, before the answer came
    expect(deps.saveChat).toHaveBeenCalledOnce()
    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Old chat' }],
      })
    )
  })

  it('reserves context space for the current message', async () => {
    const deps = createDeps({
      getChatModel: () => ({ id: 'model-1', budgetCharacters: 20 }),
    })
    const store = createChatModel(deps)
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
      saveChat: vi.fn().mockRejectedValue(new Error('Disk full')),
    })
    const store = createChatModel(deps)

    await expect(store.sendMessage('Hello')).resolves.toBe('Assistant reply')
    expect(store.messages.value.at(-1)?.content).toBe('Assistant reply')
    expect(deps.saveSessionState).not.toHaveBeenCalled()
    expect(deps.generateChatTitle).not.toHaveBeenCalled()
  })

  it('refuses to send without a model', async () => {
    const deps = createDeps({ getChatModel: () => null })
    const store = createChatModel(deps)

    await expect(store.sendMessage('Hello')).resolves.toBe('')
    expect(deps.notifyError).toHaveBeenCalledWith('No model')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
  })

  it('gives a new chat a draft title, then a generated one', async () => {
    const deps = createDeps({
      generateChatTitle: vi.fn(async () => 'Greeting'),
    })
    const store = createChatModel(deps)

    await store.sendMessage('Hello there')
    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hello there' })
    )
    await vi.waitFor(() =>
      expect(deps.renameChat).toHaveBeenCalledWith('chat-id-1', 'Greeting')
    )
    expect(deps.generateChatTitle).toHaveBeenCalledWith(
      'Hello there',
      'Assistant reply',
      'model-1',
      expect.any(AbortSignal)
    )
    expect(store.currentChatState.value.title).toBe('Greeting')

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
    const store = createChatModel(deps)

    await store.sendMessage('Hello there')
    await vi.waitFor(() => expect(deps.generateChatTitle).toHaveBeenCalled())
    store.setTitle('chat-id-1', 'Mine')
    resolveTitle('Greeting')
    await Promise.resolve()

    expect(store.currentChatState.value.title).toBe('Mine')
    expect(deps.renameChat).not.toHaveBeenCalled()
  })

  it('writes the question even when no answer comes', async () => {
    const deps = createDeps({
      sendChatMessage: vi.fn().mockRejectedValue(new Error('Offline')),
    })
    const store = createChatModel(deps)

    await store.sendMessage('Hello')
    await store.whenSaved()

    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hello',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )
  })

  it('sends a failed turn again with its context', async () => {
    const sendChatMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce('Answer')
    const store = createChatModel(createDeps({ sendChatMessage }))

    await store.sendMessage('Question', [{ text: 'context' }])
    await store.sendMessage('Question')

    expect(store.messages.value[0]).toEqual({
      role: 'user',
      content: 'Question',
      attachments: [{ text: 'context' }],
    })
    expect(store.messages.value).toHaveLength(2)
  })

  it('does not touch the chat when a new one starts without an answer running', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)
    await store.sendMessage('Hello')
    await store.whenSaved()
    vi.mocked(deps.saveChat).mockClear()

    await store.startChat({})

    expect(deps.saveChat).not.toHaveBeenCalled()
  })

  it('gives a text to the empty current chat, to a new one otherwise', async () => {
    let id = 0
    const deps = createDeps({ createId: () => `chat-${++id}` })
    const store = createChatModel(deps)
    await store.startChat({})

    await store.attachToChat({ text: 'first' })
    expect(store.currentChatState.value).toMatchObject({
      id: 'chat-1',
      attachments: [{ text: 'first' }],
    })

    await store.sendMessage('Question', [{ text: 'first' }])
    await store.attachToChat({ text: 'second' })
    expect(store.messages.value).toEqual([])
    expect(store.currentChatState.value).toMatchObject({
      id: 'chat-2',
      attachments: [{ text: 'second' }],
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
    const store = createChatModel(deps)
    const pending = store.sendMessage('Hello')
    await store.whenSaved()
    vi.mocked(deps.saveChat).mockClear()

    store.abandonChat()
    resolveRequest('Part and more')
    await pending
    await store.whenSaved()

    expect(store.messages.value).toEqual([])
    expect(deps.saveChat).not.toHaveBeenCalled()
  })

  it('opens a new chat when the last one is gone', async () => {
    const deps = createDeps({ getLastChatId: () => 'gone' })
    const store = createChatModel(deps)

    await store.openLastOrNewChat()

    expect(deps.notifyError).not.toHaveBeenCalled()
    expect(store.currentChatState.value.id).toBe('chat-id-1')
  })

  it('branches a dialogue from a selected message index', async () => {
    let idCounter = 1
    const deps = createDeps({ createId: () => `branch-id-${idCounter++}` })
    const store = createChatModel(deps)
    store.currentChatState.value = {
      id: 'original-id',
      title: 'Original Title',
      attachments: [],
    }
    store.messages.value = [
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Reply 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Reply 2' },
    ]

    const branched = await store.branchChat(1)

    expect(branched).toBe(true)
    expect(store.currentChatState.value.id).toBe('branch-id-1')
    expect(store.currentChatState.value.title).toBe('Original Title (branch)')
    expect(store.messages.value).toHaveLength(2)
    expect(store.messages.value[0]?.content).toBe('Turn 1')
    expect(store.messages.value[1]?.content).toBe('Reply 1')
    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'branch-id-1',
        title: 'Original Title (branch)',
        messages: expect.arrayContaining([
          expect.objectContaining({ content: 'Turn 1' }),
          expect.objectContaining({ content: 'Reply 1' }),
        ]),
      })
    )
    expect(deps.saveSessionState).toHaveBeenCalledWith({
      lastChatId: 'branch-id-1',
    })
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
  })
  it.each(['', 'Partial'])(
    'stops a reply with %j content and lets the user retry',
    async (partial) => {
      let resolve!: (text: string) => void
      let options!: Parameters<ChatStoreDependencies['sendChatMessage']>[3]
      const send = vi
        .fn<ChatStoreDependencies['sendChatMessage']>()
        .mockImplementationOnce((_text, _previous, _instructions, input) => {
          options = input
          return new Promise((done) => {
            resolve = done
          })
        })
        .mockResolvedValue('Complete')
      const store = createChatModel(createDeps({ sendChatMessage: send }))
      const pending = store.sendMessage('Question')
      if (partial) options.onChunk?.(partial)
      store.stopGeneration()
      expect(options.signal?.aborted).toBe(true)
      expect(store.isGenerating.value).toBe(false)
      expect(store.isStopped.value).toBe(true)
      options.onChunk?.('Late')
      resolve('Late')
      await pending
      expect(store.messages.value.at(-1)?.content).toBe(partial || 'Question')
      await store.retryLastTurn()
      expect(store.isStopped.value).toBe(false)
      expect(store.messages.value.map((message) => message.content)).toEqual([
        'Question',
        'Complete',
      ])
    }
  )

  it('does not restore an old regeneration over a newly opened chat', async () => {
    let resolve!: (text: string) => void
    const store = createChatModel(
      createDeps({
        sendChatMessage: () =>
          new Promise((done) => {
            resolve = done
          }),
      })
    )
    store.messages.value = [
      { role: 'user', content: 'Old question' },
      { role: 'assistant', content: 'Old answer' },
    ]
    const pending = store.regenerateMessage(1)
    await store.startChat({ title: 'New chat' })
    resolve('Late answer')
    await pending
    expect(store.messages.value).toEqual([])
    expect(store.currentChatState.value.title).toBe('New chat')
  })
  it('cancels a pending title when leaving the chat and ignores its result', async () => {
    let resolve!: (title: string) => void
    let signal!: AbortSignal
    const deps = createDeps({
      generateChatTitle: (_question, _answer, _model, input) => {
        signal = input!
        return new Promise((done) => {
          resolve = done
        })
      },
    })
    const store = createChatModel(deps)
    await store.sendMessage('First question')
    await vi.waitFor(() => expect(signal).toBeDefined())
    await store.startChat({ title: 'New' })
    expect(signal.aborted).toBe(true)
    resolve('Late title')
    await Promise.resolve()
    expect(deps.renameChat).not.toHaveBeenCalled()
    expect(store.currentChatState.value.title).toBe('New')
  })
})

describe('image turns', () => {
  const image = {
    id: 'image',
    mediaType: 'image/webp' as const,
    width: 1,
    height: 1,
    size: 3,
  }
  it('accepts an image-only turn and preserves images through retry, regenerate and branch', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue('Answer')
    const deps = createDeps({
      sendChatMessage: send,
      imageTitle: () => 'Image',
      getChatModel: () => ({
        id: 'vision',
        canUseImages: true,
        budgetCharacters: 100_000,
      }),
    })
    const store = createChatModel(deps)
    await store.sendMessage('', [], [image])
    expect(store.messages.value[0].images).toEqual([image])
    await store.retryLastTurn()
    expect(send.mock.calls[1][0]).toMatchObject({
      role: 'user',
      content: '',
      images: [image],
    })
    await store.regenerateMessage(1)
    expect(send.mock.calls[2][0].images).toEqual([image])
    await store.branchChat(1)
    expect(store.messages.value[0].images).toEqual([image])
    expect(deps.saveChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ images: [image] }),
        ]),
      })
    )
  })
  it('rejects text-only models without consuming the draft', async () => {
    const deps = createDeps({ imageModelError: () => 'Vision required' })
    const store = createChatModel(deps)
    store.currentChatState.value.images = [image]
    await store.sendMessage('', [], [image])
    expect(deps.notifyError).toHaveBeenCalledWith('Vision required')
    expect(store.currentChatState.value.images).toEqual([image])
    expect(store.messages.value).toEqual([])
  })
  it('accounts for image cost before dispatch', async () => {
    const deps = createDeps({
      getChatModel: () => ({
        id: 'small',
        canUseImages: true,
        budgetCharacters: 1000,
      }),
    })
    const store = createChatModel(deps)
    await store.sendMessage('', [], [image])
    expect(deps.notifyError).toHaveBeenCalledWith('Message too long')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
  })
})

describe('image retry validation', () => {
  it('keeps the failed turn when the selected model no longer accepts images', async () => {
    let canUseImages = true
    const deps = createDeps({
      sendChatMessage: vi.fn().mockRejectedValue(new Error('Offline')),
      getChatModel: () => ({
        id: 'model',
        canUseImages,
        budgetCharacters: 100_000,
      }),
    })
    const store = createChatModel(deps)
    const image = {
      id: 'image',
      mediaType: 'image/webp' as const,
      width: 1,
      height: 1,
      size: 3,
    }
    await store.sendMessage('', [], [image])
    canUseImages = false
    await store.retryLastTurn()
    expect(store.messages.value).toEqual([
      { role: 'user', content: '', images: [image] },
    ])
  })
})

describe('file and image context policies', () => {
  const image = {
    id: 'old',
    mediaType: 'image/webp' as const,
    width: 100,
    height: 100,
    size: 100,
  }
  it('sends an attachment-only turn and preserves file metadata in history', async () => {
    const deps = createDeps()
    const store = createChatModel(deps)
    const attachment = {
      text: 'file contents',
      name: 'source.ts',
      mediaType: 'text/plain',
    }
    await store.sendMessage('', [attachment])
    expect(store.messages.value[0].attachments).toEqual([attachment])
    expect(deps.sendChatMessage).toHaveBeenCalled()
  })
  it('allows text models when old image turns exceed the actual context budget', async () => {
    const deps = createDeps({
      getChatModel: () => ({
        id: 'text',
        canUseImages: false,
        budgetCharacters: 4000,
      }),
    })
    const store = createChatModel(deps)
    store.messages.value = [
      { role: 'user', content: 'old', images: [image] },
      { role: 'assistant', content: 'reply' },
    ]
    await store.sendMessage('new')
    expect(deps.sendChatMessage).toHaveBeenCalled()
    expect(store.trimmedTurns.value).toBe(1)
  })
  it('requires explicit consent to omit historical images and leaves history intact', async () => {
    const deps = createDeps({
      imageModelError: () => 'Vision required',
      imageOmittedText: () => '[Images omitted]',
    })
    const store = createChatModel(deps)
    store.messages.value = [
      { role: 'user', content: 'old', images: [image] },
      { role: 'assistant', content: 'reply' },
    ]
    await store.sendMessage('new')
    expect(deps.sendChatMessage).not.toHaveBeenCalled()
    store.omitHistoryImages.value = true
    await store.sendMessage('new')
    expect(deps.sendChatMessage).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          images: [],
          content: 'old\n\n[Images omitted]',
        }),
        { role: 'assistant', content: 'reply' },
      ],
      expect.anything(),
      expect.anything()
    )
    expect(store.messages.value[0].images).toEqual([image])
  })
  it('holds image bytes until a pending history write finishes', async () => {
    let finish!: () => void
    const deps = createDeps({
      getChatModel: () => ({
        id: 'vision',
        canUseImages: true,
        budgetCharacters: 100_000,
      }),
      saveChat: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      sendChatMessage: () => new Promise(() => {}),
    })
    const store = createChatModel(deps)
    void store.sendMessage('image', [], [image])
    await Promise.resolve()
    expect(store.savingImages.value).toHaveLength(1)
    store.abandonChat()
    expect(store.savingImages.value).toHaveLength(1)
    finish()
    await store.whenSaved()
    expect(store.savingImages.value).toHaveLength(0)
  })

  it('keeps the old answer when a regeneration fails, without a retry that repeats the question', async () => {
    const deps = createDeps({
      sendChatMessage: vi.fn(async () => {
        throw new Error('Provider down')
      }),
    })
    const store = createChatModel(deps)
    store.messages.value = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Old answer' },
    ]

    await store.regenerateMessage(1)

    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Old answer' },
    ])
    expect(store.error.value).toBe('')
    expect(deps.notifyError).toHaveBeenCalledWith('Provider down')
    expect(await store.retryLastTurn()).toBe('')
    expect(store.messages.value).toHaveLength(2)
  })

  it('generates no title while the chat history is off', async () => {
    const deps = createDeps({
      generateChatTitle: vi.fn(async () => 'Generated'),
      isHistoryEnabled: () => false,
    })
    const store = createChatModel(deps)

    await store.sendMessage('First question')

    expect(deps.generateChatTitle).not.toHaveBeenCalled()
    expect(deps.renameChat).not.toHaveBeenCalled()
  })

  it('reports a chat that cannot be loaded and opens a new one instead of the last', async () => {
    const deps = createDeps({
      loadChat: vi.fn(async () => {
        throw new Error('io')
      }),
      chatLoadError: () => 'Load failed',
      getLastChatId: () => 'chat-1',
      createId: vi.fn(() => 'new-chat'),
    })
    const store = createChatModel(deps)

    expect(await store.openChat('chat-1')).toBe(false)
    expect(deps.notifyError).toHaveBeenCalledWith('Load failed')

    await store.openLastOrNewChat()
    expect(store.currentChatState.value.id).toBe('new-chat')
    expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
  })

  it('opens the chat picked last, whichever loads first', async () => {
    const loads = new Map<string, (chat: unknown) => void>()
    const deps = createDeps({
      loadChat: vi.fn(
        (id: string) =>
          new Promise((resolve) => {
            loads.set(id, resolve as (chat: unknown) => void)
          })
      ) as ChatStoreDependencies['loadChat'],
    })
    const store = createChatModel(deps)
    const chat = (id: string) => ({
      id,
      title: id,
      lastMessageAt: '',
      messages: [{ role: 'user' as const, content: id }],
    })

    const first = store.openChat('a')
    const second = store.openChat('b')
    loads.get('b')!(chat('b'))
    await second
    loads.get('a')!(chat('a'))

    expect(await first).toBe(false)
    expect(store.currentChatState.value.id).toBe('b')
  })

  it('branches from an answer still coming as it was stopped', async () => {
    const deps = createDeps({
      sendChatMessage: vi.fn(
        (_message, _previous, _instructions, options) =>
          new Promise<string>((resolve) => {
            options.onChunk?.('Partial')
            options.signal?.addEventListener('abort', () => resolve('Partial'))
          })
      ),
      createId: vi.fn(() => 'chat-id-1'),
    })
    const store = createChatModel(deps)
    const pending = store.sendMessage('Question')
    vi.mocked(deps.createId).mockReturnValue('branch-id')

    expect(await store.branchChat(1)).toBe(true)
    await pending

    expect(store.messages.value).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Partial', status: 'stopped' },
    ])
  })
})

it('sends the configured chat instructions used by request budgeting', async () => {
  const deps = createDeps({
    getChatInstructions: () => 'Configured instructions',
  })
  const store = createChatModel(deps)
  await store.sendMessage('Question')
  expect(deps.sendChatMessage).toHaveBeenCalledWith(
    'Question',
    [],
    'Configured instructions',
    expect.any(Object)
  )
})
