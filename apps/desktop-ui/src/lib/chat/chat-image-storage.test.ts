import { describe, expect, it, vi } from 'vitest'

import { createChatImageStorage } from './chat-image-storage'
import type { DesktopInvoke } from '@tyco/shared'

function fixture() {
  const invoke = vi.fn()
  let leaseCount = 0
  const storage = createChatImageStorage({
    invoke: invoke as DesktopInvoke,
    createId: () => `lease-${++leaseCount}`,
  })
  return { invoke, ...storage }
}

it('hands completed import leases to ownership synchronization and retries failed syncs', async () => {
  const { invoke, storeChatImage, syncChatImages } = fixture()
  invoke.mockResolvedValueOnce({ id: 'image' })
  const bytes = new Uint8Array([1])
  await storeChatImage(bytes, 'image with spaces.png')
  const [command, body, options] = invoke.mock.calls[0]
  expect(command).toBe('store_chat_image')
  expect(body).toBe(bytes)
  expect(options.headers['x-chat-image-name']).toBe(
    encodeURIComponent('image with spaces.png')
  )
  const lease = options.headers['x-chat-image-lease']
  invoke.mockRejectedValueOnce(new Error('IPC failed'))
  await expect(syncChatImages(['image'])).rejects.toThrow('IPC failed')
  invoke.mockResolvedValueOnce(undefined)
  await syncChatImages(['image'])
  expect(invoke).toHaveBeenLastCalledWith('sync_chat_images', {
    ids: ['image'],
    leases: [lease],
  })
})

describe('history image ownership', () => {
  it('pins loaded images under a lease until the frontend has accepted the chat', async () => {
    const { invoke, loadChatWithImages, syncChatImages } = fixture()
    invoke.mockResolvedValueOnce({ id: 'chat' })
    expect(await loadChatWithImages('chat')).toEqual({ id: 'chat' })
    const lease = invoke.mock.calls.at(-1)![1].lease
    invoke.mockResolvedValueOnce(undefined)
    await syncChatImages(['image'])
    expect(invoke).toHaveBeenLastCalledWith('sync_chat_images', {
      ids: ['image'],
      leases: [lease],
    })
  })
})

it('keeps completed leases isolated between storage instances', async () => {
  const first = fixture()
  const second = fixture()
  first.invoke.mockResolvedValue({ id: 'image' })
  second.invoke.mockResolvedValue(undefined)
  await first.storeChatImage(new Uint8Array([1]), 'image.png')
  await second.syncChatImages([])
  expect(second.invoke).toHaveBeenCalledWith('sync_chat_images', {
    ids: [],
    leases: [],
  })
  await first.syncChatImages(['image'])
  expect(first.invoke).toHaveBeenLastCalledWith('sync_chat_images', {
    ids: ['image'],
    leases: ['lease-1'],
  })
})
