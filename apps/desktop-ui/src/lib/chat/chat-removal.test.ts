import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Chat, ChatParams } from '@tyco/shared'

import { createChatRemoval } from './chat-removal'

const chat: Chat = { id: 'open', title: 'Open', lastMessageAt: 1, messages: [] }

function setup(deleteChat: (id: string) => Promise<Chat | null>) {
  const calls: string[] = []
  const currentChatParams = ref<ChatParams>({ id: 'open' })
  const deps = {
    history: {
      deleteChat: vi.fn(async (id: string) => {
        calls.push('delete')
        return deleteChat(id)
      }),
      restoreChatItem: vi.fn(async () => {}),
    },
    chat: {
      currentChatParams,
      stopGeneration: vi.fn(() => calls.push('stop')),
      whenSaved: vi.fn(async () => {
        calls.push('saved')
      }),
      abandonChat: vi.fn(() => calls.push('abandon')),
      openChat: vi.fn(async () => {
        calls.push('reopen')
        return true
      }),
    },
    isHistoryEnabled: vi.fn(() => true),
    releaseImages: vi.fn(async () => {}),
    reportError: vi.fn(),
  }
  return { removal: createChatRemoval(deps), deps, calls }
}

describe('createChatRemoval', () => {
  it('stores what an answer still coming has before leaving the open chat', async () => {
    const { removal, calls } = setup(async () => chat)

    await removal.remove('open')

    expect(calls).toEqual(['stop', 'saved', 'abandon', 'delete'])
    expect(removal.removed.value).toEqual(chat)
    await removal.dispose()
  })

  it('reopens the open chat when its removal fails', async () => {
    const error = new Error('Disk unavailable')
    const { removal, deps, calls } = setup(async () => {
      throw error
    })

    await removal.remove('open')

    expect(calls).toEqual(['stop', 'saved', 'abandon', 'delete', 'reopen'])
    expect(deps.chat.openChat).toHaveBeenCalledWith('open', { silent: true })
    expect(deps.reportError).toHaveBeenCalledWith(error)
    expect(removal.removed.value).toBeNull()
  })

  it('leaves the open chat alone when another one is removed', async () => {
    const { removal, deps } = setup(async () => ({ ...chat, id: 'other' }))

    await removal.remove('other')

    expect(deps.chat.stopGeneration).not.toHaveBeenCalled()
    expect(deps.chat.abandonChat).not.toHaveBeenCalled()
    await removal.dispose()
    expect(deps.releaseImages).toHaveBeenCalledWith('other')
  })

  it('keeps the removed chat when the history is off', async () => {
    const { removal, deps } = setup(async () => chat)
    await removal.remove('open')
    deps.isHistoryEnabled.mockReturnValue(false)

    await removal.undo()

    expect(deps.history.restoreChatItem).not.toHaveBeenCalled()
    expect(removal.removed.value).toEqual(chat)
    expect(deps.reportError).toHaveBeenCalled()
    await removal.dispose()
  })
})
