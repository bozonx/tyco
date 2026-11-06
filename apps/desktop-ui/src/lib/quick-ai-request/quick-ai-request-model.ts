import { computed, ref } from 'vue'
import type {
  AiProfile,
  AppConfig,
  Chat,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  ChatMessagePart,
  EditorHistoryTurn,
  UserConfig,
} from '@tyco/shared'
import { errorMessage } from '@tyco/shared/value-guards'

import {
  createChatToolPolicy,
  type ChatToolDecision,
} from '../chat-tools/chat-tool-policy'
import type { ChatLlmOption } from '../chat/chat-llm-selection'
import { draftTitleOf } from '../chat/chat-title'
import { runChatToolLoop } from '../chat-tools/chat-tool-loop'
import {
  LlmError,
  type LlmStreamEvent,
  type LlmStreamOptions,
} from '../llm/llm-client'
import { buildLlmPrompt, type LlmPrompt } from '../llm/llm-prompt'
import type { AiChatTools } from '../llm/llm-request'
import {
  extractReplyBlocks,
  REPLY_BLOCKS_TOOL_NAME,
  type ReplyBlockData,
} from '../reply-blocks/reply-blocks-tool'
import {
  createQuickAiRequestHistory,
  type QuickAiRequestHistorySession,
} from './quick-ai-request-history'

export interface QuickAiRequestTurn {
  id: string
  prompt: string
  inputKind: 'text' | 'voice'
  parts: ChatMessagePart[]
  replyBlocks: ReplyBlockData[]
  textResponse: string
  /** `stopped`: the user cancelled it; what came so far is kept */
  status: 'generating' | 'done' | 'stopped' | 'error'
  error?: string
}

/** Why a request cannot be sent with the picked model */
export type QuickAiRequestModelIssue = 'noModel' | 'toolsRequired'

export interface QuickAiRequestModelDependencies {
  sourceText?: string
  screenshotMode?: boolean
  sourceImage?: ChatImage
  loadImage?: (id: string) => Promise<Uint8Array<ArrayBuffer>>
  openScreenshotChat?: (chat: Chat, question?: string) => Promise<void>
  describeLlmError?: (error: LlmError) => string
  imageModelError?: () => string
  imageUnavailableError?: () => string
  /** The title of a chat whose first question has images only */
  imageTitle?: () => string
  initialInputMode?: 'text' | 'voice'
  initialProfileId?: string | null

  getUserConfig: () => UserConfig
  getAppConfig: () => AppConfig

  /** The models the user can call */
  getModelOptions: () => ChatLlmOption[]
  /** The model last picked for quick requests of this profile, if any */
  getRememberedModelId: (profileId: string | null) => string | undefined
  rememberModelId: (profileId: string | null, modelId: string) => Promise<void>

  /** The tools of one turn on the model; undefined for a turn without any */
  turnTools: (
    modelId: string,
    profileId: string | null,
    profile?: AiProfile
  ) => Promise<AiChatTools | undefined>
  answerToolApproval: (approvalId: string, decision: ChatToolDecision) => void
  /** Cancels the calls waiting for the user */
  cancelToolApprovals: () => void

  stream: (
    prompt: LlmPrompt,
    options: LlmStreamOptions
  ) => AsyncIterable<LlmStreamEvent>

  resolveProfileInstructions: (profileId: string) => Promise<string>
  getProfile?: (profileId: string) => AiProfile | undefined

  /** Resolves to the id of the stored entry, null when nothing was stored */
  createHistorySession: (
    session: QuickAiRequestHistorySession
  ) => Promise<string | null>
  updateHistorySession: (
    id: string,
    turns: EditorHistoryTurn[],
    result: string | undefined
  ) => Promise<void>
  listRecentInstructions?: (
    limit?: number,
    profileId?: string | null
  ) => string[]

