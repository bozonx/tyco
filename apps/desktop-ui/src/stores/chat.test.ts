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
  closeAll: vi.fn(),
  input: { value: '' },
  editor: { value: '', selectedText: '' },
}))
const chatModelMessages = ref<unknown[]>([])
const chatModelIsGenerating = ref(false)

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
    messages: chatModelMessages,
    newChatParams: ref({ attachments: [{ text: 'pending' }] }),
    isGenerating: chatModelIsGenerating,
    isStopped: ref(false),
    dismissedEditorContext: ref(null),
    acceptedEditorContext: ref(null),
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
vi.mock('./menuModals', () => ({
  useMenuModalsStore: () => ({ closeAll: mocks.closeAll }),
}))
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
    mocks.clear.mockImplementation(() => {
      mocks.input.value = ''
    })
    chatModelMessages.value = []
    chatModelIsGenerating.value = false
    mocks.sendMessage.mockImplementation(async (msg: string) => {
      chatModelMessages.value.push({ role: 'user', content: msg })
      return 'answer'
    })
    mocks.editor.value = ''
    mocks.editor.selectedText = ''
  })

  it('opens the chat with context and focuses its input', async () => {
    await useChatStore().startChat({ attachments: [{ text: '  context  ' }] })
    expect(mocks.closeAll).toHaveBeenCalledOnce()
    expect(mocks.startChat).toHaveBeenCalledWith({
      attachments: [{ text: '  context  ' }],
    })
    expect(mocks.focus).toHaveBeenCalledOnce()
    expect(mocks.callFunction).not.toHaveBeenCalled()
  })

  it('transfers context from the quick window to the main window', async () => {
    mocks.label = 'quick'
    await useChatStore().startChat({ attachments: [{ text: '  context  ' }] })
    expect(mocks.closeAll).toHaveBeenCalledOnce()
    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      { text: '  context  ' },
    ])
    expect(mocks.startChat).not.toHaveBeenCalled()
    expect(mocks.focus).not.toHaveBeenCalled()
  })

  it('hands a selection over from the quick window as well', async () => {
    mocks.label = 'quick'
    await useChatStore().attachToChat('selection')
    expect(mocks.closeAll).toHaveBeenCalledOnce()
    expect(mocks.callFunction).toHaveBeenCalledWith('openMainChat', [
      { text: 'selection', source: undefined },
    ])
    expect(mocks.attachToChat).not.toHaveBeenCalled()
  })

  it('sends the input with the attachments and the editor selection', async () => {
    mocks.input.value = ' Question '
    mocks.editor.value = 'Draft with a part'
    mocks.editor.selectedText = 'a part'

    await useChatStore().sendInput()

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'Question',
      [{ text: 'pending' }, { text: 'a part', source: 'editor-selection' }],
      []
    )
    expect(mocks.clear).toHaveBeenCalled()
  })

  it('tells the source of a text an action gives to the chat', async () => {
    mocks.editor.value = 'Draft with a part'
    mocks.editor.selectedText = 'a part'

    await useChatStore().attachToChat('Draft with a part')

    expect(mocks.attachToChat).toHaveBeenCalledWith({
      text: 'Draft with a part',
      source: 'editor-text',
    })
  })

  it('only suggests the whole editor text', async () => {
    mocks.input.value = 'Question'
    mocks.editor.value = 'Draft'

    const store = useChatStore()
    expect(store.editorContext).toMatchObject({
      text: 'Draft',
      mode: 'suggested',
    })
    await store.sendInput()

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      'Question',
      [{ text: 'pending' }],
      []
    )
  })
  it('does not overwrite a draft when a previous request completes after cancellation', async () => {
    let resolve!: (text: string) => void
    mocks.sendMessage.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    mocks.input.value = 'First question'
    const store = useChatStore()
    const pending = store.sendInput()
    mocks.input.value = 'New draft'
    resolve('')
    await pending
    expect(mocks.setValue).not.toHaveBeenCalled()
    expect(mocks.input.value).toBe('New draft')
  })

  it('restores input when request could not be dispatched', async () => {
    mocks.sendMessage.mockImplementation(async () => '')
    mocks.input.value = 'Failed question'
    const store = useChatStore()
    const sent = await store.sendInput()
    expect(sent).toBe(false)
    expect(mocks.setValue).toHaveBeenCalledWith('Failed question')
  })

  it('does not restore input when request was dispatched to chat', async () => {
    mocks.input.value = 'Dispatched question'
    const store = useChatStore()
    const sent = await store.sendInput()
    expect(sent).toBe(true)
    expect(mocks.setValue).not.toHaveBeenCalled()
  })
})
