import { ref } from 'vue'
import type { ChatMessage, ChatImage } from '@tyco/shared'
import { createChatHistoryEntry } from './chat-helpers'
import type { ChatStoreDeps } from './chat-store-contracts'
import type { ChatState } from './chat-state'
export function createChatPersistenceQueue(
  deps: Pick<ChatStoreDeps, 'saveChat' | 'nowIso'>,
  state: Pick<ChatState, 'currentChatState'>
) {
  const { currentChatState } = state
  const currentTitle = () => currentChatState.value.title || ''
  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()
  const savingImages = ref<ChatImage[]>([])

  /** Writes the chat as it is; a failure is reported by the dependency */
  const persist = (chatMessages: ChatMessage[]): Promise<boolean> => {
    const id = currentChatState.value.id
    if (!id || chatMessages.length === 0) return Promise.resolve(false)
    const entry = createChatHistoryEntry({
      id,
      title: currentTitle(),
      lastMessageAt: deps.nowIso(),
      messages: [...chatMessages],
    })
    const held = chatMessages.flatMap((message) => message.images || [])
    savingImages.value.push(...held)
    const write = lastWrite.then(async () => {
      try {
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

  return {
    persist,
    savingImages,
    whenSaved: () => lastWrite.then(() => undefined),
  }
}
