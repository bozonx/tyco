import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { APP_CONFIG, DEFAULT_LLM_CONFIG, type AiProfile } from '@tyco/shared'

import type { DesktopCall } from '../lib/ipc/desktop-functions'
import { appNavigation } from '../lib/navigation/navigation'
import { useAiProfilesStore } from './ai-profiles'
import {
  disposeProfileChatStore,
  useChatStore,
  useProfileChatStore,
} from './chat'
import { useChatInputStore, useProfileChatInputStore } from './chat-input'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useDesktopStore } from './desktop'
import { chatAnswer } from '../lib/chat/testing'

const ai = vi.hoisted(() => ({
  sendChatMessage: vi.fn(async () => chatAnswer('answer')),
  generateChatTitle: vi.fn(async () => ''),
}))

vi.mock('./llm', () => ({ useLlmStore: () => ({ actions: ai }) }))
vi.mock('./secrets', () => ({ useSecretsStore: () => ({ secrets: {} }) }))
vi.mock(import('../lib/chat/chat-image-storage'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createChatImageStorage: (deps) => ({
      ...original.createChatImageStorage(deps),
      syncChatImages: vi.fn(async () => {}),
    }),
  }
})

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()
  vi.spyOn(appNavigation, 'push').mockResolvedValue()
  vi.spyOn(useHistoryStore(), 'saveChat').mockResolvedValue()
  const desktopStore = useDesktopStore()
  vi.spyOn(desktopStore, 'patchSessionState').mockResolvedValue({
    success: true,
    result: desktopStore.desktopState.sessionState,
  })
  desktopStore.applyViewState({
    ...desktopStore.desktopState,
    userConfig: {
      ...desktopStore.desktopState.userConfig,
      llm: structuredClone(DEFAULT_LLM_CONFIG),
    },
    isWindowShown: true,
  })
})
afterEach(() => disposePinia(pinia))

describe('chat store dependency wiring', () => {
  it('connects the real chat model and controller to input, editor, and AI services', async () => {
    const store = useChatStore()
    const input = useChatInputStore()
    const editor = useEditorInputStore()
    editor.setValue('Draft with a part')
    editor.setSelection('a part', 13, 19)
    await store.startChat({ attachments: [{ text: 'pending' }] })
    expect(input.focusRequestCount).toBe(1)
    input.setValue(' Question ')
    expect(await store.sendInput()).toBe(true)
    await vi.waitFor(() => expect(store.isGenerating).toBe(false))
    expect(input.value).toBe('')
    expect(store.messages[0]).toMatchObject({
      content: 'Question',
      attachments: [{ text: 'pending' }],
    })
    expect(store.messages[1]?.content).toBe('answer')
    expect(ai.sendChatMessage).toHaveBeenCalledOnce()
    expect(useHistoryStore().saveChat).toHaveBeenCalled()
  })

  it('forwards window visibility changes to the controller without leaking into another Pinia', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Draft')
    editor.setSelection('Draft', 0, 5)
    const store = useChatStore()
    expect(store.voiceChatContext?.source).toBe('editor-selection')
    useDesktopStore().applyViewState({
      ...useDesktopStore().desktopState,
      isWindowShown: false,
    })
    await nextTick()
    expect(store.voiceChatContext).toBeNull()
    const otherPinia = createPinia()
    try {
      expect(useChatStore(otherPinia).voiceChatContext).toBeNull()
      expect(store.voiceChatContext).toBeNull()
    } finally {
      disposePinia(otherPinia)
    }
  })
})

it('budgets the actual chat instructions, rules and configured output consistently', async () => {
  const desktopStore = useDesktopStore()
  desktopStore.desktopState.userConfig.llm!.models[0].contextWindowTokens = 4096
  desktopStore.desktopState.userConfig.llm!.models[0].maxOutputTokens = 3000
  desktopStore.desktopState.userConfig.aiRules = {
    ...desktopStore.desktopState.userConfig.aiRules,
    chat: 'x'.repeat(4000),
  }
  const store = useChatStore()
  const input = useChatInputStore()
  input.setValue('Question')
  expect(store.contextBudget?.budgetCharacters).toBe(0)
  expect(store.contextBudget?.level).toBe('over')
  expect(await store.sendInput()).toBe(false)
  expect(ai.sendChatMessage).not.toHaveBeenCalled()
  expect(input.value).toBe('Question')
})

