import { createChatState } from './chat-state'
import { createChatPersistenceQueue } from './chat-persistence-queue'
import { createChatTitleController } from './chat-title-controller'
import { createChatGenerationModel } from './chat-generation-model'
import { createChatSessionModel } from './chat-session-model'
import type { ChatStoreDeps } from './chat-store-contracts'
export type { ChatStoreDeps, ChatRequestModel } from './chat-store-contracts'

export function createChatStoreModel(deps: ChatStoreDeps) {
  const state = createChatState()
  const { newChatParams, dismissedEditorContext, acceptedEditorContext } = state
  const persistence = createChatPersistenceQueue(deps, state)
  const title = createChatTitleController(deps, state)
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
    sendMessage: generation.sendMessage,
    stopGeneration: generation.stopGeneration,
    retryLastTurn: generation.retryLastTurn,
    regenerateMessage: generation.regenerateMessage,
    ...session,
    removeAttachment: (index: number) => {
      const current = newChatParams.value.attachments || []
      if (index >= 0 && index < current.length) {
        newChatParams.value.attachments = current.filter((_, i) => i !== index)
      }
    },
    /** Resolves once the writes started so far are done */
    whenSaved: persistence.whenSaved,
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
  }
}
