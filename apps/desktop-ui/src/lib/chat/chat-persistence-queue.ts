import { ref } from 'vue'
import type { Chat, ChatMessage, ChatImage, ChatParams } from '@tyco/shared'
import type { ChatModelDependencies } from './chat-model-contracts'
import type { ChatState } from './chat-state'
import { attachmentFileIds } from './chat-attached-files'
export function createChatPersistenceQueue(
  deps: Pick<
    ChatModelDependencies,
    'saveChat' | 'renameChat' | 'nowMs' | 'saveRetryDelaysMs'
  >,
  state: Pick<ChatState, 'currentChatParams'>
) {
  const { currentChatParams } = state
  // a rename reaches the writes queued before it; once the queue is empty the
  // chat params carry the new title, so the map is dropped
  const renamedTitles = new Map<string, string>()
  let pendingWriteCount = 0
  let failedChatId: string | undefined
  const settle = () => {
    pendingWriteCount -= 1
    if (pendingWriteCount === 0) renamedTitles.clear()
  }
  // writes go one after another, so that an older state never lands last
  let lastWrite: Promise<unknown> = Promise.resolve()
  /** Counts the chat writes, so that a retry sees a newer one queued */
  let writeCount = 0
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms))
  /** Writes `entry`, retrying while no newer write is queued */
  const saveWithRetry = async (entry: Chat, writeNumber: number) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await deps.saveChat(entry)
        return true
      } catch {
        const delay = deps.saveRetryDelaysMs?.[attempt]
        if (delay === undefined || writeNumber !== writeCount) return false
        await wait(delay)
        if (writeNumber !== writeCount) return false
      }
    }
  }
  const savingImages = ref<ChatImage[]>([])
  /** The originals of attached files a write in progress refers to */
  const savingFileIds = ref<string[]>([])

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
    const heldFileIds = attachmentFileIds(
      chatMessages.flatMap((message) => message.attachments || [])
    )
    savingFileIds.value.push(...heldFileIds)
    pendingWriteCount += 1
    const writeNumber = ++writeCount
    const write = lastWrite.then(async () => {
      try {
        entry.title = renamedTitles.get(id) ?? entry.title
        const saved = await saveWithRetry(entry, writeNumber)
        if (writeNumber === writeCount)
          failedChatId = saved ? undefined : entry.id
        return saved
      } finally {
        for (const image of held) {
          const index = savingImages.value.indexOf(image)
          if (index >= 0) savingImages.value.splice(index, 1)
        }
        for (const id of heldFileIds) {
          const index = savingFileIds.value.indexOf(id)
          if (index >= 0) savingFileIds.value.splice(index, 1)
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
    savingFileIds,
    hasPendingWrites: () =>
      pendingWriteCount > 0 ||
      (failedChatId !== undefined &&
        failedChatId === currentChatParams.value.id),
    whenSaved: () => lastWrite.then(() => undefined),
  }
}
