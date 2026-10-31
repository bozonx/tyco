import type { Chat, ChatMessage, SessionState } from '@tyco/shared'
import type { ChatToolLoopState } from '../chat-tools/chat-tool-loop'
import type { AppRoutePath } from '../navigation/routes'

/** The model a chat request runs on */
interface ChatRequestModel {
  id: string
  canUseImages?: boolean
  /** How many characters the request may carry */
  budgetCharacters: number
  /**
   * Whether the turn may call tools: part of the budget is then kept for the
   * results its steps bring
   */
  reservesToolSteps?: boolean
}

export interface ChatModelDependencies {
  sendChatMessage: (
    message: string | ChatMessage,
    prevMessages: ChatMessage[],
    devInstructions: string | undefined,
    options: {
      modelId: string
      /** The answer so far: its text and, with tools, its steps */
      onUpdate: (state: ChatToolLoopState) => void
      signal?: AbortSignal
      /**
       * What the outputs of the turn's tools may add to the request: the part
       * of the context the history left; absent for a turn without tools
       */
      toolOutputBudgetCharacters?: number
    }
  ) => Promise<ChatToolLoopState>
  /** A short title for the conversation; empty when none came out */
  generateChatTitle: (
    question: string,
    answer: string,
    modelId: string,
    signal?: AbortSignal
  ) => Promise<string>
  saveChat: (item: Chat) => void | Promise<void>
  /** `silent`: a background rename, whose failure is not told to the user */
  renameChat: (
    id: string,
    title: string,
    options?: { silent?: boolean }
  ) => void | Promise<void>
  loadChat: (id: string) => Promise<Chat | null>
  navigateTo: (path: AppRoutePath) => void | Promise<void>
  notifyError: (message: string) => void
  emptyMessageError: () => string
  emptyResponseError?: () => string
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
  nowMs: () => number
  saveSessionState: (state: Partial<SessionState>) => void | Promise<void>
  getLastChatId: () => string | null | undefined
  /** The model picked in the chat; null when none is available */
  getChatModel: () => ChatRequestModel | null
  /**
   * Reads anew what sizes a turn, such as a profile's instructions; runs before
   * the request is measured
   */
  prepareTurn?: () => Promise<void>
  /** Whether chats are stored; a title is generated only for a stored chat */
  isHistoryEnabled?: () => boolean
}
