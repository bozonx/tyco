import { ref } from 'vue'
import type { Chat, ChatMessage, ChatImage, ChatParams } from '@tyco/shared'
import type { ChatModelDependencies } from './chat-model-contracts'
import type { ChatState } from './chat-state'
export function createChatPersistenceQueue(
  deps: Pick<ChatModelDependencies, 'saveChat' | 'renameChat' | 'nowMs'>,
  state: Pick<ChatState, 'currentChatParams'>
) {
  const { currentChatParams } = state
  // a rename reaches the writes queued before it; once the queue is empty the
  // chat params carry the new title, so the map is dropped
  const renamedTitles = new Map<string, string>()
  let pendingWriteCount = 0
  const settle = () => {
    pendingWriteCount -= 1
    if (pendingWriteCount === 0) renamedTitles.clear()
  }
  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()
  const savingImages = ref<ChatImage[]>([])

  /** Writes the chat as it is; a failure is reported by the dependency */
  const persist = (
    chatMessages: ChatMessage[],
    chatParams: ChatParams = currentChatParams.value
  ): Promise<boolean> => {
    const id = chatParams.id
    if (!id || chatMessages.length === 0) return Promise.resolve(false)
    const entry: Chat = {
      id,
      title: chatParams.title || '',
      lastMessageAt: deps.nowMs(),
      messages: [...chatMessages],
    }
    const held = chatMessages.flatMap((message) => message.images || [])
    savingImages.value.push(...held)
    pendingWriteCount += 1
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
        settle()
      }
    })
    lastWrite = write
    return write
  }

  const renameChat = (
    id: string,
    title: string,
    options?: { silent?: boolean }
  ): Promise<void> => {
    pendingWriteCount += 1
    const write = lastWrite.then(async () => {
      try {
        await deps.renameChat(id, title, options)
        if (currentChatParams.value.id === id)
          currentChatParams.value.title = title
        // a write queued meanwhile still carries the old title
        if (pendingWriteCount > 1) renamedTitles.set(id, title)
      } finally {
        settle()
      }
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
