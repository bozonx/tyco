import { computed, ref } from 'vue'
import {
  APP_CONFIG,
  type Chat,
  type ChatAttachment,
  type ChatImage,
  type ChatMessage,
  type ChatMessagePart,
} from '@tyco/shared'

import type { ChatToolDecision } from '../chat-tools/chat-tool-policy'
import type { ChatToolLoopState } from '../chat-tools/chat-tool-loop'
import { hasAnswer } from '../chat-tools/chat-message-steps'
import { createChatGenerationModel } from '../chat/chat-generation-model'
import {
  chatRequestBudgetCharacters,
  type ChatLlmOption,
} from '../chat/chat-llm-selection'
import { createChatPersistenceQueue } from '../chat/chat-persistence-queue'
import { createChatState } from '../chat/chat-state'
import { draftTitleOf } from '../chat/chat-title'
import { createChatTitleController } from '../chat/chat-title-controller'
import {
  extractReplyBlocks,
  REPLY_BLOCKS_TOOL_NAME,
  type ReplyBlockData,
} from '../reply-blocks/reply-blocks-tool'

/**
 * One question of the request and its answer, as the quick feed shows them. It
 * is a view of the chat messages, which are the conversation itself
 */
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

/** A conversation the main window takes over, with its id and images */
export interface QuickAiRequestTransfer {
  chat: Chat
  question?: string
  profileId?: string
}

/** What a turn sends besides its messages */
export interface QuickAiRequestTurnOptions {
  modelId: string
  profileId: string | null
  instructions: string
  signal?: AbortSignal
  onUpdate: (state: ChatToolLoopState) => void
  /** What the outputs of the turn's tools may add to the request */
  toolOutputBudgetCharacters?: number
}

export interface QuickAiRequestModelDependencies {
  /** The selection without text when not given */
  context?: QuickAiRequestContext
  initialInputMode?: 'text' | 'voice'
  initialProfileId?: string | null

  /** The models the user can call */
  getModelOptions: () => ChatLlmOption[]
  /** The model last picked for quick requests of this profile, if any */
  getRememberedModelId: (profileId: string | null) => string | undefined
  rememberModelId: (profileId: string | null, modelId: string) => Promise<void>
  /** The rules of the quick request task */
  getRules: () => string | undefined

  /**
   * The instructions of a turn: those of the quick request and, with a profile,
   * its SOUL.md and memory. Read anew before each turn
   */
  resolveInstructions: (profileId: string | null) => Promise<string>
  /** Whether the turn may call tools, so that part of the budget is kept */
  mayOfferTools?: (profileId: string | null) => boolean
  /** One chat turn: `messages` are the history, `message` the question */
  sendTurn: (
    message: ChatMessage,
    messages: ChatMessage[],
    options: QuickAiRequestTurnOptions
  ) => Promise<ChatToolLoopState>
  answerToolApproval: (approvalId: string, decision: ChatToolDecision) => void
  /** Cancels the calls waiting for the user */
  cancelToolApprovals: () => void

  insertText: (text: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  toEditor: (text: string, sourceText?: string) => Promise<void>

  /** Opens the main chat fresh, before anything was asked here */
  openMainChat: (params: {
    attachment?: ChatAttachment
    question?: string
    profileId?: string
  }) => Promise<void>
  /** Hands the conversation, its id and images, to the main window */
  transferChat: (transfer: QuickAiRequestTransfer) => Promise<void>

  saveChat: (chat: Chat, profileId: string | null) => Promise<void>
  renameChat: (
    chatId: string,
    title: string,
    profileId: string | null
  ) => Promise<void>
  /** A short title for a conversation; empty when none came out */
  generateChatTitle: (
    question: string,
    answer: string,
    modelId: string,
    signal?: AbortSignal
  ) => Promise<string>
  /** Whether chats of the profile are stored at all */
  isHistoryEnabled: (profileId: string | null) => boolean
  /** Whether quick requests of the profile are stored with its chats */
  isQuickRequestSavingEnabled: (profileId: string | null) => boolean

  createId: () => string
  /**
   * The id of the conversation, which the full chat keeps when it moves there;
   * see `quick-ai-request-session.ts`
   */
  chatId?: string
  nowMs?: () => number
  closeOverlay: () => void

  noModelError?: () => string
  toolsRequiredError?: () => string
  imageModelError?: () => string
  messageTooLongError?: () => string
  emptyResponseError?: () => string
  /** The title of a chat whose first question has images only */
  imageTitle?: () => string
  imageOmittedText?: () => string
  formatError?: (error: unknown) => string
}

const MODEL_ISSUE_FALLBACK: Record<QuickAiRequestModelIssue, string> = {
  noModel: 'Choose a model for quick requests.',
  toolsRequired:
    'The model cannot call tools. Quick requests and chats need a model with tool calling.',
}

const replyBlocksOf = (parts: ChatMessagePart[]): ReplyBlockData[] =>
  parts.flatMap((part) =>
    part.type === 'tool-call' && part.toolName === REPLY_BLOCKS_TOOL_NAME
      ? extractReplyBlocks(part.input)
      : []
  )

/**
 * A quick request is a chat with another face: its turns run, are stored and
 * named by the same parts as the main chat; it is stored among the quick
 * requests until it moves to the main chat
 */
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
  /** Why the last request was not sent: no model, too long and the like */
  const notice = ref<string | null>(null)
  /** How each question was asked, by its place among the questions */
  const inputKinds = ref<('text' | 'voice')[]>([])

