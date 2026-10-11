import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
import {
  loadChatWithImages,
  storeChatImage,
  syncChatImages,
} from './chat-image-storage'

it('hands completed import leases to ownership synchronization and retries failed syncs', async () => {
  mocks.invoke.mockResolvedValueOnce({ id: 'image' })
  const bytes = new Uint8Array([1])
  await storeChatImage(bytes, 'фото.png')
  const [command, body, options] = mocks.invoke.mock.calls[0]
  expect(command).toBe('store_chat_image')
  expect(body).toBe(bytes)
  expect(options.headers['x-chat-image-name']).toBe(
    encodeURIComponent('фото.png')
  )
  const lease = options.headers['x-chat-image-lease']
  mocks.invoke.mockRejectedValueOnce(new Error('IPC failed'))
  await expect(syncChatImages(['image'])).rejects.toThrow('IPC failed')
  mocks.invoke.mockResolvedValueOnce(undefined)
  await syncChatImages(['image'])
  expect(mocks.invoke).toHaveBeenLastCalledWith('sync_chat_images', {
    ids: ['image'],
    leases: [lease],
  })
})

describe('history image ownership', () => {
  it('pins loaded images under a lease until the frontend has accepted the chat', async () => {
    mocks.invoke.mockResolvedValueOnce({ id: 'chat' })
    expect(await loadChatWithImages('chat')).toEqual({ id: 'chat' })
    const lease = mocks.invoke.mock.calls.at(-1)![1].lease
    mocks.invoke.mockResolvedValueOnce(undefined)
    await syncChatImages(['image'])
    expect(mocks.invoke).toHaveBeenLastCalledWith('sync_chat_images', {
      ids: ['image'],
      leases: [lease],
    })
  })
})
