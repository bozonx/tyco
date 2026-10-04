import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useChatStore } from './chat'

const mocks = vi.hoisted(() => ({
  label: 'main',
  callFunction: vi.fn().mockResolvedValue({ success: true }),
  startChat: vi.fn().mockResolvedValue(undefined),
  attachToChat: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue('answer'),
  focus: vi.fn(),
  clear: vi.fn(),
  setValue: vi.fn(),
  input: { value: '' },
  editor: { value: '', selectedText: '' },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: mocks.label }),
}))
vi.mock('../composables/useCallAi', () => ({ useCallAi: () => ({}) }))
vi.mock('../composables/useToast', () => ({
  default: () => ({ toast: vi.fn() }),
}))
vi.mock('../lib/navigation/navigation', () => ({ appNavigation: {} }))
vi.mock('../lib/chat/chat-store', () => ({
  createChatStoreModel: () => ({
    startChat: mocks.startChat,
    attachToChat: mocks.attachToChat,
    sendMessage: mocks.sendMessage,
    messages: ref([]),
    newChatParams: ref({ attachments: ['pending'] }),
    isGenerating: ref(false),
    dismissedEditorContext: ref(null),
  }),
}))
vi.mock('./ipc', () => ({
  useIpcStore: () => ({
    params: { userConfig: {}, localState: {} },
    callFunction: mocks.callFunction,
    callFunctionOrNotify: mocks.callFunction,
  }),
}))
vi.mock('./llm', () => ({ useLlmStore: () => ({ secrets: {} }) }))
vi.mock('./history', () => ({ useHistoryStore: () => ({}) }))
vi.mock('./editorInput', () => ({ useEditorInputStore: () => mocks.editor }))
vi.mock('./chatInput', () => ({
  useChatInputStore: () => ({
    get value() {
      return mocks.input.value
    },
    focus: mocks.focus,
    clear: mocks.clear,
    setValue: mocks.setValue,
  }),
}))

describe('chat window navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.label = 'main'
    mocks.input.value = ''
    mocks.editor.value = ''
    mocks.editor.selectedText = ''
  })

  it('opens the chat with context and focuses its input', async () => {
    await useChatStore().startChat({ attachments: ['  context  '] })
    expect(mocks.startChat).toHaveBeenCalledWith({
      attachments: ['  context  '],
    })
    expect(mocks.focus).toHaveBeenCalledOnce()
    expect(mocks.callFunction).not.toHaveBeenCalled()
  })

  it('transfers context from the quick window to the main window', async () => {
    mocks.label = 'quick'
    await useChatStore().startChat({ attachments: ['  context  '] })
    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      '  context  ',
    ])
    expect(mocks.startChat).not.toHaveBeenCalled()
    expect(mocks.focus).not.toHaveBeenCalled()
  })

  it('hands a selection over from the quick window as well', async () => {
    mocks.label = 'quick'
    await useChatStore().attachToChat('selection')
    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      'selection',
    ])
    expect(mocks.attachToChat).not.toHaveBeenCalled()
  })

  it('sends the input with the attachments and the editor text', async () => {
    mocks.input.value = ' Question '
    mocks.editor.value = 'Draft'

    await useChatStore().sendInput()

    expect(mocks.sendMessage).toHaveBeenCalledWith('Question', [
      'pending',
      'Draft',
    ])
    expect(mocks.clear).toHaveBeenCalled()
  })
})
