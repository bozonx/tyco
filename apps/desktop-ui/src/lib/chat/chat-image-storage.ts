import { invoke } from '@tauri-apps/api/core'
import {
  DESKTOP_COMMANDS,
  type ChatImage,
  type ChatHistoryItem,
} from '@tyco/shared'

import { bytesToBase64 } from '../net/base64'

const completedImports: string[] = []

export async function storeChatImage(
  bytes: Uint8Array<ArrayBuffer>,
  name: string
): Promise<ChatImage> {
  const lease = crypto.randomUUID()
  const image = await invoke<ChatImage>(DESKTOP_COMMANDS.STORE_CHAT_IMAGE, {
    lease,
    data: bytesToBase64(bytes),
    name,
  })
  completedImports.push(lease)
  return image
}

export async function getChatImage(
  id: string
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await invoke<ArrayBuffer | number[]>(
    DESKTOP_COMMANDS.GET_CHAT_IMAGE,
    { id }
  )
  return new Uint8Array(response)
}

export function syncChatImages(ids: string[]): Promise<void> {
  const leases = completedImports.splice(0)
  return invoke<void>(DESKTOP_COMMANDS.SYNC_CHAT_IMAGES, { ids, leases }).catch(
    (error) => {
      completedImports.push(...leases)
      throw error
    }
  )
}

export async function readDroppedChatFile(path: string): Promise<File> {
  const response = await invoke<ArrayBuffer | number[]>(
    DESKTOP_COMMANDS.READ_CHAT_FILE,
    { path }
  )
  return new File(
    [new Uint8Array(response)],
    path.split(/[\\/]/).at(-1) || 'file'
  )
}

export async function loadChatWithImages(
  id: string
): Promise<ChatHistoryItem | null> {
  const lease = crypto.randomUUID()
  const chat = await invoke<ChatHistoryItem | null>(DESKTOP_COMMANDS.GET_CHAT, {
    id,
    lease,
  })
  completedImports.push(lease)
  return chat
}

export function releaseChatImageUndo(id: string): Promise<void> {
  return invoke(DESKTOP_COMMANDS.RELEASE_CHAT_IMAGE_UNDO, { id })
}
