import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, UserConfig } from '@tyco/shared'

import type { ChatLlmOption } from '../chat/chat-llm-selection'
import type { LlmStreamEvent } from '../llm/llm-client'
import { REPLY_BLOCKS_TOOL_NAME } from '../reply-blocks/reply-blocks-tool'
import {
  createQuickAiRequestModel,
  type QuickAiRequestModelDependencies,
} from './quick-ai-request-model'

const mockAppConfig: AppConfig = {
  rulePrefix: 'Rules',
  aiInstructions: { quickRequest: 'You are a quick AI assistant.' },
} as unknown as AppConfig

const mockUserConfig: UserConfig = {
  llm: {
    tasks: { quickRequest: { modelId: 'gpt-4' } },
    models: [
      { id: 'gpt-4', name: 'GPT 4', canUseTools: true },
      { id: 'simple-model', name: 'Simple', canUseTools: false },
    ],
  },
} as unknown as UserConfig

/** The model options a config offers, as the overlay would list them */
const optionsOf = (config: UserConfig): ChatLlmOption[] =>
  (config.llm?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    providerLabel: 'Provider',
    canUseImages: Boolean(model.canUseImages),
    canUseTools: model.canUseTools,
    contextWindowTokens: 8000,
  }))

function createSetup(overrides: Partial<QuickAiRequestModelDependencies> = {}) {
  const config = overrides.getUserConfig?.() ?? mockUserConfig
  const createHistorySession = vi.fn(async () => 'history-123')
  const updateHistorySession = vi.fn(async () => {})
  const listRecentInstructions = vi.fn(
    (_limit?: number, pId?: string | null) =>
      pId === 'prof-1' ? ['profile instruction'] : ['default instruction']
  )
  let idCounter = 1

  async function* mockStream(): AsyncGenerator<LlmStreamEvent> {
    yield {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: REPLY_BLOCKS_TOOL_NAME,
      input: { blocks: [{ title: 'Option 1', text: 'Transformed text' }] },
    }
    yield {
      type: 'finish',
      finishReason: 'stop',
      text: 'Here is the response',
      responseMessages: [],
    }
  }

  const deps: QuickAiRequestModelDependencies = {
    sourceText: 'Selected original text',
    getUserConfig: () => config,
    getAppConfig: () => mockAppConfig,
    getModelOptions: () => optionsOf(config),
    getRememberedModelId: () =>
      config.llm?.tasks?.quickRequest?.modelId || undefined,
    rememberModelId: vi.fn(async () => {}),
    turnTools: vi.fn(async () => undefined),
    answerToolApproval: vi.fn(),
    cancelToolApprovals: vi.fn(),
    stream: vi.fn(() => mockStream()),
    resolveProfileInstructions: vi.fn(async (id: string) => `Soul of ${id}`),
    createHistorySession,
    updateHistorySession,
    listRecentInstructions,
    insertText: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    toEditor: vi.fn(async () => {}),
    openMainChat: vi.fn(async () => {}),
    saveChat: vi.fn(async () => {}),
    generateChatTitle: vi.fn(async () => 'Generated title'),
    renameChat: vi.fn(async () => {}),
    createId: vi.fn(() => `id-${idCounter++}`),
    closeOverlay: vi.fn(() => {}),
    ...overrides,
  }

  const model = createQuickAiRequestModel(deps)

  return { model, deps }
}

