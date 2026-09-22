import { reactive, ref } from 'vue'

import { AI_TASKS } from '../../types'
import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
  trimChatContext,
} from './chat-helpers'
import {
  APP_CONFIG,
  type ChatHistoryItem,
  type ChatMessage,
  type ChatParams,
  type LocalState,
} from '@tyco/shared'
import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'

export interface ChatStoreDeps {
  sendChatMessage: (
    message: string,
    prevMessages: ChatMessage[],
    devInstructions?: string,
    options?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
      onModel?: (model: { provider: string; model: string }) => void
    }
  ) => Promise<string>
  saveChatHistory: (item: ChatHistoryItem) => void | Promise<void>
  loadChatHistoryItem: (id: string) => Promise<ChatHistoryItem | null>
  navigateTo: (path: AppRoutePath) => void | Promise<void>
  notifyError: (message: string) => void
  emptyMessageError: () => string
  chatNotFoundError: () => string
  messageTooLongError: () => string
  createId: () => string
  nowIso: () => string
  saveLocalState: (state: Partial<LocalState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
  getContextBudgetCharacters: () => number
}

export function createChatStoreModel(deps: ChatStoreDeps) {
  const messages = ref<ChatMessage[]>([])
  const newChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const error = ref('')
  const activeModel = ref('')
  const lastFailedTurn = ref<{
    message: string
    attachments?: string[]
  } | null>(null)
  const abortController = ref<AbortController | null>(null)
  let generationId = 0

  const stopGeneration = () => {
    generationId += 1
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
    isGenerating.value = false
    const last = messages.value.at(-1)
    if (last?.role === 'assistant' && !last.content) {
      messages.value.pop()
      const user = messages.value.at(-1)
      if (user?.role === 'user') {
        lastFailedTurn.value = {
          message: user.content,
          attachments: user.attachments,
        }
      }
    } else if (last?.role === 'assistant') {
      last.status = 'stopped'
      const id = newChatParams.value.id
      if (id) {
        void Promise.resolve(
          deps.saveChatHistory(
            createChatHistoryEntry({
              id,
              description: newChatParams.value.initialMessage || '',
              lastMsgDate: deps.nowIso(),
              messages: [...messages.value],
            })
          )
        ).catch(() => deps.notifyError('Failed to save stopped response'))
      }
    }
  }

  const sendMessage = async (message: string, attachments?: string[]) => {
    if (!message?.trim()) {
      deps.notifyError(deps.emptyMessageError())
      return
    }

    if (isGenerating.value) {
      return
    }

    const inputSize =
      message.length +
      (attachments || []).reduce((sum, item) => sum + item.length, 0)
    if (inputSize > deps.getContextBudgetCharacters()) {
      deps.notifyError(deps.messageTooLongError())
      return
    }

    error.value = ''
    activeModel.value = ''
    const failed = lastFailedTurn.value
    if (
      failed?.message === message &&
      messages.value.at(-1)?.role === 'user' &&
      messages.value.at(-1)?.content === message
    ) {
      messages.value.pop()
    }
    lastFailedTurn.value = null

    const devInstructions = APP_CONFIG.aiInstructions[AI_TASKS.CHAT]
    const prevMessages = trimChatContext(
      messages.value,
      deps.getContextBudgetCharacters()
    )

    const { preparedMessage, userMessage } = prepareChatRequest(
      message,
      attachments
    )

    const userMessageIndex = messages.value.length
    messages.value.push(userMessage)

    const assistantMessage = reactive<ChatMessage>(createAssistantMessage(''))
    messages.value.push(assistantMessage)

    isGenerating.value = true
    abortController.value = new AbortController()
    const currentGenerationId = ++generationId

    let result: string

    try {
      result = await deps.sendChatMessage(
        preparedMessage,
        prevMessages,
        devInstructions,
        {
          signal: abortController.value.signal,
          onChunk: (chunk) => {
            if (currentGenerationId === generationId) {
              assistantMessage.content += chunk
            }
          },
          onModel: ({ provider, model }) => {
            if (currentGenerationId === generationId) {
              activeModel.value = `${model} · ${provider}`
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
        error.value = e instanceof Error ? e.message : String(e)
        if (!assistantMessage.content) {
          messages.value.splice(userMessageIndex + 1, 1)
          lastFailedTurn.value = { message, attachments }
          isGenerating.value = false
          abortController.value = null
          return ''
        }
        assistantMessage.status = 'stopped'
        lastFailedTurn.value = { message, attachments }
      }
    } finally {
      if (currentGenerationId === generationId) {
        isGenerating.value = false
        abortController.value = null
      }
    }

    if (!assistantMessage.content) {
      messages.value.splice(userMessageIndex, 2)
      return ''
    }

    if (!newChatParams.value.id) {
      newChatParams.value.id = deps.createId()
    }
    if (!newChatParams.value.initialMessage) {
      newChatParams.value.initialMessage = message
    }
    newChatParams.value.attachments = []

    await deps.saveChatHistory(
      createChatHistoryEntry({
        id: newChatParams.value.id,
        description: newChatParams.value.initialMessage,
        lastMsgDate: deps.nowIso(),
        messages: [...messages.value],
      })
    )

    if (newChatParams.value.id) {
      await deps.saveLocalState({ lastChatId: newChatParams.value.id })
    }

    return assistantMessage.content
  }

  const clearChat = () => {
    stopGeneration()
    messages.value = []
    newChatParams.value = {}
    error.value = ''
    activeModel.value = ''
    lastFailedTurn.value = null
  }

  const retryLastTurn = async () => {
    const failed = lastFailedTurn.value
    if (!failed || isGenerating.value) return ''

    const last = messages.value.at(-1)
    if (last?.role === 'assistant' && last.status === 'stopped') {
      messages.value.pop()
    }
    const lastUser = messages.value.at(-1)
    if (lastUser?.role === 'user' && lastUser.content === failed.message) {
      messages.value.pop()
    }

    return sendMessage(failed.message, failed.attachments)
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
    const result = await sendMessage(
      userMessage.content,
      userMessage.attachments
    )
    if (!result) messages.value = previousMessages
    return result
  }

  const startChat = async (chatParams: ChatParams) => {
    clearChat()
    newChatParams.value = { ...chatParams, id: deps.createId() }
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  const openChat = async (id: string) => {
    stopGeneration()
    const chat = await deps.loadChatHistoryItem(id)

    if (!chat) {
      deps.notifyError(deps.chatNotFoundError())
      return
    }

    messages.value = [...chat.messages]
    newChatParams.value = {
      id: chat.id,
      initialMessage: chat.description,
      attachments: [],
    }
    await deps.saveLocalState({ lastChatId: chat.id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  return {
    messages,
    newChatParams,
    isGenerating,
    error,
    activeModel,
    sendMessage,
    stopGeneration,
    retryLastTurn,
    regenerateMessage,
    startChat,
    openChat,
    clearChat,
    addAttachment: (attachment: string) => {
      const trimmed = attachment?.trim()
      if (!trimmed) return
      const current = newChatParams.value.attachments || []
      if (!current.includes(trimmed)) {
        newChatParams.value.attachments = [...current, trimmed]
      }
    },
    removeAttachment: (index: number) => {
      const current = newChatParams.value.attachments || []
      if (index >= 0 && index < current.length) {
        newChatParams.value.attachments = current.filter((_, i) => i !== index)
      }
    },
    openLastOrNewChat: async () => {
      if (newChatParams.value.id) {
        await deps.navigateTo(APP_ROUTES.CHAT.path)
        return
      }

      const lastId = deps.getLastChatId()
      if (lastId) {
        await openChat(lastId)
      } else {
        await startChat({})
      }
    },
  }
}
