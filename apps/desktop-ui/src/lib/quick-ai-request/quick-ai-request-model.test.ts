import { describe, expect, it, vi } from 'vitest'
import type { ChatImage, ChatMessage } from '@tyco/shared'

import type { ChatToolLoopState } from '../chat-tools/chat-tool-loop'
import type { ChatLlmOption } from '../chat/chat-llm-selection'
import { REPLY_BLOCKS_TOOL_NAME } from '../reply-blocks/reply-blocks-tool'
import {
  createQuickAiRequestModel,
  type QuickAiRequestModelDependencies,
  type QuickAiRequestTurnOptions,
} from './quick-ai-request-model'

const MODELS: ChatLlmOption[] = [
  {
    id: 'gpt-4',
    name: 'GPT 4',
    providerLabel: 'Provider',
    canUseImages: false,
    canUseTools: true,
    contextWindowTokens: 8000,
  },
  {
    id: 'vision',
    name: 'Vision',
    providerLabel: 'Provider',
    canUseImages: true,
    canUseTools: true,
    contextWindowTokens: 8000,
  },
  {
    id: 'simple-model',
    name: 'Simple',
    providerLabel: 'Provider',
    canUseImages: false,
    canUseTools: false,
    contextWindowTokens: 8000,
  },
]

/** An answer with one reply block, as the tool loop resolves it */
const blockAnswer = (text = 'Here is the response'): ChatToolLoopState => ({
  content: text,
  parts: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: REPLY_BLOCKS_TOOL_NAME,
      input: { blocks: [{ title: 'Option 1', text: 'Transformed text' }] },
      state: 'done',
    },
    { type: 'text', text },
  ],
})

type SendTurn = QuickAiRequestModelDependencies['sendTurn']

function createSetup(overrides: Partial<QuickAiRequestModelDependencies> = {}) {
  let idCounter = 1
  const sendTurn = vi.fn<SendTurn>(async (_message, _messages, options) => {
    const answer = blockAnswer()
    options.onUpdate(answer)
    return answer
  })
  const deps: QuickAiRequestModelDependencies = {
    context: { kind: 'selection', text: 'Selected original text' },
    getModelOptions: () => MODELS,
    getRememberedModelId: () => 'gpt-4',
    rememberModelId: vi.fn(async () => {}),
    getRules: () => undefined,
    resolveInstructions: vi.fn(async (id: string | null) =>
      id ? `Quick\n\nSoul of ${id}` : 'Quick'
    ),
    sendTurn,
    answerToolApproval: vi.fn(),
    cancelToolApprovals: vi.fn(),
    insertText: vi.fn(async () => {}),
    toEditor: vi.fn(async () => {}),
    openMainChat: vi.fn(async () => {}),
    transferChat: vi.fn(async () => {}),
    saveChat: vi.fn(async () => {}),
    renameChat: vi.fn(async () => {}),
    generateChatTitle: vi.fn(async () => 'Generated title'),
    isQuickRequestSavingEnabled: () => true,
    createId: vi.fn(() => `id-${idCounter++}`),
    chatId: 'chat-1',
    closeOverlay: vi.fn(),
    ...overrides,
  }
  return { model: createQuickAiRequestModel(deps), deps }
}

/** Lets the writes queued by a turn finish */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const sentMessages = (deps: QuickAiRequestModelDependencies, call = 0) => {
  const [message, history] = vi.mocked(deps.sendTurn).mock.calls[call]
  return [...history, message]
}

const savedChats = (deps: QuickAiRequestModelDependencies) =>
  vi.mocked(deps.saveChat).mock.calls.map(([chat]) => chat)