  const state = createChatState()
  const { messages, currentChatParams, isGenerating } = state
  currentChatParams.value = { id: deps.chatId ?? deps.createId() }
  const chatId = currentChatParams.value.id as string

  /** Stored among the quick requests until it moves to the main chat */
  let isQuickRequest = true
  const isStored = () =>
    deps.isHistoryEnabled(profileId.value) &&
    deps.isQuickRequestSavingEnabled(profileId.value)

  const persistence = createChatPersistenceQueue(
    {
      saveChat: (chat) =>
        deps.saveChat(
          isQuickRequest ? { ...chat, isQuickRequest: true } : chat,
          profileId.value
        ),
      renameChat: (id, title) => deps.renameChat(id, title, profileId.value),
      nowMs: deps.nowMs ?? (() => Date.now()),
    },
    state
  )
  const title = createChatTitleController(
    {
      generateChatTitle: deps.generateChatTitle,
      // a request kept in memory only is named too: the title goes with it
      // when it moves to the main chat
      renameChat: async (id, newTitle, options) => {
        if (isStored()) await persistence.renameChat(id, newTitle, options)
        else currentChatParams.value.title = newTitle
      },
      isHistoryEnabled: () => deps.isHistoryEnabled(profileId.value),
      imageTitle: deps.imageTitle,
    },
    state
  )

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

  /** The instructions the current turn read, see `prepareTurn` */
  let turnInstructions = ''

  const generation = createChatGenerationModel(
    {
      sendChatMessage: (message, prevMessages, _instructions, options) =>
        deps.sendTurn(
          typeof message === 'string'
            ? { role: 'user', content: message }
            : message,
          prevMessages,
          {
            ...options,
            profileId: profileId.value,
            instructions: turnInstructions,
          }
        ),
      prepareTurn: async () => {
        turnInstructions = await deps.resolveInstructions(profileId.value)
      },
      getChatInstructions: () => turnInstructions,
      getChatModel: () => {
        const picked = selectedModel.value
        return picked
          ? {
              id: picked.id,
              canUseImages: picked.canUseImages,
              canUseTools: picked.canUseTools,
              budgetCharacters: chatRequestBudgetCharacters(picked, {
                instructions: turnInstructions,
                rules: deps.getRules(),
                rulePrefix: APP_CONFIG.rulePrefix,
              }),
              reservesToolSteps:
                deps.mayOfferTools?.(profileId.value) ?? picked.canUseTools,
            }
          : null
      },
      notifyError: (message) => {
        notice.value = message
      },
      emptyMessageError: () => '',
      emptyResponseError: deps.emptyResponseError,
      noModelError: () => describeModelIssue('noModel'),
      toolsRequiredError: () => describeModelIssue('toolsRequired'),
      imageModelError: () =>
        deps.imageModelError?.() ??
        'Choose a model that supports images in model settings.',
      messageTooLongError: () =>
        deps.messageTooLongError?.() ?? 'The request is too long.',
      imageOmittedText: deps.imageOmittedText,
      imageTitle: deps.imageTitle,
      formatError: deps.formatError,
      createId: deps.createId,
      // the quick request is no chat to reopen
      saveSessionState: () => {},
    },
    state,
    persistence.persist,
    title.maybeGenerateTitle,
    title.cancel
  )

  const questionCount = () =>
    messages.value.filter((message) => message.role === 'user').length

  const turns = computed<QuickAiRequestTurn[]>(() => {
    const list = messages.value
    const lastQuestion = list.reduce(
      (last, item, index) => (item.role === 'user' ? index : last),
      -1
    )
    let questionIndex = -1
    return list.flatMap((message, index): QuickAiRequestTurn[] => {
      if (message.role !== 'user') return []
      questionIndex += 1
      const next = list[index + 1]
      const answer = next?.role === 'assistant' ? next : undefined
      const isLast = index === lastQuestion
      const failure = isLast ? state.error.value : ''
      const status: QuickAiRequestTurn['status'] =
        isLast && isGenerating.value
          ? 'generating'
          : failure
            ? 'error'
            : !answer || answer.status === 'stopped'
              ? 'stopped'
              : 'done'
      const parts = answer?.parts ?? []
      return [
        {
          id: `${chatId}-${questionIndex}`,
          prompt: message.content,
          inputKind: inputKinds.value[questionIndex] ?? 'text',
          parts,
          replyBlocks: replyBlocksOf(parts),
          textResponse: answer?.content ?? '',
          status,
          ...(failure ? { error: failure } : {}),
        },
      ]
    })
  })

