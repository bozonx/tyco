import { reactive, ref } from 'vue'

import { AI_TASKS } from '../../types'
import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
  trimChatContext,
} from './chat-helpers'
import { draftChatTitle, needsGeneratedTitle } from './chat-title'
import {
  APP_CONFIG,
  type ChatHistoryItem,
  type ChatMessage,
  type ChatParams,
  type LocalState,
} from '@tyco/shared'
import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'

/** The model a chat request runs on */
export interface ChatRequestModel {
  id: string
  /** How many characters the request may carry */
  budgetCharacters: number
}

export interface ChatStoreDeps {
  sendChatMessage: (
    message: string,
    prevMessages: ChatMessage[],
    devInstructions: string | undefined,
    options: {
      modelId: string
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
    }
  ) => Promise<string>
  /** A short title for the conversation; empty when none came out */
  generateChatTitle: (
    question: string,
    answer: string,
    modelId: string
  ) => Promise<string>
  saveChatHistory: (item: ChatHistoryItem) => void | Promise<void>
  renameChat: (id: string, title: string) => void | Promise<void>
  loadChatHistoryItem: (id: string) => Promise<ChatHistoryItem | null>
  navigateTo: (path: AppRoutePath) => void | Promise<void>
  notifyError: (message: string) => void
  emptyMessageError: () => string
  chatNotFoundError: () => string
  messageTooLongError: () => string
  noModelError: () => string
  createId: () => string
  nowIso: () => string
  saveLocalState: (state: Partial<LocalState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
  /** The model picked in the chat; null when none is available */
  getChatModel: () => ChatRequestModel | null
}

export function createChatStoreModel(deps: ChatStoreDeps) {
  const messages = ref<ChatMessage[]>([])
  const newChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const error = ref('')
  /** The editor text the user removed from the current chat */
  const dismissedEditorContext = ref<string | null>(null)
  const lastFailedTurn = ref<{
    message: string
    attachments?: string[]
  } | null>(null)
  const abortController = ref<AbortController | null>(null)
  let generationId = 0

  const currentTitle = () => newChatParams.value.title || ''

  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()

  /** Writes the chat as it is; a failure is reported by the dependency */
  const persist = (chatMessages: ChatMessage[]): Promise<boolean> => {
    const id = newChatParams.value.id
    if (!id || chatMessages.length === 0) return Promise.resolve(false)
    const entry = createChatHistoryEntry({
      id,
      description: currentTitle(),
      lastMsgDate: deps.nowIso(),
      messages: [...chatMessages],
    })
    const write = lastWrite.then(async () => {
      try {
        await deps.saveChatHistory(entry)
        return true
      } catch {
        return false
      }
    })
    lastWrite = write
    return write
  }

  /** Stops the answer; `save` keeps what came of it in the history */
  const halt = (save: boolean) => {
    generationId += 1
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
    if (!isGenerating.value) return
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
      if (save) void persist(messages.value)
    }
  }

  const stopGeneration = () => halt(true)

  const maybeGenerateTitle = async (modelId: string) => {
    const id = newChatParams.value.id
    const title = currentTitle()
    if (!id || !needsGeneratedTitle(messages.value, title)) return

    const [question, answer] = messages.value
    let generated: string
    try {
      generated = await deps.generateChatTitle(
        question.content,
        answer.content,
        modelId
      )
    } catch {
      // the draft title stays
      return
    }
    if (!generated) return

    const isCurrent = newChatParams.value.id === id
    // renamed meanwhile, by the user or in another way
    if (isCurrent && currentTitle() !== title) return
    if (isCurrent) newChatParams.value.title = generated
    try {
      await deps.renameChat(id, generated)
    } catch {
      // the dependency reports it; the chat keeps working
    }
  }

