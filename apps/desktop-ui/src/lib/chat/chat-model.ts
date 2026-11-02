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
  let disposed = false
  return {
    ...state,
    savingImages: persistence.savingImages,
    /**
     * Reload only an idle, saved conversation; preserve work started during
     * I/O.
     */
    reloadExternal: async () => {
      const id = currentChatParams.value.id
      if (!id || state.isGenerating.value || persistence.hasPendingWrites())
        return
      const before = JSON.stringify([
        state.messages.value,
        currentChatParams.value,
      ])
      const chat = await deps.loadChat(id)
      if (
        disposed ||
        state.isGenerating.value ||
        persistence.hasPendingWrites() ||
        before !==
          JSON.stringify([state.messages.value, currentChatParams.value])
      )
        return
      if (!chat) {
        session.abandonChat()
        return
      }
      state.messages.value = chat.messages
      currentChatParams.value = {
        ...currentChatParams.value,
        title: chat.title,
      }
    },
    renameChat: (id: string, newTitle: string) => {
      if (disposed) return Promise.resolve()
      if (currentChatParams.value.id === id) title.cancel()
      return persistence.renameChat(id, newTitle)
    },
    sendMessage: (...args: Parameters<typeof generation.sendMessage>) =>
      disposed ? Promise.resolve('') : generation.sendMessage(...args),
    stopGeneration: generation.stopGeneration,
    retryLastTurn: () =>
      disposed ? Promise.resolve('') : generation.retryLastTurn(),
    regenerateMessage: (index: number) =>
      disposed ? Promise.resolve('') : generation.regenerateMessage(index),
    ...session,
    dispose: () => {
      if (disposed) return
      disposed = true
      session.dispose()
    },
    removeAttachment: (index: number) => {
      if (disposed) return
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
