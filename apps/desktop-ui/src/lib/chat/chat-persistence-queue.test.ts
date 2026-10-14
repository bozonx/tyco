import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatImage, ChatParams } from '@tyco/shared'
import { createChatPersistenceQueue } from './chat-persistence-queue'

describe('createChatPersistenceQueue', () => {
  const image: ChatImage = {
    id: 'img-1',
    name: 'test.webp',
    mediaType: 'image/webp',
    size: 100,
    width: 10,
    height: 10,
  }

  const message: ChatMessage = {
    role: 'user',
    content: 'hello',
    images: [image],
  }

  it('skips saving when id is missing or messages are empty', async () => {
    const saveChat = vi.fn(async () => {})
    const renameChat = vi.fn(async () => {})
    const currentChatParams = ref<ChatParams>({ id: '' })
    const queue = createChatPersistenceQueue(
      { saveChat, renameChat, nowIso: () => '2026-01-01T00:00:00.000Z' },
      { currentChatParams }
    )

    expect(await queue.persist([message])).toBe(false)
    currentChatParams.value = { id: 'chat-1' }
    expect(await queue.persist([])).toBe(false)
    expect(saveChat).not.toHaveBeenCalled()
  })

  it('serializes writes in order and tracks saving images', async () => {
    const calls: string[] = []
    let resolveFirst: () => void = () => {}
    const saveChat = vi.fn((entry) => {
      calls.push(entry.id)
      if (entry.id === 'chat-1') {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve()
    })
    const renameChat = vi.fn(async () => {})
    const currentChatParams = ref<ChatParams>({
      id: 'chat-1',
      title: 'Original',
    })
    const queue = createChatPersistenceQueue(
      { saveChat, renameChat, nowIso: () => '2026-01-01T00:00:00.000Z' },
      { currentChatParams }
    )

    const firstPromise = queue.persist([message])
    expect(queue.savingImages.value).toContainEqual(image)

    const secondPromise = queue.persist(
      [{ role: 'assistant', content: 'world' }],
      { id: 'chat-2', title: 'Second' }
    )

    await Promise.resolve()
    expect(calls).toEqual(['chat-1'])
    resolveFirst()

    const [firstResult, secondResult] = await Promise.all([
      firstPromise,
      secondPromise,
    ])
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(calls).toEqual(['chat-1', 'chat-2'])
    expect(queue.savingImages.value).not.toContainEqual(image)
  })

  it('applies renamed title and updates currentChatParams if matching id', async () => {
    let savedTitle = ''
    const saveChat = vi.fn(async (entry) => {
      savedTitle = entry.title
    })
    const renameChat = vi.fn(async () => {})
    const currentChatParams = ref<ChatParams>({ id: 'chat-1', title: 'Old' })
    const queue = createChatPersistenceQueue(
      { saveChat, renameChat, nowIso: () => '2026-01-01T00:00:00.000Z' },
      { currentChatParams }
    )

    await queue.renameChat('chat-1', 'New Title')
    expect(currentChatParams.value.title).toBe('New Title')

    await queue.persist([message])
    expect(savedTitle).toBe('New Title')
  })

  it('returns false and cleans up images when saveChat rejects', async () => {
    const saveChat = vi.fn(async () => {
      throw new Error('Disk full')
    })
    const renameChat = vi.fn(async () => {})
    const currentChatParams = ref<ChatParams>({ id: 'chat-1' })
    const queue = createChatPersistenceQueue(
      { saveChat, renameChat, nowIso: () => '2026-01-01T00:00:00.000Z' },
      { currentChatParams }
    )

    const result = await queue.persist([message])
    expect(result).toBe(false)
    expect(queue.savingImages.value).toHaveLength(0)
  })

  it('allows subsequent writes even when renameChat fails', async () => {
    const saveChat = vi.fn(async () => {})
    const renameChat = vi.fn(async () => {
      throw new Error('Rename failed')
    })
    const currentChatParams = ref<ChatParams>({ id: 'chat-1' })
    const queue = createChatPersistenceQueue(
      { saveChat, renameChat, nowIso: () => '2026-01-01T00:00:00.000Z' },
      { currentChatParams }
    )

    await expect(queue.renameChat('chat-1', 'New')).rejects.toThrow(
      'Rename failed'
    )
    await queue.whenSaved()

    const result = await queue.persist([message])
    expect(result).toBe(true)
    expect(saveChat).toHaveBeenCalled()
  })
})
