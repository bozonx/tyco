import { describe, expect, it, vi } from 'vitest'

import { createChatImageStorage } from './chat-image-storage'
import type { DesktopInvoke } from '@tyco/shared'

function fixture() {
  const invoke = vi.fn()
  let importCount = 0
  const storage = createChatImageStorage({
    invoke: invoke as DesktopInvoke,
    createId: () => `import-${++importCount}`,
  })
  return { invoke, ...storage }
}

it('hands completed imports to the sync of the chat and retries failed syncs', async () => {
  const { invoke, storeChatImage, syncChatImages } = fixture()
  invoke.mockResolvedValueOnce({ id: 'image' })
  const bytes = new Uint8Array([1])
  await storeChatImage(bytes, 'image with spaces.png')
  expect(invoke).toHaveBeenCalledWith('store_chat_image', {
    bytes,
    meta: { importId: 'import-1', name: 'image with spaces.png' },
  })
  invoke.mockRejectedValueOnce(new Error('IPC failed'))
  await expect(syncChatImages(['image'])).rejects.toThrow('IPC failed')
  invoke.mockResolvedValueOnce(undefined)
  await syncChatImages(['image'])
  expect(invoke).toHaveBeenLastCalledWith('sync_chat_images', {
    ids: ['image'],
    importIds: ['import-1'],
  })
})

describe('history image ownership', () => {
  it('holds loaded images under an import id until the chat is synced', async () => {
    const { invoke, loadChatWithImages, syncChatImages } = fixture()
    invoke.mockResolvedValueOnce({ id: 'chat' })
    expect(await loadChatWithImages('chat')).toEqual({ id: 'chat' })
    expect(invoke).toHaveBeenLastCalledWith('get_chat', {
      id: 'chat',
      importId: 'import-1',
    })
    invoke.mockResolvedValueOnce(undefined)
    await syncChatImages(['image'])
    expect(invoke).toHaveBeenLastCalledWith('sync_chat_images', {
      ids: ['image'],
      importIds: ['import-1'],
    })
  })
})

it('keeps completed imports isolated between storage instances', async () => {
  const first = fixture()
  const second = fixture()
  first.invoke.mockResolvedValue({ id: 'image' })
  second.invoke.mockResolvedValue(undefined)
  await first.storeChatImage(new Uint8Array([1]), 'image.png')
  await second.syncChatImages([])
  expect(second.invoke).toHaveBeenCalledWith('sync_chat_images', {
    ids: [],
    importIds: [],
  })
  await first.syncChatImages(['image'])
  expect(first.invoke).toHaveBeenLastCalledWith('sync_chat_images', {
    ids: ['image'],
    importIds: ['import-1'],
  })
})
