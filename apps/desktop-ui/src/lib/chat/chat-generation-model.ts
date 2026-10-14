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
export function createChatGenerationModel(
  deps: Pick<
    ChatModelDependencies,
    | 'sendChatMessage'
    | 'notifyError'
    | 'emptyMessageError'
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
    if (last?.role === 'assistant' && !last.content) {
      messages.value.pop()
      const user = messages.value.at(-1)
      if (user?.role === 'user') {
        lastFailedTurn.value = {
          message: user.content,
          attachments: user.attachments,
          images: user.images,
        }
      }
    } else if (last?.role === 'assistant') {
      const user = messages.value.at(-2)
      if (user?.role === 'user') {
        lastFailedTurn.value = {
          message: user.content,
          attachments: user.attachments,
          images: user.images,
        }
      }
      last.status = 'stopped'
      if (save) void persist(messages.value)
    }
  }

  const stopGeneration = () => halt(true)

  const sendMessage = async (
    message: string,
    attachments: ChatAttachment[] = [],
    images: ChatImage[] = []
  ) => {
    if (!message?.trim() && !images.length && !attachments.length) {
      deps.notifyError(deps.emptyMessageError())
      return ''
    }

    if (isGenerating.value) {
      return ''
    }

    const request = prepareGenerationRequest(
      deps,
      state,
      message,
      attachments,
      images
    )
    if (!request) return ''
    const { model, retrying, prevMessages } = request
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
    void persist(messages.value.slice(0, userMessageIndex + 1)).then(
      (saved) => {
        if (saved && chatId && currentChatParams.value.id === chatId) {
          void deps.saveSessionState({ lastChatId: chatId })
        }
      }
    )

    let result: string

    try {
      result = await deps.sendChatMessage(
        images.length ? userMessage : promptText,
        prevMessages,
        devInstructions,
        {
          modelId: model.id,
          signal: abortController.signal,
          onChunk: (chunk) => {
            if (currentGenerationId === generationId) {
              assistantMessage.content += chunk
            }
          },
        }
      )

      if (currentGenerationId !== generationId) return ''

      if (!assistantMessage.content && result) {
        // Fallback if streamer wasn't used but we got a full text result
        assistantMessage.content = result
      }
    } catch (e) {
      if (currentGenerationId === generationId) {
        error.value =
          deps.formatError?.(e) || (e instanceof Error ? e.message : String(e))
        if (!assistantMessage.content) {
          messages.value.splice(userMessageIndex + 1, 1)
          lastFailedTurn.value = { message, attachments, images }
          isGenerating.value = false
          abortController = null
          return ''
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

    if (currentGenerationId !== generationId) return ''

    if (!assistantMessage.content) {
      messages.value.splice(userMessageIndex, 2)
      return ''
    }

    if (await persist(messages.value)) {
      if (currentGenerationId === generationId)
        void maybeGenerateTitle(model.id)
    }

    return currentGenerationId === generationId ? assistantMessage.content : ''
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
    const pending = sendMessage(
      userMessage.content,
      userMessage.attachments,
      userMessage.images
    )
    const currentGenerationId = generationId
    const result = await pending
    if (!result && currentGenerationId === generationId) {
      // the old answer comes back; a retry would ask the question once more
      // after it, so the failure is only told
      const failure = error.value
      messages.value = previousMessages
      lastFailedTurn.value = null
      error.value = ''
      if (failure) deps.notifyError(failure)
      await persist(messages.value)
    }
    return result
  }

  return { halt, stopGeneration, sendMessage, retryLastTurn, regenerateMessage }
}
