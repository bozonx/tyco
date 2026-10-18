import type { EditorHistoryItem } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createHistoryModel, type HistoryApi } from './history-model'

function editorItem(id: string, text: string): EditorHistoryItem {
  return { id, text, kind: 'draft', createdAt: 1 }
}

function createApi() {
  return {
    callFunction: vi.fn(
      async (functionName: string): Promise<{ result?: unknown }> => {
        if (functionName === 'saveEditorHistory') {
          return { result: 'new-id' }
        }
        if (functionName === 'getEditorHistory') {
          return { result: [editorItem('1', 'one'), editorItem('2', 'two')] }
        }
        if (functionName === 'listChats') {
          return {
            result: [
              {
                id: 'chat-1',
                title: 'Hello',
                lastMessageAt: 1_776_816_000_000,
                messages: [],
              },
            ],
          }
        }
        if (functionName === 'getChat') {
          return {
            result: {
              id: 'chat-1',
              title: 'Hello',
              lastMessageAt: 1_776_816_000_000,
              messages: [{ role: 'user', content: 'Hello' }],
            },
          }
        }

        return {}
      }
    ),
  }
}

describe('history-model', () => {
  it('loads editor history into state', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await store.loadEditorHistory()

    expect(store.editorHistory.value.map((item) => item.text)).toEqual([
      'one',
      'two',
    ])
  })

  it('renames a chat in storage without rewriting its messages', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)
    await store.loadChatHistory()

    await store.renameChat('chat-1', 'Renamed')

    expect(api.callFunction).toHaveBeenCalledWith('renameChat', [
      'chat-1',
      'Renamed',
    ])
    expect(api.callFunction).not.toHaveBeenCalledWith(
      'saveChat',
      expect.anything()
    )
    expect(store.chatHistory.value[0]?.title).toBe('Renamed')
  })

  it('loads chat history into state', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await store.loadChatHistory()

    expect(store.chatHistory.value).toHaveLength(1)
    expect(store.chatHistory.value[0]?.id).toBe('chat-1')
  })

  it('saves texts with their kind and operation', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await store.saveOutput('sent')
    await store.saveOutput('left')
    await store.saveSource('before', 'translation')

    expect(api.callFunction.mock.calls).toEqual([
      ['saveEditorHistory', [{ text: 'sent', kind: 'output' }]],
      ['saveEditorHistory', [{ text: 'left', kind: 'output' }]],
      [
        'saveEditorHistory',
        [{ text: 'before', kind: 'source', operation: 'translation' }],
      ],
    ])
  })

  it('resolves to the id of the stored entry', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await expect(store.saveSource('before', 'correction')).resolves.toBe(
      'new-id'
    )
    await expect(store.saveOutput(' ')).resolves.toBeNull()
  })

  it('resolves to null when the history is turned off', async () => {
    const api = { callFunction: vi.fn(async () => ({ result: null })) }
    const store = createHistoryModel(api as unknown as HistoryApi)

    await expect(store.saveOutput('sent')).resolves.toBeNull()
  })

  it('attaches the AI result to a stored source only', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await store.saveSourceResult('id-1', 'Result.')
    await store.saveSourceResult(null, 'Lost.')

    expect(api.callFunction.mock.calls).toEqual([
      ['setEditorHistoryResult', ['id-1', 'Result.']],
    ])
  })

  it('loads the history only after pending writes', async () => {
    let finishWrite: () => void = () => {}
    const calls: string[] = []
    const api = {
      callFunction: vi.fn(async (functionName: string) => {
        calls.push(`start ${functionName}`)

        if (functionName === 'saveEditorHistory') {
          await new Promise<void>((resolve) => (finishWrite = resolve))
        }

        calls.push(`end ${functionName}`)
        return { result: [] }
      }),
    }
    const store = createHistoryModel(api as unknown as HistoryApi)

    const save = store.saveOutput('text')
    const load = store.loadEditorHistory()
    await Promise.resolve()
    finishWrite()
    await Promise.all([save, load])

    expect(calls).toEqual([
      'start saveEditorHistory',
      'end saveEditorHistory',
      'start getEditorHistory',
      'end getEditorHistory',
    ])
  })

  it('does not save blank texts', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)

    await store.saveOutput('')
    await store.saveOutput('  \n')

    expect(api.callFunction).not.toHaveBeenCalled()
  })

  it('removes items from session state after delete commands', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)
    store.editorHistory.value = [editorItem('1', 'one'), editorItem('2', 'two')]
    store.chatHistory.value = [
      { id: 'chat-1', title: 'A', lastMessageAt: 1 },
      { id: 'chat-2', title: 'B', lastMessageAt: 2 },
    ]

    const removed = await store.removeFromEditorHistory('1')
    await store.deleteChat('chat-1')

    expect(removed).toEqual(editorItem('1', 'one'))
    expect(api.callFunction).toHaveBeenCalledWith('removeFromEditorHistory', [
      '1',
    ])
    expect(store.editorHistory.value.map((item) => item.id)).toEqual(['2'])
    expect(store.chatHistory.value.map((item) => item.id)).toEqual(['chat-2'])
  })

  it('restores a removed item and reloads the list', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)
    const item = editorItem('1', 'one')

    await store.restoreEditorItem(item)

    expect(api.callFunction.mock.calls).toEqual([
      ['restoreEditorHistoryItem', [item]],
      ['getEditorHistory'],
    ])
    expect(store.editorHistory.value).toHaveLength(2)
  })

  it('returns and restores the full removed chat', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)
    store.chatHistory.value = [
      { id: 'chat-1', title: 'Hello', lastMessageAt: 1 },
    ]

    const removed = await store.deleteChat('chat-1')
    expect(removed?.messages).toEqual([{ role: 'user', content: 'Hello' }])

    await store.restoreChatItem(removed!)
    expect(api.callFunction).toHaveBeenCalledWith('saveChat', [removed])
    expect(store.chatHistory.value).toHaveLength(1)
  })

  it('clears in-memory state after clear commands', async () => {
    const api = createApi()
    const store = createHistoryModel(api as unknown as HistoryApi)
    store.editorHistory.value = [editorItem('1', 'one')]
    store.chatHistory.value = [{ id: 'chat-1', title: 'A', lastMessageAt: 1 }]

    await store.clearEditorHistory()
    await store.clearChats()

    expect(store.editorHistory.value).toEqual([])
    expect(store.chatHistory.value).toEqual([])
  })

  it('keeps session state when a destructive command fails', async () => {
    const api = {
      callFunction: vi.fn(async () => ({
        success: false,
        error: 'disk is read-only',
      })),
    }
    const store = createHistoryModel(api as unknown as HistoryApi)
    store.editorHistory.value = [editorItem('1', 'one')]

    await expect(store.removeFromEditorHistory('1')).rejects.toThrow(
      'disk is read-only'
    )
    await expect(store.clearEditorHistory()).rejects.toThrow(
      'disk is read-only'
    )

    expect(store.editorHistory.value).toEqual([editorItem('1', 'one')])
  })

  it('keeps loaded state when refreshing fails', async () => {
    const api = {
      callFunction: vi.fn(async () => ({ success: false, error: 'broken' })),
    }
    const store = createHistoryModel(api as unknown as HistoryApi)
    store.editorHistory.value = [editorItem('1', 'one')]

    await expect(store.loadEditorHistory()).rejects.toThrow('broken')

    expect(store.editorHistory.value).toEqual([editorItem('1', 'one')])
  })

  it('keeps a stored chat stored when only the list fails to reload', async () => {
    const api = {
      callFunction: vi.fn(async (functionName: string) =>
        functionName === 'listChats'
          ? { success: false, error: 'broken' }
          : { success: true, result: undefined }
      ),
    }
    const store = createHistoryModel(api as unknown as HistoryApi)

    await expect(
      store.saveChat({
        id: 'chat-1',
        title: 'Hello',
        lastMessageAt: 0,
        messages: [],
      })
    ).resolves.toBeUndefined()
  })

  it('does not bring back a removed chat with a list read before the removal', async () => {
    let finishLoad!: (value: unknown) => void
    const api = {
      callFunction: vi.fn(async (functionName: string) => {
        if (functionName === 'listChats')
          return new Promise((resolve) => {
            finishLoad = resolve
          })
        if (functionName === 'getChat') return { result: null }
        return {}
      }),
    }
    const store = createHistoryModel(api as unknown as HistoryApi)

    const load = store.loadChatHistory()
    await store.deleteChat('chat-1')
    finishLoad({ result: [{ id: 'chat-1', title: '', lastMessageAt: 0 }] })
    await load

    expect(store.chatHistory.value).toEqual([])
  })
})

