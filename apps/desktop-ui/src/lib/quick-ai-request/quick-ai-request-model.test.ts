import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, UserConfig } from '@tyco/shared'
import {
  createQuickAiRequestModel,
  type QuickAiRequestModelDependencies,
} from './quick-ai-request-model'
import { REPLY_BLOCKS_TOOL_NAME } from '../reply-blocks/reply-blocks-tool'

const mockAppConfig: AppConfig = {
  rulePrefix: 'Rules',
  aiInstructions: {
    quickRequest: 'You are a quick AI assistant.',
  },
} as unknown as AppConfig

const mockUserConfig: UserConfig = {
  llm: {
    tasks: {
      quickRequest: { modelId: 'gpt-4' },
    },
    models: [
      { id: 'gpt-4', name: 'GPT 4', canUseTools: true },
      { id: 'simple-model', name: 'Simple', canUseTools: false },
    ],
  },
} as unknown as UserConfig

function createSetup(overrides: Partial<QuickAiRequestModelDependencies> = {}) {
  const saveEditorHistorySession = vi.fn(async () => 'history-123')
  const updateEditorHistorySession = vi.fn(async () => {})
  const listRecentInstructions = vi.fn((_limit?: number, pId?: string | null) =>
    pId === 'prof-1' ? ['profile instruction'] : ['default instruction']
  )
  const insertText = vi.fn(async () => {})
  const copyText = vi.fn(async () => {})
  const toEditor = vi.fn(async () => {})
  const openMainChat = vi.fn(async () => {})
  const saveChat = vi.fn(async () => {})
  const closeOverlay = vi.fn(() => {})
  const resolveProfileInstructions = vi.fn(async (id: string) => `Soul of ${id}`)

  let idCounter = 1
  const createId = vi.fn(() => `id-${idCounter++}`)

  async function* mockStream(): AsyncGenerator<LlmStreamEvent> {
    yield {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: REPLY_BLOCKS_TOOL_NAME,
      input: {
        blocks: [{ title: 'Option 1', text: 'Transformed text' }],
      },
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
          llm: {
            tasks: { quickRequest: { modelId: '' } },
            models: [],
          },
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
            models: [{ id: 'simple-model', name: 'Simple', canUseTools: false }],
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
      instruction: {
        prompt: 'Make it concise',
        inputKind: 'text',
      },
      operation: 'quickAiRequest',
      turns: [{ prompt: 'Make it concise', inputKind: 'text' }],
    })
    expect(deps.updateEditorHistorySession).toHaveBeenCalledWith(
      'history-123',
      [
        {
          prompt: 'Make it concise',
          result: 'Transformed text',
          inputKind: 'text',
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
            attachments: [{ text: 'Selected original text', source: 'selection' }],
          }),
          expect.objectContaining({
            role: 'assistant',
          }),
        ]),
      })
    )
    expect(deps.openMainChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: expect.any(String),
      })
    )
    expect(deps.closeOverlay).toHaveBeenCalled()
  })
})
