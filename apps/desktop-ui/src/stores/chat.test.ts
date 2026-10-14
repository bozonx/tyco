import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { DEFAULT_LLM_CONFIG } from '@tyco/shared'

import { appNavigation } from '../lib/navigation/navigation'
import { useChatStore } from './chat'
import { useChatInputStore } from './chat-input'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'

const ai = vi.hoisted(() => ({
  sendChatMessage: vi.fn(async () => 'answer'),
  generateChatTitle: vi.fn(async () => ''),
}))

vi.mock('../composables/use-llm-actions', () => ({ useLlmActions: () => ai }))
vi.mock(import('../lib/chat/chat-image-storage'), async (importOriginal) => ({
  ...(await importOriginal()),
  syncChatImages: vi.fn(async () => {}),
}))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()
  vi.spyOn(appNavigation, 'push').mockResolvedValue()
  vi.spyOn(useHistoryStore(), 'saveChat').mockResolvedValue()
  const ipc = useIpcStore()
  vi.spyOn(ipc, 'patchSessionState').mockResolvedValue({
    success: true,
    result: ipc.desktopState.sessionState,
  })
  ipc.applyViewState({
    ...ipc.desktopState,
    userConfig: {
      ...ipc.desktopState.userConfig,
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
    useIpcStore().applyViewState({
      ...useIpcStore().desktopState,
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
  const ipc = useIpcStore()
  ipc.desktopState.userConfig.llm!.models[0].contextWindowTokens = 4096
  ipc.desktopState.userConfig.llm!.models[0].maxOutputTokens = 3000
  ipc.desktopState.userConfig.aiRules = {
    ...ipc.desktopState.userConfig.aiRules,
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