  const error = computed(() => notice.value ?? (state.error.value || null))

  /** The model answered something: the context is part of the chat now */
  const hasAnyAnswer = computed(() =>
    messages.value.some(
      (message) => message.role === 'assistant' && hasAnswer(message)
    )
  )

  /** The selection and the screenshot are fixed once the model answered */
  const isSourceTextLocked = computed(
    () => isGenerating.value || hasAnyAnswer.value
  )
  const isSourceImageLocked = isSourceTextLocked

  const setSourceTextDisabled = (disabled: boolean) => {
    if (isSourceTextLocked.value) return
    isSourceTextDisabled.value = disabled
  }

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

  const setInputMode = (mode: 'text' | 'voice') => {
    inputMode.value = mode
  }

  const setProfileId = (id: string | null) => {
    if (isProfileLocked.value) return
    profileId.value = id
    // every profile keeps the model it was last asked with
    modelId.value = deps.getRememberedModelId(id) ?? null
    notice.value = null
  }

  /** Picks the model of the next requests and remembers it for the profile */
  const setModelId = async (id: string) => {
    if (isGenerating.value || id === modelId.value) return
    modelId.value = id
    notice.value = null
    await deps.rememberModelId(profileId.value, id)
  }

  const stopGeneration = () => {
    generation.stopGeneration()
    deps.cancelToolApprovals()
  }

  const answerToolApproval = (
    approvalId: string,
    decision: ChatToolDecision
  ) => {
    deps.answerToolApproval(approvalId, decision)
  }

  /**
   * A question that got no answer, failed or stopped before any came, gives way
   * to the next one: it is neither sent again nor stored
   */
  const dropUnansweredQuestion = () => {
    if (messages.value.at(-1)?.role !== 'user') return
    messages.value = messages.value.slice(0, -1)
    inputKinds.value = inputKinds.value.slice(0, questionCount())
    state.error.value = ''
    state.isStopped.value = false
    state.lastFailedTurn.value = null
  }

  const submitPrompt = async (
    promptText: string,
    mode: 'text' | 'voice' = inputMode.value,
    /** The question is in the feed: the prompt may be cleared at once */
    onAccepted?: () => void
  ): Promise<boolean> => {
    const trimmed = promptText.trim()
    if (!trimmed || isGenerating.value) return false

    notice.value = null
    const issue = modelIssue.value
    if (issue) {
      notice.value = describeModelIssue(issue)
      return false
    }

    dropUnansweredQuestion()
    // the context goes with the first question
    const isFirst = questionCount() === 0
    const attachments: ChatAttachment[] =
      isFirst && sourceText.value
        ? [{ text: sourceText.value, source: 'selection' }]
        : []
    const images = isFirst ? [...sourceImages.value] : []

    const result = await generation.runTurn(trimmed, attachments, images, {
      // the chat is stored with the answer: a request that got none leaves
      // nothing behind
      saveQuestion: false,
      onAccepted: () => {
        isProfileLocked.value = true
        const kinds = inputKinds.value.slice(0, questionCount() - 1)
        inputKinds.value = [...kinds, mode]
        onAccepted?.()
      },
    })
    return result.status === 'answered'
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

  /**
   * Continues the request in the main chat of its profile: a fresh chat with
   * the context when nothing was answered yet, the whole conversation
   * otherwise. The conversation keeps its id there and becomes an ordinary
   * chat
   */
  const switchToChat = async (currentInputDraft?: string) => {
    stopGeneration()
    const draft = currentInputDraft?.trim() || undefined
    dropUnansweredQuestion()
    const pId = profileId.value ?? undefined

    if (messages.value.length === 0) {
      if (sourceImages.value.length) {
        // the images move with a conversation; the draft becomes its question
        await deps.transferChat({
          chat: {
            id: chatId,
            title: draftTitleOf(
              { content: draft ?? '' },
              deps.imageTitle?.() || 'Image'
            ),
            lastMessageAt: Date.now(),
            messages: [
              {
                role: 'user',
                content: draft ?? '',
                images: [...sourceImages.value],
              },
            ],
          },
          profileId: pId,
        })
      } else {
        await deps.openMainChat({
          attachment: sourceText.value
            ? { text: sourceText.value, source: 'selection' }
            : undefined,
          question: draft,
          profileId: pId,
        })
      }
      deps.closeOverlay()
      return
    }

    await persistence.whenSaved()
    isQuickRequest = false
    await deps.transferChat({
      chat: {
        id: chatId,
        title: currentChatParams.value.title || '',
        lastMessageAt: Date.now(),
        messages: [...messages.value],
      },
      question: draft,
      profileId: pId,
    })
    deps.closeOverlay()
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
