import { reactive, ref } from 'vue'

import { AI_TASKS } from '../../types'
import {
  createAssistantMessage,
  createChatHistoryEntry,
  prepareChatRequest,
  trimChatContext,
} from './chat-helpers'
import { imageBudgetCharacters, MAX_CHAT_IMAGES } from './chat-image-input'

import { draftChatTitle, needsGeneratedTitle } from './chat-title'
import {
  APP_CONFIG,
  type ChatAttachment,
  type ChatImage,
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
  vision?: boolean
  budgetCharacters: number
}

export interface ChatStoreDeps {
  sendChatMessage: (
    message: string | ChatMessage,
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
    modelId: string,
    signal?: AbortSignal
  ) => Promise<string>
  saveChatHistory: (item: ChatHistoryItem) => void | Promise<void>
  renameChat: (id: string, title: string) => void | Promise<void>
  loadChatHistoryItem: (id: string) => Promise<ChatHistoryItem | null>
  navigateTo: (path: AppRoutePath) => void | Promise<void>
  notifyError: (message: string) => void
  emptyMessageError: () => string
  chatNotFoundError: () => string
  /** The stored chat could not be read */
  chatLoadError?: () => string
  messageTooLongError: () => string
  noModelError: () => string
  imageModelError?: () => string
  imageTitle?: () => string
  imageOmittedText?: () => string
  formatError?: (error: unknown) => string
  createId: () => string
  nowIso: () => string
  saveLocalState: (state: Partial<LocalState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
  /** The model picked in the chat; null when none is available */
  getChatModel: () => ChatRequestModel | null
  /** Whether chats are stored; a title is generated only for a stored chat */
  isHistoryEnabled?: () => boolean
}

/** The same text attached twice goes once, with the source it came first */
const uniqueAttachments = (attachments: ChatAttachment[]) =>
  attachments.filter(
    (item, index) =>
      attachments.findIndex(
        (other) => other.text === item.text && other.name === item.name
      ) === index
  )

export function createChatStoreModel(deps: ChatStoreDeps) {
  const messages = ref<ChatMessage[]>([])
  const newChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const error = ref('')
  const isStopped = ref(false)
  const omitHistoryImages = ref(false)
  const trimmedTurns = ref(0)
  /** The editor text the user removed from the current chat */
  const dismissedEditorContext = ref<string | null>(null)
  /** The suggested editor text the user took into the next message */
  const acceptedEditorContext = ref<string | null>(null)
  const lastFailedTurn = ref<{
    message: string
    attachments?: ChatAttachment[]
    images?: ChatImage[]
  } | null>(null)
  let abortController: AbortController | null = null
  let generationId = 0
  /** Bumped by every switch of the chat, so that a slow open lands nowhere */
  let openRequest = 0
  let titleController: AbortController | undefined

  const currentTitle = () => newChatParams.value.title || ''

  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()
  const savingImages = ref<ChatImage[]>([])

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
    const held = chatMessages.flatMap((message) => message.images || [])
    savingImages.value.push(...held)
    const write = lastWrite.then(async () => {
      try {
        await deps.saveChatHistory(entry)
        return true
      } catch {
        return false
      } finally {
        for (const image of held) {
          const index = savingImages.value.indexOf(image)
          if (index >= 0) savingImages.value.splice(index, 1)
        }
      }
    })
    lastWrite = write
    return write
  }

