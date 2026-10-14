import { createChatState } from './chat-state'
import { createChatPersistenceQueue } from './chat-persistence-queue'
import { createChatTitleController } from './chat-title-controller'
import { createChatGenerationModel } from './chat-generation-model'
import { createChatSessionModel } from './chat-session-model'
import type { ChatModelDependencies } from './chat-model-contracts'
export type { ChatModelDependencies } from './chat-model-contracts'

export function createChatModel(deps: ChatModelDependencies) {
  const state = createChatState()
  const { currentChatParams } = state
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
      if (currentChatParams.value.id === id) title.cancel()
      return persistence.renameChat(id, newTitle)
    },
    sendMessage: generation.sendMessage,
    stopGeneration: generation.stopGeneration,
    retryLastTurn: generation.retryLastTurn,
    regenerateMessage: generation.regenerateMessage,
    ...session,
    removeAttachment: (index: number) => {
      const current = currentChatParams.value.attachments || []
      if (index >= 0 && index < current.length) {
        currentChatParams.value.attachments = current.filter(
          (_, i) => i !== index
        )
      }
    },
    /** Resolves once the writes started so far are done */
    whenSaved: persistence.whenSaved,
  }
}
