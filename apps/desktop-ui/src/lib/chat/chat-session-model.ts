import type {
  ChatParams,
  ChatAttachment,
  Chat,
  ChatMessage,
} from '@tyco/shared'
import { APP_ROUTES } from '../navigation/routes'
import type { ChatModelDependencies } from './chat-model-contracts'
import type { ChatState } from './chat-state'
export function createChatSessionModel(
  deps: Pick<
    ChatModelDependencies,
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
    currentChatParams,
    isGenerating,
    error,
    isStopped,
    omitHistoryImages,
    trimmedTurnCount,
    lastFailedTurn,
  } = state
  let openRequest = 0
  let disposed = false
  const isCurrent = (request: number) => !disposed && request === openRequest
  const stopGeneration = () => halt(true)
  const reset = (chatParams: ChatParams = {}) => {
    messages.value = []
    currentChatParams.value = chatParams
    error.value = ''
    isStopped.value = false
    omitHistoryImages.value = false
    trimmedTurnCount.value = 0
    lastFailedTurn.value = null
  }

  const clearChat = () => {
    if (disposed) return
    openRequest += 1
    stopGeneration()
    reset()
  }

  const branchChat = async (messageIndex: number): Promise<boolean> => {
    // an answer still coming is stopped first: the branch takes it as it was
    // left, or without it when nothing of it came
    if (disposed) return false
    if (messageIndex < 0 || messageIndex >= messages.value.length) return false
    const request = ++openRequest
    stopGeneration()
    const originalMessages = messages.value
    const originalMessageCount = originalMessages.length
    const slice = originalMessages
      .slice(0, messageIndex + 1)
      .map((m) => ({ ...m }))
    if (!slice.length) return false
    const originalTitle = currentChatParams.value.title || ''
    const title = deps.branchTitle?.(originalTitle) ?? originalTitle
    const id = deps.createId()

    const params = { id, title, attachments: [] }
    if (
      !(await persist(slice, params)) ||
      !isCurrent(request) ||
      messages.value !== originalMessages ||
      messages.value.length !== originalMessageCount ||
      isGenerating.value
    )
      return false
    reset(params)
    messages.value = slice
    await deps.saveSessionState({ lastChatId: id })
    if (!isCurrent(request)) return false
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return isCurrent(request)
  }

  const startChat = async (chatParams: ChatParams) => {
    if (disposed) return
    clearChat()
    currentChatParams.value = { ...chatParams, id: deps.createId() }
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  const addAttachment = (attachment: ChatAttachment) => {
    if (disposed) return
    const text = attachment.text?.trim()
    if (!text) return
    const current = currentChatParams.value.attachments || []
    if (
      !current.some(
        (item) => item.text === text && item.name === attachment.name
      )
    ) {
      currentChatParams.value.attachments = [
        ...current,
        { ...attachment, text },
      ]
    }
  }

  /**
   * Gives the text to the chat: to the current one while it is still empty, to
   * a new one otherwise
   */
  const attachToChat = async (attachment: ChatAttachment) => {
    if (disposed) return
    openRequest += 1
    const text = attachment.text?.trim()
    if (!text) return
    if (messages.value.length > 0 || isGenerating.value) {
      await startChat({ attachments: [{ ...attachment, text }] })
      return
    }
    if (!currentChatParams.value.id)
      currentChatParams.value.id = deps.createId()
    addAttachment(attachment)
    await deps.navigateTo(APP_ROUTES.CHAT.path)
  }

  /**
   * Leaves the current chat for a new empty one without writing it again: it is
   * being removed from the history
   */
  const abandonChat = () => {
    if (disposed) return
    openRequest += 1
    halt(false)
    reset({ id: deps.createId() })
  }

  const openChat = async (id: string, options: { silent?: boolean } = {}) => {
    if (disposed) return false
    const request = ++openRequest
    // The open conversation is authoritative while writes are pending or failed.
    if (currentChatParams.value.id === id) {
      await deps.navigateTo(APP_ROUTES.CHAT.path)
      return isCurrent(request)
    }
    let chat: Chat | null
    try {
      chat = await deps.loadChat(id)
    } catch (loadError) {
      if (isCurrent(request) && !options.silent)
        deps.notifyError(
          deps.chatLoadError?.() ||
            (loadError instanceof Error ? loadError.message : String(loadError))
        )
      return false
    }
    // a chat opened later wins, whichever loads first
    if (!isCurrent(request)) return false

    if (!chat) {
      // a removed chat is not looked for again on the next start
      if (id === deps.getLastChatId())
        await deps.saveSessionState({ lastChatId: null })
      if (!isCurrent(request)) return false
      if (!options.silent) deps.notifyError(deps.chatNotFoundError())
      return false
    }

    stopGeneration()
    reset({ id: chat.id, title: chat.title, attachments: [] })
    messages.value = [...chat.messages]
    await deps.saveSessionState({ lastChatId: chat.id })
    if (!isCurrent(request)) return false
    await deps.navigateTo(APP_ROUTES.CHAT.path)
    return isCurrent(request)
  }

  const openLastOrNewChat = async () => {
    if (disposed) return
    if (currentChatParams.value.id) {
      await deps.navigateTo(APP_ROUTES.CHAT.path)
      return
    }

    const lastId = deps.getLastChatId()
    // the last chat may be gone: removed, or the history is off
    if (lastId) {
      // openChat owns the next request; superseded loads must not create a chat.
      const request = openRequest + 1
      if (await openChat(lastId, { silent: true })) return
      if (!isCurrent(request)) return
    }
    await startChat({})
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    openRequest += 1
    stopGeneration()
  }
  return {
    dispose,
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
