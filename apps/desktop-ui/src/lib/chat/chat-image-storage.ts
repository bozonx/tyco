import { invokeDesktop as invoke } from '../desktop/invoke'
import {
  DESKTOP_COMMANDS,
  type ChatImage,
  type Chat,
  type DesktopInvoke,
} from '@tyco/shared'

/**
 * Owns pending image leases for one chat of a window: "Ask AI", or the profile
 * `profileId`
 */
export function createChatImageStorage(deps: {
  invoke: DesktopInvoke
  createId: () => string
  profileId?: string
}) {
  const { profileId } = deps
  const completedImports: string[] = []

  /** The PNG goes as the raw IPC body, not as base64 inside JSON */
  async function storeChatImage(
    bytes: Uint8Array<ArrayBuffer>,
    name: string
  ): Promise<ChatImage> {
    const lease = deps.createId()
    const image = await deps.invoke(DESKTOP_COMMANDS.STORE_CHAT_IMAGE, bytes, {
      headers: {
        'x-chat-image-lease': lease,
        // headers are ASCII; names are not
        'x-chat-image-name': encodeURIComponent(name),
      },
    })
    completedImports.push(lease)
    return image
  }

  function syncChatImages(ids: string[]): Promise<void> {
    const leases = completedImports.splice(0)
    return deps
      .invoke(DESKTOP_COMMANDS.SYNC_CHAT_IMAGES, { ids, leases, profileId })
      .catch((error) => {
        completedImports.push(...leases)
        throw error
      })
  }

  async function loadChatWithImages(id: string): Promise<Chat | null> {
    const lease = deps.createId()
    const chat = await deps.invoke(DESKTOP_COMMANDS.GET_CHAT, {
      id,
      lease,
      profileId,
    })
    completedImports.push(lease)
    return chat
  }

  return { storeChatImage, syncChatImages, loadChatWithImages }
}

/** The bytes of a chat image; a profile chat keeps its images itself */
export async function getChatImage(
  id: string,
  profileId?: string
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await invoke(DESKTOP_COMMANDS.GET_CHAT_IMAGE, {
    id,
    profileId,
  })
  return new Uint8Array(response)
}

export async function readDroppedChatFile(path: string): Promise<File> {
  const response = await invoke(DESKTOP_COMMANDS.READ_CHAT_FILE, { path })
  return new File(
    [new Uint8Array(response)],
    path.split(/[\\/]/).at(-1) || 'file'
  )
}

export function releaseChatImageUndo(id: string): Promise<void> {
  return invoke(DESKTOP_COMMANDS.RELEASE_CHAT_IMAGE_UNDO, { id })
}
