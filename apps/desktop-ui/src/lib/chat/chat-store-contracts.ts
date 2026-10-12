import type { ChatHistoryItem, ChatMessage, LocalState } from '@tyco/shared'
import type { AppRoutePath } from '../navigation/routes'

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
