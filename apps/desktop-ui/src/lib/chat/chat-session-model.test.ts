import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Chat, ChatMessage } from '@tyco/shared'
import { APP_ROUTES } from '../navigation/routes'
import { createChatSessionModel } from './chat-session-model'
import type { ChatState } from './chat-state'

describe('createChatSessionModel', () => {
  const createState = (): ChatState => ({
    messages: ref<ChatMessage[]>([]),
    currentChatParams: ref({}),
    isGenerating: ref(false),
    error: ref(''),
    isStopped: ref(false),
    omitHistoryImages: ref(false),
    trimmedTurnCount: ref(0),
    lastFailedTurn: ref(null),
  })

  const setup = (state = createState()) => {
    let idCounter = 1
    const deps = {
      createId: vi.fn(() => `chat-${idCounter++}`),
      saveSessionState: vi.fn(async () => {}),
      navigateTo: vi.fn(async () => {}),
      loadChat: vi.fn(async (_id: string): Promise<Chat | null> => null),
      notifyError: vi.fn(),
      chatLoadError: vi.fn(() => 'Load error'),
      chatNotFoundError: vi.fn(() => 'Not found'),
      getLastChatId: vi.fn(() => null as string | null),
      branchTitle: vi.fn((title: string) => `Branch of ${title}`),
    }
    const halt = vi.fn()
    const persist = vi.fn(async () => true)

    const model = createChatSessionModel(deps, state, halt, persist)
    return { model, state, deps, halt, persist }
  }

  describe('startChat', () => {
    it('initializes a fresh chat and navigates to the chat route', async () => {
      const { model, state, deps } = setup()
      state.messages.value = [{ role: 'user', content: 'hello' }]
      await model.startChat({ title: 'New Topic' })

      expect(state.messages.value).toEqual([])
      expect(state.currentChatParams.value).toMatchObject({
        id: 'chat-1',
        title: 'New Topic',
      })
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
    })
  })

  describe('branchChat', () => {
    it('returns false for invalid index', async () => {
      const { model, state } = setup()
      state.messages.value = [{ role: 'user', content: 'one' }]
      expect(await model.branchChat(-1)).toBe(false)
      expect(await model.branchChat(5)).toBe(false)
    })

    it('branches conversation up to the chosen message index and saves it', async () => {
      const { model, state, deps, persist, halt } = setup()
      state.currentChatParams.value = { id: 'old-chat', title: 'Main Chat' }
      state.messages.value = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'response 1' },
        { role: 'user', content: 'second' },
      ]

      const success = await model.branchChat(1)
      expect(success).toBe(true)
      expect(halt).toHaveBeenCalledWith(true)
      expect(deps.branchTitle).toHaveBeenCalledWith('Main Chat')
      expect(persist).toHaveBeenCalledWith(
        [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'response 1' },
        ],
        expect.objectContaining({ id: 'chat-1', title: 'Branch of Main Chat' })
      )
      expect(deps.saveSessionState).toHaveBeenCalledWith({
        lastChatId: 'chat-1',
      })
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
      expect(state.messages.value).toHaveLength(2)
    })

    it('returns false if persisting the branch fails', async () => {
      const { model, state, persist } = setup()
      persist.mockResolvedValueOnce(false)
      state.messages.value = [{ role: 'user', content: 'test' }]

      expect(await model.branchChat(0)).toBe(false)
    })
  })

  describe('addAttachment and attachToChat', () => {
    it('attaches text into current chat if empty without messages', async () => {
      const { model, state, deps } = setup()
      await model.attachToChat({ text: 'Selection snippet', name: 'selection' })

      expect(state.currentChatParams.value.attachments).toEqual([
        { text: 'Selection snippet', name: 'selection' },
      ])
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
    })

    it('starts a new chat if existing chat already has messages', async () => {
      const { model, state, deps } = setup()
      state.messages.value = [{ role: 'user', content: 'existing' }]
      await model.attachToChat({ text: 'Context snippet', name: 'doc' })

      expect(state.messages.value).toEqual([])
      expect(state.currentChatParams.value.attachments).toEqual([
        { text: 'Context snippet', name: 'doc' },
      ])
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
    })

    it('ignores empty or whitespace attachment text and skips duplicates', () => {
      const { model, state } = setup()
      model.addAttachment({ text: '   ', name: 'blank' })
      expect(state.currentChatParams.value.attachments).toBeUndefined()

      model.addAttachment({ text: 'sample', name: 'file.txt' })
      expect(state.currentChatParams.value.attachments).toHaveLength(1)

      model.addAttachment({ text: 'sample', name: 'file.txt' })
      expect(state.currentChatParams.value.attachments).toHaveLength(1)
    })
  })

  describe('openChat and openLastOrNewChat', () => {
    it('loads chat and populates state upon success', async () => {
      const { model, state, deps } = setup()
      const sampleChat: Chat = {
        id: 'chat-42',
        title: 'Loaded Chat',
        lastMessageAt: 1_767_225_600_000,
        messages: [{ role: 'user', content: 'Hi' }],
      }
      deps.loadChat.mockResolvedValueOnce(sampleChat)

      const opened = await model.openChat('chat-42')
      expect(opened).toBe(true)
      expect(state.messages.value).toEqual(sampleChat.messages)
      expect(state.currentChatParams.value.id).toBe('chat-42')
      expect(deps.saveSessionState).toHaveBeenCalledWith({
        lastChatId: 'chat-42',
      })
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
    })

    it('handles not found and reports error', async () => {
      const { model, deps } = setup()
      deps.loadChat.mockResolvedValueOnce(null)

      const opened = await model.openChat('missing')
      expect(opened).toBe(false)
      expect(deps.notifyError).toHaveBeenCalledWith('Not found')
    })

    it('handles load error and suppresses notification when silent', async () => {
      const { model, deps } = setup()
      deps.loadChat.mockRejectedValueOnce(new Error('I/O error'))

      const opened = await model.openChat('broken', { silent: true })
      expect(opened).toBe(false)
      expect(deps.notifyError).not.toHaveBeenCalled()
    })

    it('opens last chat or falls back to new chat', async () => {
      const { model, deps, state } = setup()
      deps.getLastChatId.mockReturnValueOnce('chat-99')
      deps.loadChat.mockResolvedValueOnce({
        id: 'chat-99',
        title: 'Last',
        lastMessageAt: 1_767_225_600_000,
        messages: [],
      })

      await model.openLastOrNewChat()
      expect(state.currentChatParams.value.id).toBe('chat-99')

      // When ID is already present, just navigates
      deps.navigateTo.mockClear()
      await model.openLastOrNewChat()
      expect(deps.navigateTo).toHaveBeenCalledWith(APP_ROUTES.CHAT.path)
      expect(deps.loadChat).not.toHaveBeenCalledTimes(2)
    })
  })

  describe('abandonChat', () => {
    it('halts generation without saving and resets to new id', () => {
      const { model, state, halt } = setup()
      state.messages.value = [{ role: 'user', content: 'discard me' }]
      model.abandonChat()

      expect(halt).toHaveBeenCalledWith(false)
      expect(state.messages.value).toEqual([])
      expect(state.currentChatParams.value.id).toBe('chat-1')
    })
  })
})