/** Lets the history writes queued by a turn finish */
const flushHistory = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('QuickAiRequestModel', () => {
  it('tells at once that no model is picked and refuses to send', async () => {
    const { model, deps } = createSetup({
      getUserConfig: () =>
        ({
          llm: { tasks: { quickRequest: { modelId: '' } }, models: [] },
        }) as unknown as UserConfig,
      noModelError: () => 'pick a model',
    })

    expect(model.modelIssue.value).toBe('noModel')
    expect(await model.submitPrompt('Hello')).toBe(false)
    expect(model.error.value).toBe('pick a model')
    expect(deps.stream).not.toHaveBeenCalled()
  })

  it('refuses a model without tool calling, with an explicit message', async () => {
    const { model, deps } = createSetup({
      toolsRequiredError: () => 'needs tools',
    })

    await model.setModelId('simple-model')
    expect(model.modelIssue.value).toBe('toolsRequired')
    expect(await model.submitPrompt('Hello')).toBe(false)
    expect(model.error.value).toBe('needs tools')
    expect(deps.stream).not.toHaveBeenCalled()
  })

  it('does not fall back to another model when the picked one is gone', async () => {
    const { model } = createSetup({
      getRememberedModelId: () => 'removed-model',
    })

    expect(model.selectedModel.value).toBeNull()
    expect(model.modelIssue.value).toBe('noModel')
    expect(await model.submitPrompt('Hello')).toBe(false)
  })

  it('remembers the picked model per profile', async () => {
    const remembered: Record<string, string> = { 'prof-1': 'simple-model' }
    const rememberModelId = vi.fn(async (pId: string | null, id: string) => {
      remembered[pId ?? ''] = id
    })
    const { model } = createSetup({
      getRememberedModelId: (pId) => remembered[pId ?? ''] ?? 'gpt-4',
      rememberModelId,
    })

    expect(model.modelId.value).toBe('gpt-4')
    model.setProfileId('prof-1')
    expect(model.modelId.value).toBe('simple-model')

    await model.setModelId('gpt-4')
    expect(rememberModelId).toHaveBeenCalledWith('prof-1', 'gpt-4')
  })

  it('sends with the picked model and its tools', async () => {
    const { model, deps } = createSetup()

    await model.submitPrompt('Hello')

    expect(deps.turnTools).toHaveBeenCalledWith('gpt-4', null, undefined)
    expect(vi.mocked(deps.stream).mock.calls[0][1]).toMatchObject({
      modelId: 'gpt-4',
    })
  })

  it('locks profile selection upon first turn generation', async () => {
    const { model } = createSetup()

    expect(model.isProfileLocked.value).toBe(false)
    model.setProfileId('prof-1')
    expect(model.profileId.value).toBe('prof-1')

    await model.submitPrompt('First prompt')
    expect(model.isProfileLocked.value).toBe(true)

    model.setProfileId('prof-2')
    expect(model.profileId.value).toBe('prof-1')
  })

  it('filters recent instructions by profile', () => {
    const { model } = createSetup()

    model.setProfileId(null)
    expect(model.getRecentInstructions()).toEqual(['default instruction'])

    model.setProfileId('prof-1')
    expect(model.getRecentInstructions()).toEqual(['profile instruction'])
  })

  it('extracts reply blocks and stores the session after the answer', async () => {
    const { model, deps } = createSetup()

    expect(await model.submitPrompt('Make it concise')).toBe(true)
    await flushHistory()

    const turn = model.turns.value[0]
    expect(turn.status).toBe('done')
    expect(turn.replyBlocks).toEqual([
      { title: 'Option 1', text: 'Transformed text' },
    ])

    const stored = [
      {
        prompt: 'Make it concise',
        inputKind: 'typed',
        result: 'Transformed text',
      },
    ]
    expect(deps.createHistorySession).toHaveBeenCalledWith({
      text: 'Selected original text',
      profileId: null,
      instruction: { text: 'Make it concise', inputKind: 'typed' },
      turns: stored,
    })
    expect(deps.updateHistorySession).toHaveBeenCalledWith(
      'history-123',
      stored,
      'Transformed text'
    )
  })

  it('stores a request without a selection under its first question', async () => {
    const { model, deps } = createSetup({ sourceText: undefined })

    await model.submitPrompt('What is a monad?')
    await flushHistory()

    expect(deps.createHistorySession).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'What is a monad?' })
    )
  })

  it('leaves no history entry for a failed request', async () => {
    const { model, deps } = createSetup({
      stream: vi.fn(() => {
        throw new Error('offline')
      }),
    })

    expect(await model.submitPrompt('Hello')).toBe(false)
    await flushHistory()

    expect(model.turns.value[0].status).toBe('error')
    expect(deps.createHistorySession).not.toHaveBeenCalled()
  })

  it('leaves no history entry for a cancelled request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { model, deps } = createSetup({
      resolveProfileInstructions: vi.fn(async () => {
        await gate
        return ''
      }),
      initialProfileId: 'prof-1',
    })

    const pending = model.submitPrompt('Hello')
    model.stopGeneration()
    release()
    expect(await pending).toBe(false)
    await flushHistory()

    expect(model.turns.value[0].status).toBe('stopped')
    expect(deps.cancelToolApprovals).toHaveBeenCalled()
    expect(deps.createHistorySession).not.toHaveBeenCalled()
  })

  it('keeps every turn of the session in one entry', async () => {
    const { model, deps } = createSetup()

    await model.submitPrompt('Turn 1')
    await model.submitPrompt('Turn 2')
    await flushHistory()

    expect(model.turns.value).toHaveLength(2)
    expect(deps.createHistorySession).toHaveBeenCalledTimes(1)
    expect(deps.updateHistorySession).toHaveBeenLastCalledWith(
      'history-123',
      [
        { prompt: 'Turn 1', inputKind: 'typed', result: 'Transformed text' },
        { prompt: 'Turn 2', inputKind: 'typed', result: 'Transformed text' },
      ],
      'Transformed text'
    )
  })

  it.each(['window', 'editor', 'copy'] as const)(
    'stores the %s block as the result before it leaves the app',
    async (target) => {
      const order: string[] = []
      const { model, deps } = createSetup({
        updateHistorySession: vi.fn(async (_id, _turns, result) => {
          order.push(`history:${result}`)
        }),
        insertText: vi.fn(async (text: string) => {
          order.push(`out:${text}`)
        }),
        toEditor: vi.fn(async (text: string) => {
          order.push(`out:${text}`)
        }),
        copyText: vi.fn(async (text: string) => {
          order.push(`out:${text}`)
        }),
      })
      await model.submitPrompt('Test')
      await flushHistory()
      order.length = 0

      await model.applyReplyBlock({ text: 'Picked variant' }, target)

      expect(order).toEqual(['history:Picked variant', 'out:Picked variant'])
      if (target === 'editor') {
        expect(deps.toEditor).toHaveBeenCalledWith(
          'Picked variant',
          'Selected original text'
        )
      }
      expect(deps.closeOverlay).toHaveBeenCalledTimes(target === 'copy' ? 0 : 1)
    }
  )

  it('switches to chat before any generation has started', async () => {
    const { model, deps } = createSetup()

    await model.switchToChat('My draft question')
    expect(deps.openMainChat).toHaveBeenCalledWith({
      attachment: { text: 'Selected original text', source: 'selection' },
      question: 'My draft question',
      profileId: undefined,
    })
    expect(deps.closeOverlay).toHaveBeenCalled()
  })

  it('moves the conversation to a new chat and names it', async () => {
    const { model, deps } = createSetup({ initialProfileId: 'prof-1' })
    await model.submitPrompt('Make it formal')

    await model.switchToChat()
    await flushHistory()

    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Make it formal',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: 'Make it formal',
            attachments: [
              { text: 'Selected original text', source: 'selection' },
            ],
          }),
          expect.objectContaining({ role: 'assistant', status: 'complete' }),
        ],
      }),
      'prof-1'
    )
    const chatId = vi.mocked(deps.saveChat!).mock.calls[0][0].id
    expect(deps.openMainChat).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, profileId: 'prof-1' })
    )
    // the answer is the reply block alone
    expect(deps.generateChatTitle).toHaveBeenCalledWith(
      'Make it formal',
      'Transformed text',
      'gpt-4'
    )
    expect(deps.renameChat).toHaveBeenCalledWith(
      chatId,
      'Generated title',
      'prof-1'
    )
    expect(deps.closeOverlay).toHaveBeenCalled()
  })

  it('keeps the draft title when no title comes out', async () => {
    const { model, deps } = createSetup({
      generateChatTitle: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    await model.submitPrompt('Make it formal')

    await model.switchToChat()
    await flushHistory()

    expect(deps.saveChat).toHaveBeenCalled()
    expect(deps.renameChat).not.toHaveBeenCalled()
  })

  describe('screenshot mode', () => {
    const screenshot = {
      id: 'shot-1',
      mediaType: 'image/webp' as const,
      width: 1920,
      height: 1080,
      size: 1000,
    }
    const visionConfig = {
      llm: {
        tasks: { quickRequest: { modelId: 'vision' } },
        models: [
          {
            id: 'vision',
            name: 'Vision',
            canUseTools: true,
            canUseImages: true,
          },
          { id: 'text', name: 'Text', canUseTools: true, canUseImages: false },
        ],
      },
    } as unknown as UserConfig
    const bytes = new Uint8Array([1, 2, 3])

    const screenshotSetup = (
      overrides: Partial<QuickAiRequestModelDependencies> = {}
    ) =>
      createSetup({
        sourceText: undefined,
        screenshotMode: true,
        sourceImage: screenshot,
        initialProfileId: 'prof-1',
        getUserConfig: () => visionConfig,
        loadImage: vi.fn(async () => bytes),
        openScreenshotChat: vi.fn(async () => {}),
        ...overrides,
      })

    const userContents = (call: unknown[]) =>
      (call[0] as { messages: { role: string; content: unknown }[] }).messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)

    it('starts with the default Ask AI profile, ignoring the previous one', () => {
      const { model } = screenshotSetup()
      expect(model.profileId.value).toBeNull()
      model.setProfileId('prof-2')
      expect(model.profileId.value).toBeNull()
    })

    it.each(['text', 'voice'] as const)(
      'sends the screenshot with the first %s question only',
      async (mode) => {
        const { model, deps } = screenshotSetup()
        expect(await model.submitPrompt('What is on screen?', mode)).toBe(true)
        expect(await model.submitPrompt('And the title?', mode)).toBe(true)

        const stream = vi.mocked(deps.stream)
        const first = userContents(stream.mock.calls[0])
        expect(first).toEqual([
          [
            { type: 'text', text: 'What is on screen?' },
            { type: 'file', data: bytes, mediaType: 'image/webp' },
          ],
        ])
        const followUp = userContents(stream.mock.calls[1])
        expect(followUp[0]).toEqual(first[0])
        expect(followUp[1]).toBe('And the title?')
        expect(deps.createHistorySession).not.toHaveBeenCalled()
      }
    )

    it('does not send an empty question', async () => {
      const { model, deps } = screenshotSetup()
      expect(await model.submitPrompt('  ')).toBe(false)
      expect(deps.stream).not.toHaveBeenCalled()
    })

    it('rejects a model without image support before sending', async () => {
      const { model, deps } = screenshotSetup({
        getUserConfig: () =>
          ({
            llm: {
              ...visionConfig.llm,
              tasks: { quickRequest: { modelId: 'text' } },
            },
          }) as unknown as UserConfig,
        imageModelError: () => 'needs vision',
      })
      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.error.value).toBe('needs vision')
      expect(model.turns.value).toHaveLength(0)
      expect(deps.stream).not.toHaveBeenCalled()
    })

    it('reports missing image bytes and keeps the screenshot for a retry', async () => {
      const loadImage = vi
        .fn<(id: string) => Promise<Uint8Array<ArrayBuffer>>>()
        .mockRejectedValueOnce(new Error('gone'))
        .mockResolvedValue(bytes)
      const { model, deps } = screenshotSetup({
        loadImage,
        imageUnavailableError: () => 'image unavailable',
      })
      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.error.value).toBe('image unavailable')
      expect(deps.stream).not.toHaveBeenCalled()
      expect(model.sourceImage.value).toEqual(screenshot)

      expect(await model.submitPrompt('What is this?')).toBe(true)
      expect(loadImage).toHaveBeenLastCalledWith('shot-1')
    })

    it('shows the provider error and keeps the image context', async () => {
      const { model } = screenshotSetup({
        stream: vi.fn(() => {
          throw new Error('provider rejected the image')
        }),
      })
      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.error.value).toContain('provider rejected the image')
      expect(model.sourceImage.value).toEqual(screenshot)
    })

    it('does not publish a cancelled answer', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const { model } = screenshotSetup({
        loadImage: vi.fn(async () => {
          await gate
          return bytes
        }),
      })
      const pending = model.submitPrompt('What is this?')
      model.stopGeneration()
      release()
      expect(await pending).toBe(false)
      expect(model.isGenerating.value).toBe(false)
    })

    it('replaces or removes the screenshot only before the first question', async () => {
      const { model } = screenshotSetup()
      const retaken = { ...screenshot, id: 'shot-2' }
      model.setSourceImage(retaken)
      expect(model.sourceImage.value).toEqual(retaken)
      model.setSourceImage(undefined)
      expect(model.sourceImage.value).toBeUndefined()
      model.setSourceImage(screenshot)

      await model.submitPrompt('What is this?')
      expect(model.isSourceImageLocked.value).toBe(true)
      model.setSourceImage(retaken)
      expect(model.sourceImage.value).toEqual(screenshot)
    })

    it('keeps the screenshot replaceable after a first request with no answer', async () => {
      const { model } = screenshotSetup({
        stream: vi.fn(() => {
          throw new Error('network down')
        }),
      })
      expect(await model.submitPrompt('What is this?')).toBe(false)
      expect(model.isSourceImageLocked.value).toBe(false)
      const retaken = { ...screenshot, id: 'shot-2' }
      model.setSourceImage(retaken)
      expect(model.sourceImage.value).toEqual(retaken)
    })

    it('transfers the conversation with the screenshot to the main chat', async () => {
      const { model, deps } = screenshotSetup()
      await model.submitPrompt('What is this?')
      await model.switchToChat('draft follow-up')

      expect(deps.openScreenshotChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'user',
              content: 'What is this?',
              images: [screenshot],
            }),
            expect.objectContaining({ role: 'assistant' }),
          ],
        }),
        'draft follow-up'
      )
      expect(deps.saveChat).not.toHaveBeenCalled()
      expect(deps.openMainChat).not.toHaveBeenCalled()
      expect(deps.closeOverlay).toHaveBeenCalled()
    })

    it('transfers an unanswered screenshot with its draft question', async () => {
      const { model, deps } = screenshotSetup()
      await model.switchToChat('What is this?')
      expect(deps.openScreenshotChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: 'What is this?', images: [screenshot] },
          ],
        }),
        undefined
      )
    })

    it('keeps the quick session when the transfer fails', async () => {
      const { model, deps } = screenshotSetup({
        openScreenshotChat: vi.fn(async () => {
          throw new Error('transfer failed')
        }),
      })
      await model.submitPrompt('What is this?')
      await expect(model.switchToChat()).rejects.toThrow('transfer failed')
      expect(deps.closeOverlay).not.toHaveBeenCalled()
      expect(model.turns.value).toHaveLength(1)
      expect(model.sourceImage.value).toEqual(screenshot)
    })
  })
})
