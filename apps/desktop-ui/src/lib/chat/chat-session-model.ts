import type {
  ChatParams,
  ChatAttachment,
  Chat,
  ChatMessage,
} from '@tyco/shared'
import { APP_ROUTES } from '../navigation/routes'
import type { ChatStoreDependencies } from './chat-store-contracts'
import type { ChatState } from './chat-state'
export function createChatSessionModel(
  deps: Pick<
    ChatStoreDependencies,
    | 'createId'
    | 'saveSessionState'
    | 'navigateTo'
    | 'loadChat'
    | 'notifyError'
    | 'chatLoadError'
    | 'chatNotFoundError'
    | 'getLastChatId'
    | 'branchTitle'
  >,
  state: ChatState,
  halt: (save: boolean) => void,
  persist: (messages: ChatMessage[], params?: ChatParams) => Promise<boolean>
) {
  const {
    messages,
    currentChatState,
    isGenerating,
    error,
    isStopped,
    omitHistoryImages,
    trimmedTurns,
    lastFailedTurn,
  } = state
  let openRequest = 0
  const stopGeneration = () => halt(true)
  const reset = (chatParams: ChatParams = {}) => {
    messages.value = []
    currentChatState.value = chatParams
    error.value = ''
    isStopped.value = false
    omitHistoryImages.value = false
    trimmedTurns.value = 0
    lastFailedTurn.value = null
  }

  const clearChat = () => {
    openRequest += 1
    stopGeneration()
    reset()
  }

  const branchChat = async (messageIndex: number): Promise<boolean> => {
    // an answer still coming is stopped first: the branch takes it as it was
    // left, or without it when nothing of it came
    if (messageIndex < 0 || messageIndex >= messages.value.length) return false
    const request = ++openRequest
    stopGeneration()
    const originalMessages = messages.value
    const originalMessageCount = originalMessages.length
    const slice = originalMessages
      .slice(0, messageIndex + 1)
      .map((m) => ({ ...m }))
    if (!slice.length) return false
    const originalTitle = currentChatState.value.title || ''
    const title = deps.branchTitle?.(originalTitle) ?? originalTitle
    const id = deps.createId()

    const params = { id, title, attachments: [] }
    if (
      !(await persist(slice, params)) ||
      request !== openRequest ||
      messages.value !== originalMessages ||
      messages.value.length !== originalMessageCount ||
      isGenerating.value
    )
      return false
    reset(params)
    messages.value = slice
    await deps.saveSessionState({ lastChatId: id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return true
  }

  const startChat = async (chatParams: ChatParams) => {
    clearChat()
    currentChatState.value = { ...chatParams, id: deps.createId() }
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  const addAttachment = (attachment: ChatAttachment) => {
    const text = attachment.text?.trim()
    if (!text) return
    const current = currentChatState.value.attachments || []
    if (
      !current.some(
        (item) => item.text === text && item.name === attachment.name
      )
    ) {
      currentChatState.value.attachments = [...current, { ...attachment, text }]
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
    if (!currentChatState.value.id) currentChatState.value.id = deps.createId()
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
    let chat: Chat | null
    try {
      chat = await deps.loadChat(id)
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
    reset({ id: chat.id, title: chat.title, attachments: [] })
    messages.value = [...chat.messages]
    await deps.saveSessionState({ lastChatId: chat.id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return true
  }

  const openLastOrNewChat = async () => {
    if (currentChatState.value.id) {
      await deps.navigateTo(APP_ROUTES.CHAT.path)
      return
    }

    const lastId = deps.getLastChatId()
    // the last chat may be gone: removed, or the history is off
    if (lastId && (await openChat(lastId, { silent: true }))) return
    await startChat({})
  }
  return {
    branchChat,
    startChat,
    openChat,
    clearChat,
    abandonChat,
    attachToChat,
    addAttachment,
    openLastOrNewChat,
  }
}
