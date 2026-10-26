import { reactive } from 'vue'
import {
  APP_CONFIG,
  type ChatMessage,
  type ChatAttachment,
  type ChatImage,
} from '@tyco/shared'
import { LlmInstructionKind } from '../../types'
import { prepareChatRequest } from './chat-request'
import { draftChatTitle } from './chat-title'
import { prepareGenerationRequest } from './chat-request-preparation'
import type { ChatModelDependencies } from './chat-model-contracts'
import type { ChatState } from './chat-state'
import {
  applyAnswerState,
  hasAnswer,
  settleUnfinishedToolCalls,
} from '../chat-tools/chat-message-steps'
type TurnResult =
  | { status: 'answered'; content: string }
  /** No answer, or one an error cut short */
  | { status: 'failed'; content: string }
  /** Stopped, or replaced by another turn */
  | { status: 'aborted' }
  /** Never started: nothing to send, no model, too long */
  | { status: 'rejected' }
const REJECTED: TurnResult = { status: 'rejected' }
const ABORTED: TurnResult = { status: 'aborted' }
const FAILED: TurnResult = { status: 'failed', content: '' }

export function createChatGenerationModel(
  deps: Pick<
    ChatModelDependencies,
    | 'sendChatMessage'
    | 'notifyError'
    | 'emptyMessageError'
    | 'emptyResponseError'
    | 'createId'
    | 'imageTitle'
    | 'saveSessionState'
    | 'formatError'
    | 'getChatModel'
    | 'noModelError'
    | 'imageModelError'
    | 'messageTooLongError'
    | 'imageOmittedText'
    | 'getChatInstructions'
  >,
  state: ChatState,
  persist: (messages: ChatMessage[]) => Promise<boolean>,
  maybeGenerateTitle: (modelId: string) => Promise<void>,
  cancelTitle: () => void
) {
  const {
    messages,
    currentChatParams,
    isGenerating,
    error,
    isStopped,
    trimmedTurnCount,
    lastFailedTurn,
  } = state
  /** The question of a turn, as a retry sends it again */
  const failedTurnOf = (user: ChatMessage) => ({
    message: user.content,
    attachments: user.attachments,
    images: user.images,
  })
  let abortController: AbortController | null = null
  let generationId = 0
  /** Stops the answer; `save` keeps what came of it in the history */
  const halt = (save: boolean) => {
    generationId += 1
    cancelTitle()
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    if (!isGenerating.value) return
    isGenerating.value = false
    isStopped.value = true
    const last = messages.value.at(-1)
    if (last?.role !== 'assistant') return
    settleUnfinishedToolCalls(last)
    const answered = hasAnswer(last)
    if (!answered) messages.value.pop()
    const user = messages.value.at(answered ? -2 : -1)
    if (user?.role === 'user') lastFailedTurn.value = failedTurnOf(user)
    if (answered) {
      last.status = 'stopped'
      if (save) void persist(messages.value)
    }
  }

  const stopGeneration = () => halt(true)

  /**
   * One question and its answer. `saveQuestion: false` keeps the stored chat as
   * it is until the answer comes, for a turn that replaces later ones
   */
  const runTurn = async (
    message: string,
    attachments: ChatAttachment[],
    images: ChatImage[],
    { saveQuestion = true }: { saveQuestion?: boolean } = {}
  ): Promise<TurnResult> => {
    if (!message?.trim() && !images.length && !attachments.length) {
      deps.notifyError(deps.emptyMessageError())
      return REJECTED
    }

    if (isGenerating.value) {
      return REJECTED
    }

    const request = prepareGenerationRequest(
      deps,
      state,
      message,
      attachments,
      images
    )
    if (!request) return REJECTED
    const { model, retrying, prevMessages, toolOutputBudgetCharacters } =
      request
    attachments = request.attachments
    trimmedTurnCount.value = request.trimmedTurnCount
    if (retrying) messages.value.pop()
    error.value = ''
    isStopped.value = false
    lastFailedTurn.value = null

    const devInstructions = deps.getChatInstructions
      ? deps.getChatInstructions()
      : APP_CONFIG.aiInstructions[LlmInstructionKind.CHAT]

    const { promptText, userMessage } = prepareChatRequest(message, attachments)

    if (images.length)
      userMessage.images = images.map((image) => ({ ...image }))

    const userMessageIndex = messages.value.length
    messages.value.push(userMessage)

    if (!currentChatParams.value.id) {
      currentChatParams.value.id = deps.createId()
    }
    if (!currentChatParams.value.title) {
      currentChatParams.value.title = message.trim()
        ? draftChatTitle(message)
        : attachments[0]?.name || deps.imageTitle?.() || 'Image'
    }
    currentChatParams.value.attachments = []
    currentChatParams.value.images = []

    const assistantMessage = reactive<ChatMessage>({
      role: 'assistant',
      content: '',
    })
    messages.value.push(assistantMessage)

    isGenerating.value = true
    abortController = new AbortController()
    const currentGenerationId = ++generationId

    // the question is kept even when no answer comes
    const chatId = currentChatParams.value.id
    if (saveQuestion)
      void persist(messages.value.slice(0, userMessageIndex + 1)).then(
        (saved) => {
          if (saved && chatId && currentChatParams.value.id === chatId) {
            void deps.saveSessionState({ lastChatId: chatId })
          }
        }
      )

    let result: Awaited<ReturnType<typeof deps.sendChatMessage>>

    try {
      result = await deps.sendChatMessage(
        images.length ? userMessage : promptText,
        prevMessages,
        devInstructions,
        {
          modelId: model.id,
          signal: abortController.signal,
          ...(toolOutputBudgetCharacters !== undefined
            ? { toolOutputBudgetCharacters }
            : {}),
          onUpdate: (answer) => {
            if (currentGenerationId === generationId) {
              applyAnswerState(assistantMessage, answer)
            }
          },
        }
      )

      if (currentGenerationId !== generationId) return ABORTED

      if (!hasAnswer(assistantMessage) && hasAnswer(result)) {
        // Fallback if streamer wasn't used but we got a full text result
        applyAnswerState(assistantMessage, result)
      }
      if (!hasAnswer(assistantMessage)) {
        throw new Error(
          deps.emptyResponseError?.() ?? 'The model returned an empty result'
        )
      }
    } catch (e) {
      if (currentGenerationId === generationId) {
        error.value =
          deps.formatError?.(e) || (e instanceof Error ? e.message : String(e))
        settleUnfinishedToolCalls(assistantMessage)
        if (!hasAnswer(assistantMessage)) {
          messages.value.splice(userMessageIndex + 1, 1)
          lastFailedTurn.value = { message, attachments, images }
          isGenerating.value = false
          abortController = null
          return FAILED
        }
        assistantMessage.status = 'stopped'
        lastFailedTurn.value = { message, attachments, images }
      }
    } finally {
      if (currentGenerationId === generationId) {
        isGenerating.value = false
        abortController = null
      }
    }

    if (currentGenerationId !== generationId) return ABORTED

    settleUnfinishedToolCalls(assistantMessage)
    if (!hasAnswer(assistantMessage)) {
      messages.value.splice(userMessageIndex, 2)
      return FAILED
    }

    const saved = await persist(messages.value)
    if (
      saved &&
      !saveQuestion &&
      chatId &&
      currentChatParams.value.id === chatId
    )
      void deps.saveSessionState({ lastChatId: chatId })
    if (currentGenerationId !== generationId) return ABORTED
    if (saved) void maybeGenerateTitle(model.id)
    // an answer cut by an error is kept, but the turn still failed
    if (error.value)
      return { status: 'failed', content: assistantMessage.content }
    return { status: 'answered', content: assistantMessage.content }
  }

  const sendMessage = async (
    message: string,
    attachments: ChatAttachment[] = [],
    images: ChatImage[] = []
  ) => {
    const result = await runTurn(message, attachments, images)
    return result.status === 'aborted' || result.status === 'rejected'
      ? ''
      : result.content
  }

  const retryLastTurn = async () => {
    const failed = lastFailedTurn.value
    if (!failed || isGenerating.value) return ''

    const previousMessages = [...messages.value]
    const beforeGeneration = generationId
    const last = messages.value.at(-1)
    if (last?.role === 'assistant' && last.status === 'stopped') {
      messages.value.pop()
    }
    const lastUser = messages.value.at(-1)
    if (lastUser?.role === 'user' && lastUser.content === failed.message) {
      messages.value.pop()
    }

    const result = await sendMessage(
      failed.message,
      failed.attachments,
      failed.images
    )
    if (generationId === beforeGeneration) messages.value = previousMessages
    return result
  }

  const regenerateMessage = async (assistantIndex: number) => {
    if (
      isGenerating.value ||
      messages.value[assistantIndex]?.role !== 'assistant'
    ) {
      return ''
    }

    let userIndex = assistantIndex - 1
    while (userIndex >= 0 && messages.value[userIndex]?.role !== 'user') {
      userIndex -= 1
    }
    const userMessage = messages.value[userIndex]
    if (!userMessage) return ''

    const previousMessages = [...messages.value]
    messages.value = messages.value.slice(0, userIndex)
    // the stored chat keeps the later turns until the new answer replaces them
    const result = await runTurn(
      userMessage.content,
      userMessage.attachments ?? [],
      userMessage.images ?? [],
      { saveQuestion: false }
    )
    // a partial answer cut by an error is already stored and stays
    if (
      result.status === 'rejected' ||
      (result.status === 'failed' && !result.content)
    ) {
      // the old answer comes back; a retry would ask the question once more
      // after it, so the failure is only told
      const failure = error.value
      messages.value = previousMessages
      lastFailedTurn.value = null
      error.value = ''
      isStopped.value = false
      if (failure) deps.notifyError(failure)
      return ''
    }
    return result.status === 'aborted' ? '' : result.content
  }

  return { halt, stopGeneration, sendMessage, retryLastTurn, regenerateMessage }
}