describe('QuickAiRequestModel', () => {
  it('tells at once that no model is picked and refuses to send', async () => {
    const { model, deps } = createSetup({
      getRememberedModelId: () => undefined,
      noModelError: () => 'pick a model',
    })

    expect(model.modelIssue.value).toBe('noModel')
    expect(await model.submitPrompt('Hi')).toBe(false)
    expect(model.error.value).toBe('pick a model')
    expect(deps.sendTurn).not.toHaveBeenCalled()
  })

  it('refuses a model without tool calling, with an explicit message', async () => {
    const { model, deps } = createSetup({
      getRememberedModelId: () => 'simple-model',
      toolsRequiredError: () => 'needs tools',
    })

    expect(model.modelIssue.value).toBe('toolsRequired')
    expect(await model.submitPrompt('Hi')).toBe(false)
    expect(model.error.value).toBe('needs tools')
    expect(deps.sendTurn).not.toHaveBeenCalled()
  })

  it('remembers the picked model per profile', async () => {
    const remembered: Record<string, string> = { writer: 'vision' }
    const { model, deps } = createSetup({
      getRememberedModelId: (id) => (id ? remembered[id] : 'gpt-4'),
    })

    model.setProfileId('writer')
    expect(model.modelId.value).toBe('vision')
    await model.setModelId('gpt-4')
    expect(deps.rememberModelId).toHaveBeenCalledWith('writer', 'gpt-4')
  })

  it('sends the selection with the first question, the instructions and the model', async () => {
    const { model, deps } = createSetup({ initialProfileId: 'writer' })

    expect(await model.submitPrompt('Make it shorter')).toBe(true)

    expect(deps.resolveInstructions).toHaveBeenCalledWith('writer')
    const [, , options] = vi.mocked(deps.sendTurn).mock.calls[0]
    expect(options).toMatchObject<Partial<QuickAiRequestTurnOptions>>({
      modelId: 'gpt-4',
      profileId: 'writer',
      instructions: 'Quick\n\nSoul of writer',
    })
    // the selection goes into the question as the main chat sends it
    const [question] = sentMessages(deps)
    expect(question.content).toContain('Selected original text')
    expect(question.content).toMatch(/Make it shorter$/)
    expect(model.turns.value).toEqual([
      expect.objectContaining({
        prompt: 'Make it shorter',
        status: 'done',
        answer: expect.objectContaining({
          role: 'assistant',
          content: 'Here is the response',
        }),
      }),
    ])
  })

  it('sends the earlier turns with a follow-up and the context only once', async () => {
    const { model, deps } = createSetup()

    await model.submitPrompt('First')
    await model.submitPrompt('Second', 'voice')

    const messages = sentMessages(deps, 1)
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'First'],
      ['assistant', 'Here is the response'],
      ['user', 'Second'],
    ])
    // the history keeps the selection beside the first question
    expect(messages[0].attachments).toEqual([
      { text: 'Selected original text', source: 'selection' },
    ])
    expect(messages[2].content).toBe('Second')
    expect(model.turns.value.map((turn) => turn.inputKind)).toEqual([
      'text',
      'voice',
    ])
  })

  it('locks the profile once a question is sent', async () => {
    const { model } = createSetup()

    await model.submitPrompt('Hi')
    model.setProfileId('writer')

    expect(model.isProfileLocked.value).toBe(true)
    expect(model.profileId.value).toBeNull()
  })

  it('stores the conversation among the quick requests and names it', async () => {
    const { model, deps } = createSetup({ initialProfileId: 'writer' })

    await model.submitPrompt('Make it shorter')
    await flush()

    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chat-1',
        title: 'Make it shorter',
        isQuickRequest: true,
        messages: [
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ role: 'assistant' }),
        ],
      }),
      'writer'
    )
    expect(deps.generateChatTitle).toHaveBeenCalledWith(
      'Make it shorter',
      'Here is the response',
      'gpt-4',
      expect.any(AbortSignal)
    )
    expect(deps.renameChat).toHaveBeenCalledWith(
      'chat-1',
      'Generated title',
      'writer'
    )
  })

  it('keeps every turn in one chat', async () => {
    const { model, deps } = createSetup()

    await model.submitPrompt('First')
    await model.submitPrompt('Second')
    await flush()

    const chats = savedChats(deps)
    expect(new Set(chats.map((chat) => chat.id))).toEqual(new Set(['chat-1']))
    expect(chats.at(-1)?.messages).toHaveLength(4)
    expect(deps.generateChatTitle).toHaveBeenCalledTimes(1)
  })

  it('stores nothing and names nothing while quick requests are not saved', async () => {
    const { model, deps } = createSetup({
      isQuickRequestSavingEnabled: () => false,
    })

    await model.submitPrompt('Hi')
    await flush()

    // nobody sees the title of a request not stored: no model is asked
    expect(deps.generateChatTitle).not.toHaveBeenCalled()
    expect(deps.renameChat).not.toHaveBeenCalled()
    await model.switchToChat()
    expect(deps.transferChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ title: 'Hi' }),
      })
    )
  })

  it('stores and names quick requests even when regular chat history is disabled', async () => {
    const { model, deps } = createSetup({
      isQuickRequestSavingEnabled: () => true,
    })

    await model.submitPrompt('Hi')
    await flush()

    expect(deps.saveChat).toHaveBeenCalled()
    expect(deps.renameChat).toHaveBeenCalledWith(
      'chat-1',
      'Generated title',
      null
    )
  })

  it('shows a failed request without storing it or sending it again', async () => {
    const { model, deps } = createSetup({ formatError: () => 'provider down' })
    vi.mocked(deps.sendTurn).mockRejectedValueOnce(new Error('down'))

    expect(await model.submitPrompt('First')).toBe(false)
    await flush()
    expect(model.turns.value).toEqual([
      expect.objectContaining({ status: 'error', error: 'provider down' }),
    ])
    expect(deps.saveChat).not.toHaveBeenCalled()

    expect(await model.submitPrompt('Again')).toBe(true)
    // the question without an answer gave way; the context went with the new one
    const resent = sentMessages(deps, 1)
    expect(resent).toHaveLength(1)
    expect(resent[0].content).toContain('Selected original text')
    expect(resent[0].content).toMatch(/Again$/)
    expect(model.turns.value.map((turn) => turn.prompt)).toEqual(['Again'])
  })

  it('tells an empty answer as an error', async () => {
    const { model, deps } = createSetup({
      emptyResponseError: () => 'empty answer',
    })
    vi.mocked(deps.sendTurn).mockResolvedValueOnce({ content: '', parts: [] })

    expect(await model.submitPrompt('Hi')).toBe(false)
    expect(model.turns.value[0]).toMatchObject({
      status: 'error',
      error: 'empty answer',
    })
  })

  it('keeps and stores what came of a stopped answer', async () => {
    let release: () => void = () => {}
    const { model, deps } = createSetup({
      sendTurn: vi.fn<SendTurn>(async (_message, _history, options) => {
        options.onUpdate({ content: 'Partial', parts: [] })
        await new Promise<void>((resolve) => (release = resolve))
        return { content: 'Partial', parts: [] }
      }),
    })

    const pending = model.submitPrompt('Long one')
    await flush()
    model.stopGeneration()
    release()

    expect(await pending).toBe(false)
    await flush()
    expect(deps.cancelToolApprovals).toHaveBeenCalled()
    expect(model.turns.value[0]).toMatchObject({
      status: 'stopped',
      answer: expect.objectContaining({ content: 'Partial' }),
    })
    expect(savedChats(deps).at(-1)?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Partial',
      status: 'stopped',
    })
  })

  it('drops a question stopped before any answer', async () => {
    let release: () => void = () => {}
    const { model, deps } = createSetup({
      sendTurn: vi.fn<SendTurn>(async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return { content: '', parts: [] }
      }),
    })

    const pending = model.submitPrompt('Never mind')
    await flush()
    model.stopGeneration()
    release()
    await pending
    await flush()

    expect(deps.saveChat).not.toHaveBeenCalled()
    expect(model.turns.value[0]?.status).toBe('stopped')
    expect(model.isSourceTextLocked.value).toBe(false)
  })

  it('refuses a request longer than the model takes', async () => {
    const { model, deps } = createSetup({
      context: { kind: 'selection', text: 'x'.repeat(100_000) },
      messageTooLongError: () => 'too long',
    })

    expect(await model.submitPrompt('Summarize')).toBe(false)
    expect(model.error.value).toBe('too long')
    expect(deps.sendTurn).not.toHaveBeenCalled()
  })

  it('opens a fresh chat with the selection before anything was answered', async () => {
    const { model, deps } = createSetup({ initialProfileId: 'writer' })

    await model.switchToChat(' Draft ')

    expect(deps.openMainChat).toHaveBeenCalledWith({
      attachment: { text: 'Selected original text', source: 'selection' },
      question: 'Draft',
      profileId: 'writer',
    })
    expect(deps.transferChat).not.toHaveBeenCalled()
    expect(deps.closeOverlay).toHaveBeenCalled()
  })

  it('moves the conversation to the main chat as an ordinary chat with its id', async () => {
    const { model, deps } = createSetup({ initialProfileId: 'writer' })

    await model.submitPrompt('First')
    await model.switchToChat('Next question')

    expect(deps.transferChat).toHaveBeenCalledWith({
      chat: expect.objectContaining({
        id: 'chat-1',
        messages: [
          expect.objectContaining({ role: 'user', content: 'First' }),
          expect.objectContaining({ role: 'assistant' }),
        ],
      }),
      question: 'Next question',
      profileId: 'writer',
    })
    const [{ chat }] = vi.mocked(deps.transferChat).mock.calls[0]
    expect(chat.isQuickRequest).toBeUndefined()
    expect(deps.openMainChat).not.toHaveBeenCalled()
  })

  it('disables and restores the selection until the model answers', async () => {
    const { model, deps } = createSetup()

    model.setSourceTextDisabled(true)
    expect(model.sourceText.value).toBeUndefined()
    model.setSourceTextDisabled(false)
    model.setSourceTextDisabled(true)
    await model.submitPrompt('No context')

    expect(sentMessages(deps)[0].content).toBe('No context')
    expect(model.isSourceTextLocked.value).toBe(true)
    model.setSourceTextDisabled(false)
    expect(model.sourceText.value).toBeUndefined()
  })

  it('selects a sole completed insertion block and clears it for a plain follow-up', async () => {
    const { model, deps } = createSetup()
    await model.submitPrompt('Rewrite this')
    expect(model.selectedReplyBlock.value?.text).toBe('Transformed text')

    vi.mocked(deps.sendTurn).mockImplementationOnce(
      async (_message, _history, options) => {
        const answer = { content: 'An explanation', parts: [] }
        options.onUpdate(answer)
        return answer
      }
    )
    await model.submitPrompt('Why?')
    expect(model.replyBlocks.value).toEqual([])
    expect(model.selectedReplyBlock.value).toBeUndefined()
  })

  it('requires an explicit variant choice again for each answer', async () => {
    const { model } = createSetup({
      sendTurn: async (_message, _history, options) => {
        const answer = blockAnswer()
        const call = answer.parts[0]
        if (call.type === 'tool-call') {
          call.input = { blocks: [{ text: 'First' }, { text: 'Second' }] }
        }
        options.onUpdate(answer)
        return answer
      },
    })
    await model.submitPrompt('Give two variants')
    expect(model.selectedReplyBlock.value).toBeUndefined()
    model.selectReplyBlock(1)
    expect(model.selectedReplyBlock.value?.text).toBe('Second')
    model.selectReplyBlock(99)
    expect(model.selectedReplyBlock.value?.text).toBe('Second')
    await model.submitPrompt('Two more')
    expect(model.selectedReplyBlock.value).toBeUndefined()
  })

  it('does not offer streamed or stopped blocks as the primary insertion', async () => {
    let release!: (answer: ChatToolLoopState) => void
    const { model } = createSetup({
      sendTurn: async (_message, _history, options) => {
        options.onUpdate(blockAnswer())
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })
    const request = model.submitPrompt('Rewrite')
    await flush()
    expect(model.isGenerating.value).toBe(true)
    expect(model.replyBlocks.value).toEqual([])
    model.stopGeneration()
    release(blockAnswer())
    await request
    expect(model.replyBlocks.value).toEqual([])
  })

  it('inserts a reply block and closes the overlay', async () => {
    const { model, deps } = createSetup()

    await model.applyReplyBlock({ title: 'A', text: 'Result' }, 'window')
    await model.applyReplyBlock({ title: 'A', text: 'Edited' }, 'editor')

    expect(deps.insertText).toHaveBeenCalledWith('Result')
    expect(deps.toEditor).toHaveBeenCalledWith(
      'Edited',
      'Selected original text'
    )
    expect(deps.closeOverlay).toHaveBeenCalledTimes(2)
  })

  describe('screenshot mode', () => {
    const screenshot: ChatImage = {
      id: 'shot-1',
      mediaType: 'image/webp',
      width: 10,
      height: 10,
      size: 100,
    }
    const screenshotSetup = (
      overrides: Partial<QuickAiRequestModelDependencies> = {}
    ) =>
      createSetup({
        context: { kind: 'screenshot', images: [screenshot] },
        getRememberedModelId: () => 'vision',
        ...overrides,
      })

    it('sends the screenshot with the first question and stores it', async () => {
      const { model, deps } = screenshotSetup()

      expect(await model.submitPrompt('What is on screen?')).toBe(true)
      expect(await model.submitPrompt('And the title?')).toBe(true)
      await flush()

      const first: ChatMessage = sentMessages(deps)[0]
      expect(first).toEqual({
        role: 'user',
        content: 'What is on screen?',
        images: [screenshot],
      })
      expect(sentMessages(deps, 1)[0]).toEqual(first)
      expect(savedChats(deps).at(-1)).toMatchObject({
        isQuickRequest: true,
        messages: [{ images: [screenshot] }, {}, {}, {}],
      })
    })

    it('rejects a model without image support before sending', async () => {
      const { model, deps } = screenshotSetup({
        getRememberedModelId: () => 'gpt-4',
        imageModelError: () => 'needs vision',
      })

      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.error.value).toBe('needs vision')
      expect(model.turns.value).toHaveLength(0)
      expect(deps.sendTurn).not.toHaveBeenCalled()
    })

    it('adds or removes screenshots only before the first answer', async () => {
      const { model } = screenshotSetup()
      const another = { ...screenshot, id: 'shot-2' }

      model.addSourceImage(another)
      expect(model.sourceImages.value).toEqual([screenshot, another])
      model.removeSourceImage('shot-1')
      expect(model.sourceImages.value).toEqual([another])
      await model.submitPrompt('What is this?')

      expect(model.isSourceImageLocked.value).toBe(true)
      model.addSourceImage(screenshot)
      model.removeSourceImage('shot-2')
      expect(model.sourceImages.value).toEqual([another])
    })

    it('keeps the screenshots editable after a first request with no answer', async () => {
      const { model, deps } = screenshotSetup()
      vi.mocked(deps.sendTurn).mockRejectedValueOnce(new Error('failed'))

      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.isSourceImageLocked.value).toBe(false)
      const retaken = { ...screenshot, id: 'shot-2' }
      model.removeSourceImage('shot-1')
      model.addSourceImage(retaken)

      await model.submitPrompt('What is this?')
      expect(sentMessages(deps, 1)[0].images).toEqual([retaken])
    })

    it('moves an unanswered screenshot with its draft question', async () => {
      const { model, deps } = screenshotSetup({ imageTitle: () => 'Image' })

      await model.switchToChat('Explain')

      expect(deps.transferChat).toHaveBeenCalledWith({
        chat: expect.objectContaining({
          id: 'chat-1',
          title: 'Explain',
          messages: [
            { role: 'user', content: 'Explain', images: [screenshot] },
          ],
        }),
        profileId: undefined,
      })
      expect(deps.openMainChat).not.toHaveBeenCalled()
    })
  })
})

it('keeps the profile fixed while preparing instructions', async () => {
  let resolve!: (instructions: string) => void
  const { model, deps } = createSetup({
    initialProfileId: 'profile-a',
    resolveInstructions: () =>
      new Promise<string>((done) => {
        resolve = done
      }),
  })
  const pending = model.submitPrompt('Question')
  model.setProfileId('profile-b')
  resolve('Instructions of profile-a')
  await pending
  expect(vi.mocked(deps.sendTurn).mock.calls[0][2]).toMatchObject({
    profileId: 'profile-a',
    instructions: 'Instructions of profile-a',
  })
})
