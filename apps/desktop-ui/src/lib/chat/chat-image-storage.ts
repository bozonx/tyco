import { invokeDesktop as invoke } from '../desktop/invoke'
import { type ChatImage, type Chat, type DesktopInvoke } from '@tyco/shared'

/**
 * Holds the images imported into one chat of a window until a sync of the chat
 * takes them over: "Ask AI", or the profile `profileId`. See
 * `src-tauri/src/commands/chat_images.rs`
 */
export function createChatImageStorage(deps: {
  invoke: DesktopInvoke
  createId: () => string
  profileId?: string
}) {
  const { profileId } = deps
  const completedImportIds: string[] = []

  /** The PNG goes as the raw IPC body, not as base64 inside JSON */
  async function storeChatImage(
    bytes: Uint8Array<ArrayBuffer>,
    name: string
  ): Promise<ChatImage> {
    const importId = deps.createId()
    const image = await deps.invoke('store_chat_image', {
      bytes,
      meta: { importId, name },
    })
    completedImportIds.push(importId)
    return image
  }

  function syncChatImages(ids: string[]): Promise<void> {
    const importIds = completedImportIds.splice(0)
    return deps
      .invoke('sync_chat_images', { ids, importIds, profileId })
      .catch((error) => {
        completedImportIds.push(...importIds)
        throw error
      })
  }

  async function loadChatWithImages(id: string): Promise<Chat | null> {
    const importId = deps.createId()
    const chat = await deps.invoke('get_chat', { id, importId, profileId })
    completedImportIds.push(importId)
    return chat
  }

  const loadImage = (id: string) => getChatImage(id, profileId, deps.invoke)

  return { storeChatImage, syncChatImages, loadChatWithImages, loadImage }
}

/** The bytes of a chat image; a profile chat keeps its images itself */
export async function getChatImage(
  id: string,
  profileId?: string,
  invokeImage: DesktopInvoke = invoke
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await invokeImage('read_chat_image', { id, profileId })
  return new Uint8Array(response)
}

export async function readDroppedChatFile(
  path: string,
  invokeFile: DesktopInvoke = invoke
): Promise<File> {
  const response = await invokeFile('read_dropped_file', { path })
  return new File(
    [new Uint8Array(response)],
    path.split(/[\\/]/).at(-1) || 'file'
  )
}

/** Ends the undo of a deleted chat, which held its images */
export function releaseDeletedChatImages(id: string): Promise<void> {
  return invoke('release_deleted_chat_images', { id })
}
