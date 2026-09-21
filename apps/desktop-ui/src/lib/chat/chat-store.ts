import { reactive, ref } from 'vue'

import { AI_TASKS } from '../../types'
import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
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
      onProgress?: (progress: {
        status: string
        file?: string
        progress?: number
      }) => void
    }
  ) => Promise<string>
  saveChatHistory: (item: ChatHistoryItem) => void | Promise<void>
  loadChatHistoryItem: (id: string) => Promise<ChatHistoryItem | null>
  navigateTo: (path: AppRoutePath) => void | Promise<void>
  notifyError: (message: string) => void
  emptyMessageError: () => string
  chatNotFoundError: () => string
  createId: () => string
  nowIso: () => string
  saveLocalState: (state: Partial<LocalState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
}

export function createChatStoreModel(deps: ChatStoreDeps) {
  const messages = ref<ChatMessage[]>([])
  const newChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const loadingProgress = ref('')
  const error = ref('')
  const lastFailedTurn = ref<{
    message: string
    attachments?: string[]
    role?: string
  } | null>(null)
  const abortController = ref<AbortController | null>(null)

  const stopGeneration = () => {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
  }

  const sendMessage = async (
    message: string,
    attachments?: string[],
    role?: string
  ) => {
    if (!message?.trim()) {
      deps.notifyError(deps.emptyMessageError())
      return
    }

    if (isGenerating.value) {
      return
    }

    error.value = ''
    lastFailedTurn.value = null

    let devInstructions: string | undefined
    // Keep only the last 20 messages for context to avoid overflowing context limits
    const prevMessages = messages.value.slice(-20)

    if (prevMessages.length > 0) {
      devInstructions = APP_CONFIG.aiInstructions[AI_TASKS.CHAT]
    }

    const { preparedMessage, userMessage } = prepareChatRequest(
      message,
      attachments,
      role
    )

    const userMessageIndex = messages.value.length
    messages.value.push(userMessage)

    const assistantMessage = reactive<ChatMessage>(createAssistantMessage(''))
    messages.value.push(assistantMessage)

    isGenerating.value = true
    loadingProgress.value = ''
    abortController.value = new AbortController()

    let result: string

    try {
      result = await deps.sendChatMessage(
        preparedMessage,
        prevMessages,
        devInstructions,
        {
          signal: abortController.value.signal,
          onChunk: (chunk) => {
            assistantMessage.content += chunk
          },
          onProgress: (progress) => {
            if (progress.status === 'ready' || progress.status === 'done') {
              loadingProgress.value = ''
            } else {
              const pct = progress.progress
                ? ` ${Math.round(progress.progress)}%`
                : ''
              const file = progress.file ? ` (${progress.file})` : ''
              loadingProgress.value = `${progress.status}${file}${pct}`
            }
          },
        }
      )

      if (!assistantMessage.content && result) {
        // Fallback if streamer wasn't used but we got a full text result
        assistantMessage.content = result
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'AbortError') {
        // User aborted, it's fine
      } else {
        error.value = e instanceof Error ? e.message : String(e)
        if (!assistantMessage.content) {
          messages.value.splice(userMessageIndex + 1, 1)
          lastFailedTurn.value = { message, attachments, role }
          isGenerating.value = false
          abortController.value = null
          return ''
        }
      }
    } finally {
      isGenerating.value = false
      loadingProgress.value = ''
      abortController.value = null
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
    messages.value = []
    newChatParams.value = {}
    error.value = ''
    lastFailedTurn.value = null
  }

  const retryLastTurn = async () => {
    const failed = lastFailedTurn.value
    if (!failed || isGenerating.value) return ''

    const last = messages.value.at(-1)
    if (last?.role === 'user' && last.content === failed.message) {
      messages.value.pop()
    }

    return sendMessage(failed.message, failed.attachments, failed.role)
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

    messages.value = messages.value.slice(0, userIndex)
    return sendMessage(userMessage.content, userMessage.attachments)
  }

  const startChat = async (chatParams: ChatParams) => {
    clearChat()
    newChatParams.value = { ...chatParams, id: deps.createId() }
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  const openChat = async (id: string) => {
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
    loadingProgress,
    error,
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
