import { describe, expect, it, vi } from 'vitest'

import { createChatGenerationModel } from './chat-generation-model'
import { createChatPersistenceQueue } from './chat-persistence-queue'
import { prepareGenerationRequest } from './chat-request-preparation'
import { createChatSessionModel } from './chat-session-model'
import { createChatState } from './chat-state'
import type { ChatStoreDeps } from './chat-store-contracts'
import { createChatTitleController } from './chat-title-controller'

function fixture() {
  const state = createChatState()
  const deps: ChatStoreDeps = {
    sendChatMessage: vi.fn(async () => 'Answer'),
    generateChatTitle: vi.fn(async () => 'Generated title'),
    saveChatHistory: vi.fn(),
    renameChat: vi.fn(),
    loadChatHistoryItem: vi.fn(async () => null),
    navigateTo: vi.fn(),
    notifyError: vi.fn(),
    emptyMessageError: () => 'Empty',
    chatNotFoundError: () => 'Missing',
    messageTooLongError: () => 'Too long',
    noModelError: () => 'No model',
    createId: () => 'new-id',
    nowIso: () => '2026-04-22T00:00:00.000Z',
    saveLocalState: vi.fn(),
    getLastChatId: () => null,
    getChatModel: () => ({ id: 'model', budgetCharacters: 1000 }),
  }
  return { state, deps }
}

describe('chat model boundaries', () => {
  it('serializes writes and continues after a failed save', async () => {
    const { state, deps } = fixture()
    state.newChatParams.value = { id: 'chat' }
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    deps.saveChatHistory = vi
      .fn()
      .mockImplementationOnce(() =>
        blocked.then(() => {
          throw new Error('Save failed')
        })
      )
      .mockResolvedValueOnce(undefined)
    const queue = createChatPersistenceQueue(deps, state)
    const first = queue.persist([{ role: 'user', content: 'First' }])
    const second = queue.persist([{ role: 'user', content: 'Second' }])
    await Promise.resolve()
    expect(deps.saveChatHistory).toHaveBeenCalledTimes(1)
    release()
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    await queue.whenSaved()
    expect(deps.saveChatHistory).toHaveBeenCalledTimes(2)
  })

  it('does not apply a title after cancellation even if the provider resolves', async () => {
    const { state, deps } = fixture()
    state.newChatParams.value = { id: 'chat', title: 'Question' }
    state.messages.value = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ]
    let release!: (title: string) => void
    deps.generateChatTitle = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    const title = createChatTitleController(deps, state)
    const pending = title.maybeGenerateTitle('model')
    title.cancel()
    release('Late title')
    await pending
    expect(state.newChatParams.value.title).toBe('Question')
    expect(deps.renameChat).not.toHaveBeenCalled()
  })

  it('prepares a request without changing the current conversation', () => {
    const { state, deps } = fixture()
    state.messages.value = [
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Answer' },
    ]
    const before = [...state.messages.value]
    const request = prepareGenerationRequest(deps, state, 'Next', [], [])
    expect(request?.prevMessages).toEqual(before)
    expect(state.messages.value).toEqual(before)
    expect(
      prepareGenerationRequest(deps, state, 'x'.repeat(1001), [], [])
    ).toBeNull()
    expect(state.messages.value).toEqual(before)
  })

  it('ignores late chunks and completion after stopping generation', async () => {
    const { state, deps } = fixture()
    let release!: (answer: string) => void
    let chunk!: (text: string) => void
    deps.sendChatMessage = vi.fn(
      (_message, _history, _instructions, options) => {
        chunk = options.onChunk!
        return new Promise<string>((resolve) => {
          release = resolve
        })
      }
    )
    const persist = vi.fn(async () => true)
    const cancelTitle = vi.fn()
    const generation = createChatGenerationModel(
      deps,
      state,
      persist,
      vi.fn(),
      cancelTitle
    )
    const pending = generation.sendMessage('Question')
    generation.stopGeneration()
    chunk('Late chunk')
    release('Late answer')
    expect(await pending).toBe('')
    expect(state.messages.value).toEqual([
      { role: 'user', content: 'Question' },
    ])
    expect(cancelTitle).toHaveBeenCalledOnce()
  })

  it('invalidates a pending open when a new session starts', async () => {
    const { state, deps } = fixture()
    let release!: (chat: null) => void
    deps.loadChatHistoryItem = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          release = resolve
        })
    )
    const halt = vi.fn()
    const session = createChatSessionModel(
      deps,
      state,
      halt,
      vi.fn(async () => true)
    )
    const pending = session.openChat('old')
    await session.startChat({ title: 'New' })
    release(null)
    expect(await pending).toBe(false)
    expect(state.newChatParams.value).toEqual({ id: 'new-id', title: 'New' })
    expect(deps.notifyError).not.toHaveBeenCalled()
    expect(halt).toHaveBeenCalledWith(true)
  })
})
