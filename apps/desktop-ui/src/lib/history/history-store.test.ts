import { describe, expect, it, vi } from 'vitest'

import { createHistoryStoreModel } from './history-store'

function createApi() {
  return {
    callFunction: vi.fn(async (functionName: string) => {
      if (functionName === 'getEditorHistory') {
        return { result: ['one', 'two'] }
      }
      if (functionName === 'getTransformHistory') {
        return { result: ['alpha'] }
      }
      if (functionName === 'getChatHistory') {
        return {
          result: [
            {
              id: 'chat-1',
              description: 'Hello',
              lastMsgDate: '2026-04-22T00:00:00.000Z',
              messages: [],
            },
          ],
        }
      }

      return {}
    }),
  }
}

describe('history-store', () => {
  it('loads editor and transform history into state', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.loadEditorHistory()
    await store.loadTransformHistory()

    expect(store.editorHistory.value).toEqual(['one', 'two'])
    expect(store.transformHistory.value).toEqual(['alpha'])
  })

  it('loads chat history into state', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.loadChatHistory()

    expect(store.chatHistory.value).toHaveLength(1)
    expect(store.chatHistory.value[0]?.id).toBe('chat-1')
  })

  it('removes items from local state after delete commands', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)
    store.editorHistory.value = ['one', 'two']
    store.transformHistory.value = ['alpha', 'beta']
    store.chatHistory.value = [
      { id: 'chat-1', description: 'A', lastMsgDate: 'x', messages: [] },
      { id: 'chat-2', description: 'B', lastMsgDate: 'y', messages: [] },
    ]

    await store.removeFromEditorHistory('one')
    await store.removeFromTransformHistory('beta')
    await store.removeFromChatHistory('chat-1')

    expect(store.editorHistory.value).toEqual(['two'])
    expect(store.transformHistory.value).toEqual(['alpha'])
    expect(store.chatHistory.value.map((item) => item.id)).toEqual(['chat-2'])
  })

  it('clears in-memory state after clear commands', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)
    store.editorHistory.value = ['one']
    store.transformHistory.value = ['alpha']
    store.chatHistory.value = [
      { id: 'chat-1', description: 'A', lastMsgDate: 'x', messages: [] },
    ]

    await store.clearEditorHistory()
    await store.clearTransformHistory()
    await store.clearChatHistory()

    expect(store.editorHistory.value).toEqual([])
    expect(store.transformHistory.value).toEqual([])
    expect(store.chatHistory.value).toEqual([])
  })
})
