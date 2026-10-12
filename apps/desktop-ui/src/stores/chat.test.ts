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
  saveLocalState: vi.fn(async () => ({ success: true })),
}))

vi.mock('../composables/use-call-ai', () => ({ useCallAi: () => ai }))
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
  vi.spyOn(useHistoryStore(), 'saveChatHistory').mockResolvedValue()
  const ipc = useIpcStore()
  ipc.setParams({
    userConfig: {
      ...ipc.params.userConfig,
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
    expect(input.focusCount).toBe(1)
    input.setValue(' Question ')
    expect(await store.sendInput()).toBe(true)
    await vi.waitFor(() => expect(store.isGenerating).toBe(false))
    expect(input.value).toBe('')
    expect(store.messages[0]).toMatchObject({
      content: 'Question',
      attachments: [
        { text: 'pending' },
        { text: 'a part', source: 'editor-selection' },
      ],
    })
    expect(store.messages[1]?.content).toBe('answer')
    expect(ai.sendChatMessage).toHaveBeenCalledOnce()
    expect(useHistoryStore().saveChatHistory).toHaveBeenCalled()
  })

  it('forwards window visibility changes to the controller without leaking into another Pinia', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Draft')
    editor.setSelection('Draft', 0, 5)
    const store = useChatStore()
    expect(store.editorContext?.mode).toBe('attached')
    useIpcStore().setParams({ isWindowShown: false })
    await nextTick()
    expect(store.editorContext?.mode).toBe('suggested')
    const otherPinia = createPinia()
    try {
      expect(useChatStore(otherPinia).editorContext).toBeNull()
      expect(store.editorContext?.mode).toBe('suggested')
    } finally {
      disposePinia(otherPinia)
    }
  })
})
