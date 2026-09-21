import type { EditorHistoryItem } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createHistoryStoreModel } from './history-store'

function editorItem(id: string, text: string): EditorHistoryItem {
  return { id, text, kind: 'draft', createdAt: 1 }
}

function createApi() {
  return {
    callFunction: vi.fn(async (functionName: string) => {
      if (functionName === 'getEditorHistory') {
        return { result: [editorItem('1', 'one'), editorItem('2', 'two')] }
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
  it('loads editor history into state', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.loadEditorHistory()

    expect(store.editorHistory.value.map((item) => item.text)).toEqual([
      'one',
      'two',
    ])
  })

  it('loads chat history into state', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.loadChatHistory()

    expect(store.chatHistory.value).toHaveLength(1)
    expect(store.chatHistory.value[0]?.id).toBe('chat-1')
  })

  it('saves texts with their kind and operation', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.saveOutput('sent')
    await store.saveDraft('left')
    await store.saveSource('before', 'translate')

    expect(api.callFunction.mock.calls).toEqual([
      ['saveEditorHistory', [{ text: 'sent', kind: 'output' }]],
      ['saveEditorHistory', [{ text: 'left', kind: 'draft' }]],
      [
        'saveEditorHistory',
        [{ text: 'before', kind: 'source', operation: 'translate' }],
      ],
    ])
  })

  it('does not save blank texts', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)

    await store.saveOutput('')
    await store.saveDraft('  \n')

    expect(api.callFunction).not.toHaveBeenCalled()
  })

  it('removes items from local state after delete commands', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)
    store.editorHistory.value = [editorItem('1', 'one'), editorItem('2', 'two')]
    store.chatHistory.value = [
      { id: 'chat-1', description: 'A', lastMsgDate: 'x', messages: [] },
      { id: 'chat-2', description: 'B', lastMsgDate: 'y', messages: [] },
    ]

    await store.removeFromEditorHistory('1')
    await store.removeFromChatHistory('chat-1')

    expect(api.callFunction).toHaveBeenCalledWith('removeFromEditorHistory', [
      '1',
    ])
    expect(store.editorHistory.value.map((item) => item.id)).toEqual(['2'])
    expect(store.chatHistory.value.map((item) => item.id)).toEqual(['chat-2'])
  })

  it('clears in-memory state after clear commands', async () => {
    const api = createApi()
    const store = createHistoryStoreModel(api)
    store.editorHistory.value = [editorItem('1', 'one')]
    store.chatHistory.value = [
      { id: 'chat-1', description: 'A', lastMsgDate: 'x', messages: [] },
    ]

    await store.clearEditorHistory()
    await store.clearChatHistory()

    expect(store.editorHistory.value).toEqual([])
    expect(store.chatHistory.value).toEqual([])
  })
})
