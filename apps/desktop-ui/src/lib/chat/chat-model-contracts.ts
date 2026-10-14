import type { Chat, ChatMessage, SessionState } from '@tyco/shared'
import type { AppRoutePath } from '../navigation/routes'

/** The model a chat request runs on */
interface ChatRequestModel {
  id: string
  canUseImages?: boolean
  /** How many characters the request may carry */
  budgetCharacters: number
}

export interface ChatModelDependencies {
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
  saveChat: (item: Chat) => void | Promise<void>
  renameChat: (id: string, title: string) => void | Promise<void>
  loadChat: (id: string) => Promise<Chat | null>
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
  branchTitle?: (title: string) => string
  getChatInstructions?: () => string | undefined
  imageOmittedText?: () => string
  formatError?: (error: unknown) => string
  createId: () => string
  nowIso: () => string
  saveSessionState: (state: Partial<SessionState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
  /** The model picked in the chat; null when none is available */
  getChatModel: () => ChatRequestModel | null
  /** Whether chats are stored; a title is generated only for a stored chat */
  isHistoryEnabled?: () => boolean
}