describe('editor history response ordering', () => {
  it('keeps the newest load when responses arrive out of order', async () => {
    const api = createApi()
    let resolveOld!: (value: { result: EditorHistoryItem[] }) => void
    api.callFunction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    const model = createHistoryModel(api as unknown as HistoryApi)
    const oldLoad = model.loadEditorHistory()
    await Promise.resolve()
    await model.loadEditorHistory()
    resolveOld({ result: [editorItem('old', 'obsolete')] })
    await oldLoad
    expect(model.editorHistory.value.map((item) => item.id)).toEqual(['1', '2'])
  })

  it.each(['removeFromEditorHistory', 'clearEditorHistory'] as const)(
    'does not resurrect items when a load finishes after %s',
    async (operation) => {
      const api = createApi()
      const model = createHistoryModel(api as unknown as HistoryApi)
      await model.loadEditorHistory()
      let resolveLoad!: (value: { result: EditorHistoryItem[] }) => void
      api.callFunction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve
          })
      )
      const loading = model.loadEditorHistory()
      await Promise.resolve()
      if (operation === 'clearEditorHistory') await model.clearEditorHistory()
      else await model.removeFromEditorHistory('1')
      resolveLoad({ result: [editorItem('1', 'one'), editorItem('2', 'two')] })
      await loading
      expect(model.editorHistory.value.map((item) => item.id)).toEqual(
        operation === 'clearEditorHistory' ? [] : ['2']
      )
    }
  )
})
