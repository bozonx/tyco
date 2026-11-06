import { describe, expect, it, vi } from 'vitest'
import type { LlmStreamEvent } from '../llm/llm-client'
import type { AppConfig, UserConfig } from '@tyco/shared'
import {
  createQuickAiRequestModel,
  type QuickAiRequestModelDependencies,
} from './quick-ai-request-model'
import { REPLY_BLOCKS_TOOL_NAME } from '../reply-blocks/reply-blocks-tool'

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

function createSetup(overrides: Partial<QuickAiRequestModelDependencies> = {}) {
  const saveEditorHistorySession = vi.fn(async () => 'history-123')
  const updateEditorHistorySession = vi.fn(async () => {})
  const listRecentInstructions = vi.fn(
    (_limit?: number, pId?: string | null) =>
      pId === 'prof-1' ? ['profile instruction'] : ['default instruction']
  )
  const insertText = vi.fn(async () => {})
  const copyText = vi.fn(async () => {})
  const toEditor = vi.fn(async () => {})
  const openMainChat = vi.fn(async () => {})
  const saveChat = vi.fn(async () => {})
  const closeOverlay = vi.fn(() => {})
  const resolveProfileInstructions = vi.fn(
    async (id: string) => `Soul of ${id}`
  )

  let idCounter = 1
  const createId = vi.fn(() => `id-${idCounter++}`)

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
    getUserConfig: () => mockUserConfig,
    getAppConfig: () => mockAppConfig,
    getAvailableTools: vi.fn(async () => ({
      tools: {
        tools: {},
        definitions: new Map(),
        truncatedCallIds: new Set(),
      } as any,
    })),
    stream: vi.fn(() => mockStream()),
    resolveProfileInstructions,
    saveEditorHistorySession,
    updateEditorHistorySession,
    listRecentInstructions,
    insertText,
    copyText,
    toEditor,
    openMainChat,
    saveChat,
    createId,
    closeOverlay,
    ...overrides,
  }

  const model = createQuickAiRequestModel(deps)

  return { model, deps }
}

describe('QuickAiRequestModel', () => {
  it('fails with explicit error if no model is configured', async () => {
    const { model } = createSetup({
      getUserConfig: () =>
        ({
          llm: { tasks: { quickRequest: { modelId: '' } }, models: [] },
        }) as unknown as UserConfig,
    })

    const success = await model.submitPrompt('Hello')
    expect(success).toBe(false)
    expect(model.error.value).toContain('No language model is configured')
  })

  it('fails with explicit error if configured model does not support tools', async () => {
    const { model } = createSetup({
      getUserConfig: () =>
        ({
          llm: {
            tasks: { quickRequest: { modelId: 'simple-model' } },
            models: [
              { id: 'simple-model', name: 'Simple', canUseTools: false },
            ],
          },
        }) as unknown as UserConfig,
    })

    const success = await model.submitPrompt('Hello')
    expect(success).toBe(false)
    expect(model.error.value).toContain('does not support tool calls')
  })

  it('locks profile selection upon first turn generation', async () => {
    const { model } = createSetup()

    expect(model.isProfileLocked.value).toBe(false)
    model.setProfileId('prof-1')
    expect(model.profileId.value).toBe('prof-1')

    await model.submitPrompt('First prompt')
    expect(model.isProfileLocked.value).toBe(true)

    // Cannot change profile anymore
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

  it('executes prompt, extracts reply blocks and saves session to history', async () => {
    const { model, deps } = createSetup()

    const success = await model.submitPrompt('Make it concise')
    expect(success).toBe(true)
    expect(model.turns.value).toHaveLength(1)

    const turn = model.turns.value[0]
    expect(turn.prompt).toBe('Make it concise')
    expect(turn.status).toBe('done')
    expect(turn.replyBlocks).toHaveLength(1)
    expect(turn.replyBlocks[0].text).toBe('Transformed text')

    expect(deps.saveEditorHistorySession).toHaveBeenCalledWith({
      sourceText: 'Selected original text',
      profileId: null,
      instruction: { text: 'Make it concise', inputKind: 'typed' },
      operation: 'quickAiRequest',
      turns: [{ prompt: 'Make it concise', inputKind: 'typed' }],
    })
    expect(deps.updateEditorHistorySession).toHaveBeenCalledWith(
      'history-123',
      [
        {
          prompt: 'Make it concise',
          result: 'Transformed text',
          inputKind: 'typed',
        },
      ],
      'Transformed text'
    )
  })

  it('supports multi-turn queries in the same session', async () => {
    const { model, deps } = createSetup()

    await model.submitPrompt('Turn 1')
    expect(model.turns.value).toHaveLength(1)

    await model.submitPrompt('Turn 2')
    expect(model.turns.value).toHaveLength(2)

    expect(deps.updateEditorHistorySession).toHaveBeenCalledTimes(3) // 1 initial turn done, 1 second turn start, 1 second turn done
  })

  it('applies reply block to target window and updates history', async () => {
    const { model, deps } = createSetup()
    await model.submitPrompt('Test')

    const block = model.turns.value[0].replyBlocks[0]
    await model.applyReplyBlock(block, 'window')

    expect(deps.insertText).toHaveBeenCalledWith('Transformed text')
    expect(deps.closeOverlay).toHaveBeenCalled()
  })

  it('applies reply block to editor and updates history', async () => {
    const { model, deps } = createSetup()
    await model.submitPrompt('Test')

    const block = model.turns.value[0].replyBlocks[0]
    await model.applyReplyBlock(block, 'editor')

    expect(deps.toEditor).toHaveBeenCalledWith(
      'Transformed text',
      'Selected original text'
    )
    expect(deps.closeOverlay).toHaveBeenCalled()
  })

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

  it('switches to chat after generation, migrating all messages and parts', async () => {
    const { model, deps } = createSetup()
    await model.submitPrompt('Make it formal')

    await model.switchToChat()
    expect(deps.saveChat).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Make it formal',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Make it formal',
            attachments: [
              { text: 'Selected original text', source: 'selection' },
            ],
          }),
          expect.objectContaining({ role: 'assistant' }),
        ]),
      }),
      undefined
    )
    expect(deps.openMainChat).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: expect.any(String) })
    )
    expect(deps.closeOverlay).toHaveBeenCalled()
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
        expect(deps.saveEditorHistorySession).not.toHaveBeenCalled()
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
      model.setSourceImage(retaken)
      expect(model.sourceImage.value).toEqual(screenshot)
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
