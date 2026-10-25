import { describe, expect, it, vi } from 'vitest'
import type { ChatSummary } from '@tyco/shared'

import { createProfileChatsModel } from './profile-chats'

const summaries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `chat-${index}`,
  })) as ChatSummary[]

function setup(chatCounts: Record<string, number>, failingIds: string[] = []) {
  const clearChats = vi.fn(async (id: string) => {
    if (failingIds.includes(id)) throw new Error(`cannot clear ${id}`)
  })
  const model = createProfileChatsModel({
    listProfileIds: () => Object.keys(chatCounts),
    storageFor: (id) => ({
      listChats: async () => summaries(chatCounts[id] ?? 0),
      clearChats: () => clearChats(id),
    }),
  })
  return { model, clearChats }
}

describe('createProfileChatsModel', () => {
  it('counts the chats of all profiles', async () => {
    const { model } = setup({ writer: 2, coder: 3, empty: 0 })
    await expect(model.countAll()).resolves.toBe(5)
  })

  it('counts nothing without profiles', async () => {
    const { model } = setup({})
    await expect(model.countAll()).resolves.toBe(0)
  })

  it('clears the chats of every profile', async () => {
    const { model, clearChats } = setup({ writer: 2, coder: 3 })
    await model.clearAll()
    expect(clearChats.mock.calls.map(([id]) => id)).toEqual(['writer', 'coder'])
  })

  it('tries every profile before reporting a failure', async () => {
    const { model, clearChats } = setup({ writer: 1, coder: 1 }, ['writer'])
    await expect(model.clearAll()).rejects.toThrow('cannot clear writer')
    expect(clearChats).toHaveBeenCalledWith('coder')
  })
})
