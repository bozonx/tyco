import { invoke } from '@tauri-apps/api/core'
import { DESKTOP_COMMANDS, type ChatImage } from '@tyco/shared'

import { bytesToBase64 } from '../net/base64'

export function storeChatImage(
  bytes: Uint8Array<ArrayBuffer>,
  name: string
): Promise<ChatImage> {
  return invoke(DESKTOP_COMMANDS.STORE_CHAT_IMAGE, {
    data: bytesToBase64(bytes),
    name,
  })
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