describe('profile chats', () => {
  const writer: AiProfile = {
    id: 'writer',
    name: 'Writer',
    temperature: 0.3,
    maxOutputTokens: 500,
    projectPermissions: {},
    createdAt: 1,
    updatedAt: 1,
  }

  /** The vault holds one profile; its files may change between requests */
  function mockVault(files: { soul: string; profile: AiProfile }) {
    const ipc = useIpcStore()
    return vi.spyOn(ipc, 'callFunction').mockImplementation((async (
      name: string
    ) => {
      switch (name) {
        case 'getAiVaultPath':
          return { success: true, result: '/vault' }
        case 'listAiProfiles':
          return { success: true, result: [files.profile] }
        case 'listAiProjects':
          return { success: true, result: [] }
        case 'getAiProfile':
          return { success: true, result: files.profile }
        case 'readProfileSoul':
          return { success: true, result: files.soul }
        case 'listChats':
          return { success: true, result: [] }
        default:
          return { success: true, result: undefined }
      }
    }) as DesktopCall)
  }

  async function sendIn(
    store: ReturnType<typeof useChatStore>,
    input: { setValue: (text: string) => void },
    text: string
  ) {
    input.setValue(text)
    expect(await store.sendInput()).toBe(true)
    await vi.waitFor(() => expect(store.isGenerating).toBe(false))
  }

  it('keeps the conversation of a profile apart from "Ask AI"', async () => {
    const call = mockVault({ soul: '# Writer', profile: writer })
    await useAiProfilesStore().loadAll()
    const profileChat = useProfileChatStore('writer')

    await sendIn(profileChat, useProfileChatInputStore('writer'), 'Hello')

    expect(profileChat.messages.map((m) => m.content)).toEqual([
      'Hello',
      'answer',
    ])
    expect(useChatStore().messages).toEqual([])
    expect(useChatInputStore().value).toBe('')
    expect(useHistoryStore().saveChat).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledWith('saveChat', [
      expect.objectContaining({ id: profileChat.currentChatParams.id }),
      'writer',
    ])
  })

  it('asks with the SOUL.md and settings read just before the request', async () => {
    const files = { soul: '# Old', profile: writer }
    mockVault(files)
    await useAiProfilesStore().loadAll()
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.aiRules = {
      ...desktopStore.desktopState.userConfig.aiRules,
      chat: 'Ask AI rules',
    }
    const profileChat = useProfileChatStore('writer')
    files.soul = '# Edited by hand'
    files.profile = { ...writer, temperature: 1.1 }

    await sendIn(profileChat, useProfileChatInputStore('writer'), 'Hello')

    expect(ai.sendChatMessage).toHaveBeenCalledWith(
      'Hello',
      [],
      '# Edited by hand',
      expect.objectContaining({ temperature: 1.1, maxOutputTokens: 500 })
    )
    const [, , , options] = ai.sendChatMessage.mock.calls[0] as unknown[]
    expect(options).not.toHaveProperty('rules')
  })

  it('gives "Ask AI" its own instructions and the user chat rules', async () => {
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.aiRules = {
      ...desktopStore.desktopState.userConfig.aiRules,
      chat: 'Ask AI rules',
    }
    const store = useChatStore()

    await sendIn(store, useChatInputStore(), 'Question')

    expect(ai.sendChatMessage).toHaveBeenCalledWith(
      'Question',
      [],
      APP_CONFIG.aiInstructions.chat,
      expect.objectContaining({ rules: 'Ask AI rules' })
    )
  })

  it('keeps answering in a profile while "Ask AI" is opened', async () => {
    mockVault({ soul: '', profile: writer })
    await useAiProfilesStore().loadAll()
    let finish!: (text: string) => void
    ai.sendChatMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => (finish = (text) => resolve(chatAnswer(text))))
    )
    const profileChat = useProfileChatStore('writer')
    const input = useProfileChatInputStore('writer')
    input.setValue('Long question')
    await profileChat.sendInput()
    await vi.waitFor(() => expect(ai.sendChatMessage).toHaveBeenCalled())

    await useChatStore().openLastOrNewChat()

    expect(profileChat.isGenerating).toBe(true)
    finish('long answer')
    await vi.waitFor(() => expect(profileChat.isGenerating).toBe(false))
    expect(profileChat.messages.at(-1)?.content).toBe('long answer')
    expect(useChatStore().messages).toEqual([])
  })

  it('keeps the model picked in a profile in the profile', async () => {
    const call = mockVault({ soul: '', profile: writer })
    await useAiProfilesStore().loadAll()
    const desktopStore = useDesktopStore()
    const profileChat = useProfileChatStore('writer')
    const modelId = profileChat.modelOptions[0]!.id

    await profileChat.selectModel(modelId)

    expect(call).toHaveBeenCalledWith('saveAiProfile', [
      expect.objectContaining({ id: 'writer', modelId }),
    ])
    expect(desktopStore.patchSessionState).not.toHaveBeenCalled()
  })

  it('opens a profile chat on the profile route', async () => {
    mockVault({ soul: '', profile: writer })
    await useAiProfilesStore().loadAll()
    vi.spyOn(appNavigation, 'isCurrent').mockReturnValue(false)
    const goToProfileChat = vi
      .spyOn(appNavigation, 'goToProfileChat')
      .mockResolvedValue()

    await useProfileChatStore('writer').startNewChat()

    expect(goToProfileChat).toHaveBeenCalledWith('writer')
    expect(appNavigation.push).not.toHaveBeenCalled()
  })

  it('forgets the chat and input draft of a removed profile', async () => {
    mockVault({ soul: '', profile: writer })
    await useAiProfilesStore().loadAll()
    const before = useProfileChatStore('writer')
    before.currentChatParams.title = 'Draft'
    useProfileChatInputStore('writer').setValue('Unsent message')

    disposeProfileChatStore('writer')

    expect(useProfileChatStore('writer').currentChatParams.title).toBe(
      undefined
    )
    expect(useProfileChatInputStore('writer').value).toBe('')
  })

  it('forgets the chat of a profile once the profile is removed', async () => {
    mockVault({ soul: '', profile: writer })
    await useAiProfilesStore().loadAll()
    const before = useProfileChatStore('writer')
    before.currentChatParams.title = 'Draft'
    useProfileChatInputStore('writer').setValue('Unsent message')

    await useAiProfilesStore().deleteProfile('writer')

    expect(useProfileChatStore('writer')).not.toBe(before)
    expect(useProfileChatInputStore('writer').value).toBe('')
  })
})
