import { ref } from 'vue'
import type { ChatMessage, ChatImage, ChatParams } from '@tyco/shared'
import { createChatHistoryEntry } from './chat-history-entry'
import type { ChatStoreDependencies } from './chat-store-contracts'
import type { ChatState } from './chat-state'
export function createChatPersistenceQueue(
  deps: Pick<ChatStoreDependencies, 'saveChat' | 'renameChat' | 'nowIso'>,
  state: Pick<ChatState, 'currentChatState'>
) {
  const { currentChatState } = state
  const renamedTitles = new Map<string, string>()
  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()
  const savingImages = ref<ChatImage[]>([])

  /** Writes the chat as it is; a failure is reported by the dependency */
  const persist = (
    chatMessages: ChatMessage[],
    chatParams: ChatParams = currentChatState.value
  ): Promise<boolean> => {
    const id = chatParams.id
    if (!id || chatMessages.length === 0) return Promise.resolve(false)
    const entry = createChatHistoryEntry({
      id,
      title: chatParams.title || '',
      lastMessageAt: deps.nowIso(),
      messages: [...chatMessages],
    })
    const held = chatMessages.flatMap((message) => message.images || [])
    savingImages.value.push(...held)
    const write = lastWrite.then(async () => {
      try {
        entry.title = renamedTitles.get(id) ?? entry.title
        await deps.saveChat(entry)
        return true
      } catch {
        return false
      } finally {
        for (const image of held) {
          const index = savingImages.value.indexOf(image)
          if (index >= 0) savingImages.value.splice(index, 1)
        }
      }
    })
    lastWrite = write
    return write
  }

  const renameChat = (id: string, title: string): Promise<void> => {
    const write = lastWrite.then(async () => {
      await deps.renameChat(id, title)
      renamedTitles.set(id, title)
      if (currentChatState.value.id === id) currentChatState.value.title = title
    })
    // A failed rename must not block subsequent saves.
    lastWrite = write.catch(() => undefined)
    return write
  }

  return {
    persist,
    renameChat,
    savingImages,
    whenSaved: () => lastWrite.then(() => undefined),
  }
}
