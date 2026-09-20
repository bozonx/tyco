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
} from '@shared'
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

    let result = ''

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
        deps.notifyError(e instanceof Error ? e.message : String(e))
        // Roll back the optimistic user/assistant pair when nothing was produced.
        if (!assistantMessage.content) {
          messages.value.splice(userMessageIndex, 2)
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
      // Request failed or was aborted with no content
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
    sendMessage,
    stopGeneration,
    startChat,
    openChat,
    clearChat,
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
