import type {
  ChatParams,
  ChatAttachment,
  Chat,
  ChatMessage,
} from '@tyco/shared'
import { APP_ROUTES } from '../navigation/routes'
import type { ChatStoreDeps } from './chat-store-contracts'
import type { ChatState } from './chat-state'
export function createChatSessionModel(
  deps: Pick<
    ChatStoreDeps,
    | 'createId'
    | 'saveLocalState'
    | 'navigateTo'
    | 'loadChat'
    | 'notifyError'
    | 'chatLoadError'
    | 'chatNotFoundError'
    | 'getLastChatId'
  >,
  state: ChatState,
  halt: (save: boolean) => void,
  persist: (messages: ChatMessage[]) => Promise<boolean>
) {
  const {
    messages,
    newChatParams,
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
    newChatParams.value = chatParams
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
    await deps.saveLocalState({ lastChatId: chat.id })
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return true
  }

  const openLastOrNewChat = async () => {
    if (newChatParams.value.id) {
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
