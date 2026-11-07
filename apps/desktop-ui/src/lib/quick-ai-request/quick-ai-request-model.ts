import { computed, ref } from 'vue'
import type {
  AiProfile,
  AppConfig,
  Chat,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  ChatMessagePart,
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

/**
 * What the request is about. The selection may be empty; the screenshot may be
 * removed or retaken until the model answers over it.
 */
export type QuickAiRequestContext =
  | { kind: 'selection'; text?: string }
  | { kind: 'screenshot'; image?: ChatImage; images?: ChatImage[] }

/** A conversation the main window takes over with its images */
export interface QuickAiRequestScreenshotTransfer {
  chat: Chat
  question?: string
  profileId?: string
}

export interface QuickAiRequestModelDependencies {
  /** The selection without text when not given */
  context?: QuickAiRequestContext
  loadImage?: (id: string) => Promise<Uint8Array<ArrayBuffer>>
  /**
   * Hands a screenshot conversation to the main window. Its image lives in the
   * activation, so it cannot be saved from here like a text chat.
   */
  openScreenshotChat?: (
    transfer: QuickAiRequestScreenshotTransfer
  ) => Promise<void>
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
  /**
   * The id of the conversation, which the full chat keeps when it moves there;
   * see `quick-ai-request-session.ts`
   */
  chatId?: string
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
  const context = deps.context ?? { kind: 'selection' }
  const originalSourceText =
    context.kind === 'selection' ? context.text : undefined
  const isSourceTextDisabled = ref(false)
  const sourceText = computed(() =>
    isSourceTextDisabled.value ? undefined : originalSourceText
  )
  const isScreenshot = context.kind === 'screenshot'
  const inputMode = ref<'text' | 'voice'>(deps.initialInputMode ?? 'text')
  const profileId = ref<string | null>(deps.initialProfileId ?? null)
  const modelId = ref<string | null>(
    deps.getRememberedModelId(profileId.value) ?? null
  )
  const sourceImages = ref<ChatImage[]>(
    context.kind === 'screenshot'
      ? (context.images ?? (context.image ? [context.image] : []))
      : []
  )
  const sourceImage = computed(() => sourceImages.value[0])
  const isProfileLocked = ref(false)
  const isGenerating = ref(false)
  const turns = ref<QuickAiRequestTurn[]>([])
  const error = ref<string | null>(null)

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

  /** What a turn amounts to: the first block, else the answer */
  const resultOf = (turn: QuickAiRequestTurn) =>
    turn.replyBlocks[0]?.text || turn.textResponse.trim() || undefined

  const isSourceTextLocked = computed(
    () =>
      isGenerating.value ||
      turns.value.some((turn) => turn.status === 'done' || turn.textResponse)
  )

  const setSourceTextDisabled = (disabled: boolean) => {
    if (isSourceTextLocked.value) return
    isSourceTextDisabled.value = disabled
  }

  /**
   * The screenshot is fixed once the model has answered over it. A first
   * request that failed or was stopped before any answer leaves it
   * replaceable.
   */
  const isSourceImageLocked = computed(
    () =>
      isGenerating.value ||
      turns.value.some((turn) => turn.status === 'done' || turn.textResponse)
  )

  const setSourceImage = (image: ChatImage | undefined) => {
    if (isSourceImageLocked.value) return
    sourceImages.value = image ? [image] : []
  }

  const setSourceImages = (images: ChatImage[]) => {
    if (isSourceImageLocked.value) return
    sourceImages.value = images
  }

  const addSourceImage = (image: ChatImage) => {
    if (isSourceImageLocked.value) return
    if (!sourceImages.value.some((img) => img.id === image.id)) {
      sourceImages.value = [...sourceImages.value, image]
    }
  }

  const removeSourceImage = (id: string) => {
    if (isSourceImageLocked.value) return
    sourceImages.value = sourceImages.value.filter((img) => img.id !== id)
  }

  const firstTurnContext = () => ({
    ...(sourceText.value
      ? {
          attachments: [
            { text: sourceText.value, source: 'selection' as const },
          ],
        }
      : {}),
    ...(sourceImages.value.length ? { images: [...sourceImages.value] } : {}),
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

    if (sourceImages.value.length > 0 && !model.canUseImages) {
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
      for (const img of sourceImages.value) {
        try {
          if (!deps.loadImage) throw new Error('Image loader unavailable')
          imageBytes.set(img.id, await deps.loadImage(img.id))
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
      void saveQuickRequestChat()
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
    if (target === 'copy') {
      await deps.copyText(block.text)
      return
    }
    if (target === 'window') await deps.insertText(block.text)
    else await deps.toEditor(block.text, sourceText.value)
    deps.closeOverlay()
  }

  /** Names the chat after its first exchange, once it is saved */
  /** The title the model gave the chat, once it did */
  let generatedTitle: string | undefined
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
      if (title && title !== draftTitle) {
        await deps.renameChat(chatId, title, profileId.value ?? undefined)
        // later saves of the conversation keep it
        generatedTitle = title
      }
    } catch {
      // the draft title stays
    }
  }

  /** The conversation so far, the context in its first question */
  const conversationMessages = (): ChatMessage[] =>
    turns.value.flatMap((turn, index): ChatMessage[] => [
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
    ])

  const assignedChatId = deps.chatId ?? deps.createId()
  /** A chat moved to the main chat is an ordinary one there */
  const chatOf = (messages: ChatMessage[], isQuickRequest = false): Chat => ({
    id: assignedChatId,
    title:
      generatedTitle ??
      draftTitleOf(messages[0], deps.imageTitle?.() || 'Image'),
    lastMessageAt: Date.now(),
    messages,
    ...(isQuickRequest ? { isQuickRequest } : {}),
  })

  let chatTitleGenerated = false
  /** The last save of the conversation; a transfer waits for it */
  let pendingSave: Promise<void> = Promise.resolve()
  /** Keeps the conversation in the chat history, among the quick requests */
  const saveQuickRequestChat = () => {
    pendingSave = pendingSave.then(writeQuickRequestChat)
    return pendingSave
  }
  const writeQuickRequestChat = async () => {
    if (isScreenshot || turns.value.length === 0 || !deps.saveChat) return
    const messages = conversationMessages()
    if (messages.length === 0) return
    const chat = chatOf(messages, true)
    const pId = profileId.value ?? undefined
    try {
      await deps.saveChat(chat, pId)
      if (
        !chatTitleGenerated &&
        turns.value.length === 1 &&
        deps.generateChatTitle &&
        deps.renameChat
      ) {
        chatTitleGenerated = true
        const firstAnswer = turns.value[0]
        const answer =
          firstAnswer?.textResponse.trim() || resultOf(firstAnswer) || ''
        if (answer) {
          void generateTitle(
            chat.id,
            chat.messages[0].content,
            answer,
            chat.title
          )
        }
      }
    } catch {
      // Chat saving failure should not break the ongoing quick request.
    }
  }

  /** The image moves with the chat; an unanswered draft becomes its question */
  const transferScreenshotChat = async (draft?: string) => {
    if (!deps.openScreenshotChat)
      throw new Error('Screenshot chat transfer is unavailable')
    const messages = conversationMessages()
    const isUnanswered = messages.length === 0
    if (isUnanswered)
      messages.push({
        role: 'user',
        content: draft ?? '',
        ...firstTurnContext(),
      })
    await deps.openScreenshotChat({
      chat: chatOf(messages),
      question: isUnanswered ? undefined : draft,
      profileId: profileId.value ?? undefined,
    })
  }

  /** Saves the conversation here and opens it, then names it */
  const transferSavedChat = async (draft?: string) => {
    await pendingSave
    const chat = chatOf(conversationMessages())
    const pId = profileId.value ?? undefined
    await deps.saveChat?.(chat, pId)
    await deps.openMainChat({
      chatId: chat.id,
      profileId: pId,
      question: draft,
    })
    return () => {
      if (generatedTitle) return
      const firstAnswer = turns.value[0]
      void generateTitle(
        chat.id,
        chat.messages[0].content,
        firstAnswer?.textResponse.trim() ||
          (firstAnswer ? (resultOf(firstAnswer) ?? '') : ''),
        chat.title
      )
    }
  }

  /**
   * Continues the request in the main chat of its profile: a fresh chat with
   * the selection when nothing was asked yet, the whole conversation otherwise
   */
  const switchToChat = async (currentInputDraft?: string) => {
    stopGeneration()
    const draft = currentInputDraft?.trim() || undefined

    if (isScreenshot) {
      await transferScreenshotChat(draft)
      deps.closeOverlay()
      return
    }
    if (turns.value.length === 0) {
      await deps.openMainChat({
        attachment: sourceText.value
          ? { text: sourceText.value, source: 'selection' }
          : undefined,
        question: draft,
        profileId: profileId.value ?? undefined,
      })
      deps.closeOverlay()
      return
    }
    const nameChat = await transferSavedChat(draft)
    deps.closeOverlay()
    nameChat()
  }

  return {
    inputMode,
    profileId,
    modelId,
    modelOptions,
    selectedModel,
    modelIssue,
    describeModelIssue,
    sourceText,
    isSourceTextDisabled,
    isSourceTextLocked,
    setSourceTextDisabled,
    sourceImage,
    sourceImages,
    isSourceImageLocked,
    setSourceImage,
    setSourceImages,
    addSourceImage,
    removeSourceImage,
    isProfileLocked,
    isGenerating,
    turns,
    error,
    setInputMode,
    setProfileId,
    setModelId,
    stopGeneration,
    answerToolApproval,
    submitPrompt,
    applyReplyBlock,
    switchToChat,
  }
}

export type QuickAiRequestModel = ReturnType<typeof createQuickAiRequestModel>
