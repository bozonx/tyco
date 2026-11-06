import { invokeDesktop as invoke } from '../desktop/invoke'
import {
  type ChatAttachmentFile,
  type ChatImage,
  type Chat,
  type DesktopInvoke,
} from '@tyco/shared'

/**
 * Holds the images and file originals imported into one chat of a window until
 * a sync of the chat takes them over: "Ask AI", or the profile `profileId`. See
 * `src-tauri/src/commands/chat_images.rs` and `dev_docs/chat-files.md`
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

  /** Keeps the original of an attached file, whatever tools the chat has */
  async function storeChatFile(
    bytes: Uint8Array<ArrayBuffer>
  ): Promise<ChatAttachmentFile> {
    const importId = deps.createId()
    const file = await deps.invoke('store_chat_file', {
      bytes,
      meta: { importId },
    })
    completedImportIds.push(importId)
    return file
  }

  /** Holds the images and files the chat shows, by id */
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

  const loadFile = async (id: string) =>
    new Uint8Array(await deps.invoke('read_chat_file', { id, profileId }))

  return {
    storeChatImage,
    storeChatFile,
    syncChatImages,
    loadChatWithImages,
    loadImage,
    loadFile,
  }
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