  insertText: (text: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  toEditor: (text: string, sourceText?: string) => Promise<void>

  openMainChat: (params: {
    attachment?: ChatAttachment
    question?: string
    profileId?: string
    chatId?: string
    autoSend?: boolean
  }) => Promise<void>
  saveChat?: (chat: Chat, profileId?: string) => Promise<void>
  /** A short title for a conversation; empty when none came out */
  generateChatTitle?: (
    question: string,
    answer: string,
    modelId: string
  ) => Promise<string>
  renameChat?: (
    chatId: string,
    title: string,
    profileId?: string
  ) => Promise<void>
  createId: () => string
  closeOverlay: () => void

  noModelError?: () => string
  toolsRequiredError?: () => string
}

const MODEL_ISSUE_FALLBACK: Record<QuickAiRequestModelIssue, string> = {
  noModel: 'Choose a model for quick requests.',
  toolsRequired:
    'The model cannot call tools. Quick requests and chats need a model with tool calling.',
}

export function createQuickAiRequestModel(
  deps: QuickAiRequestModelDependencies
) {
  const inputMode = ref<'text' | 'voice'>(deps.initialInputMode ?? 'text')
  const profileId = ref<string | null>(
    deps.screenshotMode ? null : (deps.initialProfileId ?? null)
  )
  const modelId = ref<string | null>(
    deps.getRememberedModelId(profileId.value) ?? null
  )
  const sourceImage = ref<ChatImage | undefined>(deps.sourceImage)
  const isProfileLocked = ref(Boolean(deps.screenshotMode))
  const isGenerating = ref(false)
  const turns = ref<QuickAiRequestTurn[]>([])
  const error = ref<string | null>(null)

  const history = createQuickAiRequestHistory({
    create: deps.createHistorySession,
    update: deps.updateHistorySession,
  })
  let abortController: AbortController | null = null

  const modelOptions = computed(() => deps.getModelOptions())
  const selectedModel = computed(
    () =>
      modelOptions.value.find((option) => option.id === modelId.value) ?? null
  )
  /** Told before the first request, so that the user is not surprised */
  const modelIssue = computed<QuickAiRequestModelIssue | null>(() => {
    if (!selectedModel.value) return 'noModel'
    if (!selectedModel.value.canUseTools) return 'toolsRequired'
    return null
  })
  const describeModelIssue = (issue: QuickAiRequestModelIssue) =>
    (issue === 'noModel' ? deps.noModelError : deps.toolsRequiredError)?.() ??
    MODEL_ISSUE_FALLBACK[issue]

  const replyBlocksOf = (parts: ChatMessagePart[]): ReplyBlockData[] =>
    parts.flatMap((part) =>
      part.type === 'tool-call' && part.toolName === REPLY_BLOCKS_TOOL_NAME
        ? extractReplyBlocks(part.input)
        : []
    )

  /** What a turn leaves in the history: the first block, else the answer */
  const resultOf = (turn: QuickAiRequestTurn) =>
    turn.replyBlocks[0]?.text || turn.textResponse.trim() || undefined

  const recordHistory = (result?: string) => {
    if (deps.screenshotMode) return Promise.resolve()
    return history.record(
      deps.sourceText,
      profileId.value,
      turns.value
        .filter((turn) => turn.status === 'done')
        .map((turn) => ({
          prompt: turn.prompt,
          inputKind: turn.inputKind,
          result: resultOf(turn),
        })),
      result
    )
  }

  const setSourceImage = (image: ChatImage | undefined) => {
    if (turns.value.length || isGenerating.value) return
    sourceImage.value = image
  }

  const firstTurnContext = () => ({
    ...(deps.sourceText
      ? {
          attachments: [
            { text: deps.sourceText, source: 'selection' as const },
          ],
        }
      : {}),
    ...(sourceImage.value ? { images: [sourceImage.value] } : {}),
  })

  const setInputMode = (mode: 'text' | 'voice') => {
    inputMode.value = mode
  }

  const setProfileId = (id: string | null) => {
    if (isProfileLocked.value) return
    profileId.value = id
    // every profile keeps the model it was last asked with
    modelId.value = deps.getRememberedModelId(id) ?? null
    error.value = null
  }

  /** Picks the model of the next requests and remembers it for the profile */
  const setModelId = async (id: string) => {
    if (isGenerating.value || id === modelId.value) return
    modelId.value = id
    error.value = null
    await deps.rememberModelId(profileId.value, id)
  }

  const stopGeneration = () => {
    abortController?.abort()
    deps.cancelToolApprovals()
    isGenerating.value = false
    const lastTurn = turns.value.at(-1)
    if (lastTurn?.status === 'generating') lastTurn.status = 'stopped'
  }

  const answerToolApproval = (
    approvalId: string,
    decision: ChatToolDecision
  ) => {
    deps.answerToolApproval(approvalId, decision)
  }

  const getRecentInstructions = (limit = 5): string[] =>
    deps.listRecentInstructions?.(limit, profileId.value) ?? []

  const conversationFor = (count: number): ChatMessage[] =>
    turns.value.slice(0, count).flatMap((turn, index): ChatMessage[] => {
      const question: ChatMessage = {
        role: 'user',
        content: turn.prompt,
        ...(index === 0 ? firstTurnContext() : {}),
      }
      // the turn being asked has no answer yet
      if (index === count - 1) return [question]
      return [
        question,
        { role: 'assistant', content: turn.textResponse, parts: turn.parts },
      ]
    })

  const submitPrompt = async (
    promptText: string,
    mode: 'text' | 'voice' = inputMode.value
  ): Promise<boolean> => {
    const trimmed = promptText.trim()
    if (!trimmed || isGenerating.value) return false

    error.value = null

    const issue = modelIssue.value
    const model = selectedModel.value
    if (issue || !model) {
      error.value = describeModelIssue(issue ?? 'noModel')
      return false
    }

    if (sourceImage.value && !model.canUseImages) {
      error.value =
        deps.imageModelError?.() ??
        'Choose a model that supports images in model settings.'
      return false
    }

    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    isProfileLocked.value = true
    isGenerating.value = true

    const turn: QuickAiRequestTurn = {
      id: deps.createId(),
      prompt: trimmed,
      inputKind: mode,
      parts: [],
      replyBlocks: [],
      textResponse: '',
      status: 'generating',
    }
    turns.value.push(turn)
    // the reactive copy, so that the feed follows the stream
    const activeTurn = turns.value[turns.value.length - 1]
    const conversation = conversationFor(turns.value.length)

    try {
      const appConfig = deps.getAppConfig()
      const userConfig = deps.getUserConfig()
      const profileInstructions = profileId.value
        ? await deps.resolveProfileInstructions(profileId.value)
        : ''
      const instructions = [
        appConfig.aiInstructions?.quickRequest,
        profileInstructions,
      ]
        .filter(Boolean)
        .join('\n\n')

      const imageBytes = new Map<string, Uint8Array<ArrayBuffer>>()
      if (sourceImage.value) {
        try {
          if (!deps.loadImage) throw new Error('Image loader unavailable')
          imageBytes.set(
            sourceImage.value.id,
            await deps.loadImage(sourceImage.value.id)
          )
        } catch {
          throw new Error(
            deps.imageUnavailableError?.() ?? 'Image is unavailable'
          )
        }
      }
      if (signal.aborted) return false

      const profile = profileId.value
        ? deps.getProfile?.(profileId.value)
        : undefined
      const tools = await deps.turnTools(model.id, profileId.value, profile)
      if (signal.aborted) return false

      const llmPrompt = buildLlmPrompt(conversation, {
        imageBytes,
        instructions: [instructions, tools?.tools?.instructions]
          .filter(Boolean)
          .join('\n\n'),
        rules: userConfig.llm?.tasks?.quickRequest?.rule,
        rulePrefix: appConfig.rulePrefix,
        canUseTools: true,
      })

      const result = await runChatToolLoop(
        {
          stream: (p, options) => deps.stream(p, options),
          requestApproval: (request, approvalSignal) =>
            tools
              ? tools.requestApproval(request, approvalSignal)
              : Promise.resolve('deny'),
          policy: tools?.policy ?? createChatToolPolicy({ canAsk: false }),
        },
        {
          prompt: llmPrompt,
          tools: tools?.tools ?? null,
          maxStepCount: tools?.maxStepCount ?? 1,
          signal,
          options: { modelId: model.id },
          onUpdate: (state) => {
            if (signal.aborted) return
            activeTurn.textResponse = state.content
            activeTurn.parts = [...state.parts]
            activeTurn.replyBlocks = replyBlocksOf(state.parts)
          },
        }
      )

      if (signal.aborted) return false
      activeTurn.textResponse = result.content
      activeTurn.parts = [...result.parts]
      activeTurn.replyBlocks = replyBlocksOf(result.parts)
      activeTurn.status = 'done'
      void recordHistory()
      return true
    } catch (err) {
      if (signal.aborted) {
        activeTurn.status = 'stopped'
        return false
      }
      const message =
        err instanceof LlmError && deps.describeLlmError
          ? deps.describeLlmError(err)
          : errorMessage(err)
      activeTurn.status = 'error'
      activeTurn.error = message
      error.value = message
      return false
    } finally {
      if (abortController === controller) {
        isGenerating.value = false
        abortController = null
      }
    }
  }

  const applyReplyBlock = async (
    block: ReplyBlockData,
    target: 'window' | 'editor' | 'copy'
  ) => {
    // the entry must hold the text before it leaves the app, so that the
    // history can mark it as sent
    await recordHistory(block.text)

    if (target === 'copy') {
      await deps.copyText(block.text)
      return
    }
    if (target === 'window') await deps.insertText(block.text)
    else await deps.toEditor(block.text, deps.sourceText)
    deps.closeOverlay()
  }

  /** Names the chat after its first exchange, once it is saved */
  const generateTitle = async (
    chatId: string,
    question: string,
    answer: string,
    draftTitle: string
  ) => {
    const model = selectedModel.value
    if (!deps.generateChatTitle || !deps.renameChat || !model || !answer) return
    try {
      const title = await deps.generateChatTitle(question, answer, model.id)
      if (title && title !== draftTitle)
        await deps.renameChat(chatId, title, profileId.value ?? undefined)
    } catch {
      // the draft title stays
    }
  }

  const switchToChat = async (currentInputDraft?: string) => {
    stopGeneration()
    let question = currentInputDraft?.trim() || undefined

    if (turns.value.length === 0 && !deps.screenshotMode) {
      await deps.openMainChat({
        attachment: deps.sourceText
          ? { text: deps.sourceText, source: 'selection' }
          : undefined,
        question,
        profileId: profileId.value ?? undefined,
      })
      deps.closeOverlay()
      return
    }

    const chatMessages: ChatMessage[] = turns.value.flatMap(
      (turn, index): ChatMessage[] => [
        {
          role: 'user',
          content: turn.prompt,
          ...(index === 0 ? firstTurnContext() : {}),
        },
        {
          role: 'assistant',
          content: turn.textResponse,
          parts: turn.parts,
          status: turn.status === 'done' ? 'complete' : 'stopped',
        },
      ]
    )

    if (!chatMessages.length && deps.screenshotMode) {
      chatMessages.push({
        role: 'user',
        content: question ?? '',
        ...firstTurnContext(),
      })
      question = undefined
    }

    const firstQuestion = chatMessages[0]
    const draftTitle = draftTitleOf(
      firstQuestion,
      deps.imageTitle?.() || 'Image'
    )
    const chat: Chat = {
      id: deps.createId(),
      title: draftTitle,
      lastMessageAt: Date.now(),
      messages: chatMessages,
    }

    if (deps.screenshotMode) {
      if (!deps.openScreenshotChat)
        throw new Error('Screenshot chat transfer is unavailable')
      await deps.openScreenshotChat(chat, question)
      deps.closeOverlay()
      return
    }

    await deps.saveChat?.(chat, profileId.value ?? undefined)
    await deps.openMainChat({
      chatId: chat.id,
      profileId: profileId.value ?? undefined,
      question,
    })
    deps.closeOverlay()

    const firstAnswer = turns.value[0]
    void generateTitle(
      chat.id,
      firstQuestion.content,
      firstAnswer?.textResponse.trim() ||
        (firstAnswer ? (resultOf(firstAnswer) ?? '') : ''),
      draftTitle
    )
  }

  return {
    inputMode,
    profileId,
    modelId,
    modelOptions,
    selectedModel,
    modelIssue,
    describeModelIssue,
    sourceImage,
    setSourceImage,
    isProfileLocked,
    isGenerating,
    turns,
    error,
    historySessionId: history.sessionId,
    setInputMode,
    setProfileId,
    setModelId,
    stopGeneration,
    answerToolApproval,
    getRecentInstructions,
    submitPrompt,
    applyReplyBlock,
    switchToChat,
  }
}

export type QuickAiRequestModel = ReturnType<typeof createQuickAiRequestModel>
