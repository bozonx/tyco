import type { Chat, ChatParams } from '@tyco/shared'
import type { Ref } from 'vue'

import { createRemovalUndo } from '../history/removal-undo'

export interface ChatRemovalDependencies {
  history: {
    deleteChat: (id: string) => Promise<Chat | null>
    restoreChatItem: (chat: Chat) => Promise<void>
  }
  chat: {
    currentChatParams: Ref<ChatParams>
    stopGeneration: () => void
    abandonChat: () => void
    whenSaved: () => Promise<void>
    openChat: (id: string, options?: { silent?: boolean }) => Promise<boolean>
  }
  isHistoryEnabled: () => boolean
  /** Lets go of the images an undo kept for the removed chat */
  releaseImages: (chatId: string) => Promise<void>
  reportError: (error: unknown) => void
  timeoutMs?: number
}

/**
 * Removes chats with an undo. It lives as long as the chat, not the sidebar, so
 * that closing the sidebar neither loses the undo nor lets the images of the
 * removed chat go early
 */
export function createChatRemoval(deps: ChatRemovalDependencies) {
  const { history, chat } = deps
  return createRemovalUndo<Chat>({
    remove: async (id) => {
      const wasOpen = chat.currentChatParams.value.id === id
      if (wasOpen) {
        // what came of an answer still coming is stored first, so that a
        // removal that fails takes nothing away from the chat it reopens
        chat.stopGeneration()
        await chat.whenSaved()
        chat.abandonChat()
      }
      try {
        return await history.deleteChat(id)
      } catch (error) {
        if (wasOpen) await chat.openChat(id, { silent: true })
        throw error
      }
    },
    restore: async (item) => {
      // a chat is not stored while the history is off: the undo keeps it
      if (!deps.isHistoryEnabled())
        throw new Error('Chat history is off; the chat was not restored')
      await history.restoreChatItem(item)
    },
    release: (item) => deps.releaseImages(item.id),
    reportError: deps.reportError,
    timeoutMs: deps.timeoutMs,
  })
}