  const sendMessage = async (message: string, attachments: string[] = []) => {
    if (!message?.trim()) {
      deps.notifyError(deps.emptyMessageError())
      return
    }

    if (isGenerating.value) {
      return
    }

    const model = deps.getChatModel()
    if (!model) {
      deps.notifyError(deps.noModelError())
      return ''
    }

    const failed = lastFailedTurn.value
    if (
      failed?.message === message &&
      messages.value.at(-1)?.role === 'user' &&
      messages.value.at(-1)?.content === message
    ) {
      messages.value.pop()
      // the context of the failed turn goes with it again
      attachments = [
        ...new Set([...(failed.attachments || []), ...attachments]),
      ]
    }

    const inputSize =
      message.length + attachments.reduce((sum, item) => sum + item.length, 0)
    if (inputSize > model.budgetCharacters) {
      deps.notifyError(deps.messageTooLongError())
      return ''
    }

    error.value = ''
    lastFailedTurn.value = null

    const devInstructions = APP_CONFIG.aiInstructions[AI_TASKS.CHAT]
    const prevMessages = trimChatContext(
      messages.value,
      Math.max(0, model.budgetCharacters - inputSize)
    )

    const { preparedMessage, userMessage } = prepareChatRequest(
      message,
      attachments
    )

    const userMessageIndex = messages.value.length
    messages.value.push(userMessage)

    if (!newChatParams.value.id) {
      newChatParams.value.id = deps.createId()
    }
    if (!newChatParams.value.title) {
      newChatParams.value.title = draftChatTitle(message)
    }
    newChatParams.value.attachments = []
    dismissedEditorContext.value = null

    const assistantMessage = reactive<ChatMessage>(createAssistantMessage(''))
    messages.value.push(assistantMessage)

    isGenerating.value = true
    abortController.value = new AbortController()
    const currentGenerationId = ++generationId

    // the question is kept even when no answer comes
    void persist(messages.value.slice(0, userMessageIndex + 1)).then(
      (saved) => {
        if (saved && newChatParams.value.id) {
          void deps.saveLocalState({ lastChatId: newChatParams.value.id })
        }
      }
    )

    let result: string

    try {
      result = await deps.sendChatMessage(
        preparedMessage,
        prevMessages,
        devInstructions,
        {
          modelId: model.id,
          signal: abortController.value.signal,
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

    if (currentGenerationId !== generationId) return ''

    if (!assistantMessage.content) {
      messages.value.splice(userMessageIndex, 2)
      return ''
    }

    if (await persist(messages.value)) {
      void maybeGenerateTitle(model.id)
    }

    return assistantMessage.content
  }

  const reset = (chatParams: ChatParams = {}) => {
    messages.value = []
    newChatParams.value = chatParams
    error.value = ''
    dismissedEditorContext.value = null
    lastFailedTurn.value = null
  }

  const clearChat = () => {
    stopGeneration()
    reset()
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

  const addAttachment = (attachment: string) => {
    const trimmed = attachment?.trim()
    if (!trimmed) return
    const current = newChatParams.value.attachments || []
    if (!current.includes(trimmed)) {
      newChatParams.value.attachments = [...current, trimmed]
    }
  }

  /**
   * Gives the text to the chat: to the current one while it is still empty, to
   * a new one otherwise
   */
  const attachToChat = async (text: string) => {
    const trimmed = text?.trim()
    if (!trimmed) return
    if (messages.value.length > 0 || isGenerating.value) {
      await startChat({ attachments: [trimmed] })
      return
    }
    if (!newChatParams.value.id) newChatParams.value.id = deps.createId()
    addAttachment(trimmed)
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  /**
   * Leaves the current chat for a new empty one without writing it again: it is
   * being removed from the history
   */
  const abandonChat = () => {
    halt(false)
    reset({ id: deps.createId() })
  }

  const openChat = async (id: string, options: { silent?: boolean } = {}) => {
    const chat = await deps.loadChatHistoryItem(id)

    if (!chat) {
      if (!options.silent) deps.notifyError(deps.chatNotFoundError())
      return false
    }

    stopGeneration()
    reset({ id: chat.id, title: chat.description, attachments: [] })
    messages.value = [...chat.messages]
    await deps.saveLocalState({ lastChatId: chat.id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return true
  }

  return {
    messages,
    newChatParams,
    isGenerating,
    error,
    dismissedEditorContext,
    sendMessage,
    stopGeneration,
    retryLastTurn,
    regenerateMessage,
    startChat,
    openChat,
    clearChat,
    abandonChat,
    attachToChat,
    addAttachment,
    removeAttachment: (index: number) => {
      const current = newChatParams.value.attachments || []
      if (index >= 0 && index < current.length) {
        newChatParams.value.attachments = current.filter((_, i) => i !== index)
      }
    },
    /** Resolves once the writes started so far are done */
    whenSaved: () => lastWrite.then(() => undefined),
    dismissEditorContext: (text: string) => {
      dismissedEditorContext.value = text
    },
    /** Renames the current chat in memory, after it was renamed in storage */
    setTitle: (id: string, title: string) => {
      if (newChatParams.value.id === id) newChatParams.value.title = title
    },
    openLastOrNewChat: async () => {
      if (newChatParams.value.id) {
        await deps.navigateTo(APP_ROUTES.CHAT.path)
        return
      }

      const lastId = deps.getLastChatId()
      // the last chat may be gone: removed, or the history is off
      if (lastId && (await openChat(lastId, { silent: true }))) return
      await startChat({})
    },
  }
}