  /** Stops the answer; `save` keeps what came of it in the history */
  const halt = (save: boolean) => {
    generationId += 1
    titleController?.abort()
    titleController = undefined
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

  const maybeGenerateTitle = async (modelId: string) => {
    const id = newChatParams.value.id
    const title = currentTitle()
    if (deps.isHistoryEnabled?.() === false) return
    if (!id || !needsGeneratedTitle(messages.value, title)) return

    const [question, answer] = messages.value
    titleController?.abort()
    const controller = new AbortController()
    titleController = controller
    let generated: string
    try {
      generated = await deps.generateChatTitle(
        question.content,
        answer.content,
        modelId,
        controller.signal
      )
    } catch {
      // the draft title stays
      return
    } finally {
      if (titleController === controller) titleController = undefined
    }
    if (!generated || controller.signal.aborted) return

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

    const model = deps.getChatModel()
    if (!model) {
      deps.notifyError(deps.noModelError())
      return ''
    }

    if (
      images.length > MAX_CHAT_IMAGES ||
      (images.length > 0 && !model.vision)
    ) {
      deps.notifyError(deps.imageModelError?.() || deps.noModelError())
      return ''
    }

    const failed = lastFailedTurn.value
    const retrying = Boolean(
      failed?.message === message &&
      JSON.stringify(failed.images || []) === JSON.stringify(images) &&
      messages.value.at(-1)?.role === 'user' &&
      messages.value.at(-1)?.content === message
    )
    if (retrying) {
      // the context of the failed turn goes with it again
      attachments = uniqueAttachments([
        ...(failed?.attachments || []),
        ...attachments,
      ])
    }

    const inputSize =
      images.reduce((sum, image) => sum + imageBudgetCharacters(image), 0) +
      message.length +
      attachments.reduce((sum, item) => sum + item.text.length, 0)
    if (inputSize > model.budgetCharacters) {
      deps.notifyError(deps.messageTooLongError())
      return ''
    }

    const history = retrying ? messages.value.slice(0, -1) : messages.value
    const requestHistory = omitHistoryImages.value
      ? history.map((item) =>
          item.images?.length
            ? {
                ...item,
                images: [],
                content: [
                  item.content,
                  deps.imageOmittedText?.() || '[Images omitted]',
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              }
            : item
        )
      : history
    const prevMessages = trimChatContext(
      requestHistory,
      Math.max(0, model.budgetCharacters - inputSize)
    )
    if (!model.vision && prevMessages.some((item) => item.images?.length)) {
      deps.notifyError(deps.imageModelError?.() || deps.noModelError())
      return ''
    }
    trimmedTurns.value =
      requestHistory.filter((item) => item.role === 'user').length -
      prevMessages.filter((item) => item.role === 'user').length
    if (retrying) messages.value.pop()
    error.value = ''
    isStopped.value = false
    lastFailedTurn.value = null

    const devInstructions = APP_CONFIG.aiInstructions[AI_TASKS.CHAT]

    const { preparedMessage, userMessage } = prepareChatRequest(
      message,
      attachments
    )

    if (images.length)
      userMessage.images = images.map((image) => ({ ...image }))

    const userMessageIndex = messages.value.length
    messages.value.push(userMessage)

    if (!newChatParams.value.id) {
      newChatParams.value.id = deps.createId()
    }
    if (!newChatParams.value.title) {
      newChatParams.value.title = message.trim()
        ? draftChatTitle(message)
        : attachments[0]?.name || deps.imageTitle?.() || 'Image'
    }
    newChatParams.value.attachments = []
    newChatParams.value.images = []
    dismissedEditorContext.value = null
    acceptedEditorContext.value = null

    const assistantMessage = reactive<ChatMessage>(createAssistantMessage(''))
    messages.value.push(assistantMessage)

    isGenerating.value = true
    abortController = new AbortController()
    const currentGenerationId = ++generationId

    // the question is kept even when no answer comes
    const chatId = newChatParams.value.id
    void persist(messages.value.slice(0, userMessageIndex + 1)).then(
      (saved) => {
        if (saved && chatId && newChatParams.value.id === chatId) {
          void deps.saveLocalState({ lastChatId: chatId })
        }
      }
    )

    let result: string

    try {
      result = await deps.sendChatMessage(
        images.length ? userMessage : preparedMessage,
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

  const reset = (chatParams: ChatParams = {}) => {
    messages.value = []
    newChatParams.value = chatParams
    error.value = ''
    isStopped.value = false
    omitHistoryImages.value = false
    trimmedTurns.value = 0
    dismissedEditorContext.value = null
    acceptedEditorContext.value = null
    lastFailedTurn.value = null
  }

  const clearChat = () => {
    openRequest += 1
    stopGeneration()
    reset()
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

  const branchChat = async (messageIndex: number): Promise<boolean> => {
    // an answer still coming is stopped first: the branch takes it as it was
    // left, or without it when nothing of it came
    if (messageIndex < 0 || messageIndex >= messages.value.length) return false
    openRequest += 1
    stopGeneration()
    const slice = messages.value
      .slice(0, messageIndex + 1)
      .map((m) => ({ ...m }))
    if (!slice.length) return false
    const originalTitle = newChatParams.value.title || ''
    const title = originalTitle ? `${originalTitle} (branch)` : ''
    const id = deps.createId()

    reset({ id, title, attachments: [] })
    messages.value = slice
    await persist(slice)
    await deps.saveLocalState({ lastChatId: id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return true
  }

  const startChat = async (chatParams: ChatParams) => {
    clearChat()
    newChatParams.value = { ...chatParams, id: deps.createId() }
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  const addAttachment = (attachment: ChatAttachment) => {
    const text = attachment.text?.trim()
    if (!text) return
    const current = newChatParams.value.attachments || []
    if (
      !current.some(
        (item) => item.text === text && item.name === attachment.name
      )
    ) {
      newChatParams.value.attachments = [...current, { ...attachment, text }]
    }
  }

  /**
   * Gives the text to the chat: to the current one while it is still empty, to
   * a new one otherwise
   */
  const attachToChat = async (attachment: ChatAttachment) => {
    const text = attachment.text?.trim()
    if (!text) return
    if (messages.value.length > 0 || isGenerating.value) {
      await startChat({ attachments: [{ ...attachment, text }] })
      return
    }
    if (!newChatParams.value.id) newChatParams.value.id = deps.createId()
    addAttachment(attachment)
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  /**
   * Leaves the current chat for a new empty one without writing it again: it is
   * being removed from the history
   */
  const abandonChat = () => {
    openRequest += 1
    halt(false)
    reset({ id: deps.createId() })
  }

  const openChat = async (id: string, options: { silent?: boolean } = {}) => {
    const request = ++openRequest
    let chat: ChatHistoryItem | null
    try {
      chat = await deps.loadChatHistoryItem(id)
    } catch (loadError) {
      if (request === openRequest && !options.silent)
        deps.notifyError(
          deps.chatLoadError?.() ||
            (loadError instanceof Error ? loadError.message : String(loadError))
        )
      return false
    }
    // a chat opened later wins, whichever loads first
    if (request !== openRequest) return false

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
    savingImages,
    newChatParams,
    isGenerating,
    isStopped,
    omitHistoryImages,
    trimmedTurns,
    error,
    dismissedEditorContext,
    acceptedEditorContext,
    lastFailedTurn,
    sendMessage,
    stopGeneration,
    retryLastTurn,
    regenerateMessage,
    branchChat,
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
      if (acceptedEditorContext.value === text) {
        acceptedEditorContext.value = null
      }
    },
    /** Takes the suggested editor text into the next message */
    acceptEditorContext: (text: string) => {
      acceptedEditorContext.value = text
      if (dismissedEditorContext.value === text) {
        dismissedEditorContext.value = null
      }
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
