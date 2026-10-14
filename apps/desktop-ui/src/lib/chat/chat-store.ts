import { createChatState } from './chat-state'
import { createChatPersistenceQueue } from './chat-persistence-queue'
import { createChatTitleController } from './chat-title-controller'
import { createChatGenerationModel } from './chat-generation-model'
import { createChatSessionModel } from './chat-session-model'
import type { ChatStoreDependencies } from './chat-store-contracts'
export type { ChatStoreDependencies } from './chat-store-contracts'

export function createChatModel(deps: ChatStoreDependencies) {
  const state = createChatState()
  const { currentChatState } = state
  const persistence = createChatPersistenceQueue(deps, state)
  const title = createChatTitleController(
    { ...deps, renameChat: persistence.renameChat },
    state
  )
  const generation = createChatGenerationModel(
    deps,
    state,
    persistence.persist,
    title.maybeGenerateTitle,
    title.cancel
  )
  const session = createChatSessionModel(
    deps,
    state,
    generation.halt,
    persistence.persist
  )
  return {
    ...state,
    savingImages: persistence.savingImages,
    renameChat: (id: string, newTitle: string) => {
      if (currentChatState.value.id === id) title.cancel()
      return persistence.renameChat(id, newTitle)
    },
    sendMessage: generation.sendMessage,
    stopGeneration: generation.stopGeneration,
    retryLastTurn: generation.retryLastTurn,
    regenerateMessage: generation.regenerateMessage,
    ...session,
    removeAttachment: (index: number) => {
      const current = currentChatState.value.attachments || []
      if (index >= 0 && index < current.length) {
        currentChatState.value.attachments = current.filter(
          (_, i) => i !== index
        )
      }
    },
    /** Resolves once the writes started so far are done */
    whenSaved: persistence.whenSaved,
    /** Renames the current chat in memory, after it was renamed in storage */
    setTitle: (id: string, title: string) => {
      if (currentChatState.value.id === id) currentChatState.value.title = title
    },
  }
}
