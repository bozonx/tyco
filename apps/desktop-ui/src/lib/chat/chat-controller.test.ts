import { describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import type { Chat } from '@tyco/shared'

import { createChatController } from './chat-controller'
import { createChatModel } from './chat-model'
import type { ChatLlmOption } from './chat-llm-selection'

function setup() {
  const selectedModel = ref<ChatLlmOption | null>({
    id: 'model',
    name: 'Model',
    providerLabel: 'local',
    canUseImages: true,
    contextWindowTokens: 100_000,
  })
  const state = reactive({ label: 'main', externalSelection: '' })
  const editor = reactive({ value: '', selectedText: '' })
  const input = reactive({
    value: '',
    clear: vi.fn(() => {
      input.value = ''
    }),
    setValue: vi.fn((text: string) => {
      input.value = text
    }),
    requestFocus: vi.fn(),
  })
  const sendChatMessage = vi.fn(async () => 'answer')
  const loadChat = vi.fn<(id: string) => Promise<Chat | null>>(async () => null)
  let id = 0
  const model = createChatModel({
    sendChatMessage,
    generateChatTitle: async () => '',
    saveChat: vi.fn(),
    renameChat: vi.fn(),
    loadChat,
    navigateTo: vi.fn(),
    notifyError: vi.fn(),
    emptyMessageError: () => 'Empty input',
    chatNotFoundError: () => 'Chat not found',
    messageTooLongError: () => 'Message too long',
    noModelError: () => 'No model',
    createId: () => `chat-${++id}`,
    nowIso: () => '2026-10-11T00:00:00.000Z',
    saveSessionState: vi.fn(),
    getLastChatId: () => null,
    getChatModel: () =>
      selectedModel.value
        ? {
            id: selectedModel.value.id,
            canUseImages: selectedModel.value.canUseImages,
            budgetCharacters: 100_000,
          }
        : null,
  })
  const files = {
    pendingImages: computed(() => model.currentChatParams.value.images || []),
    importing: ref(0),
    async whileOpening<T>(open: () => Promise<T>): Promise<T> {
      return open()
    },
  }
  vi.spyOn(files, 'whileOpening')
  const deps = {
    model,
    files,
    editor,
    input,
    selectedModel: () => selectedModel.value,
    externalSelection: () => state.externalSelection,
    windowLabel: () => state.label,
    openMainChat: vi.fn(async () => {}),
    closeModals: vi.fn(),
    afterRender: vi.fn(async () => {}),
    selectModel: vi.fn(async () => {}),
  }
  return {
    controller: createChatController(deps),
    deps,
    model,
    input,
    editor,
    state,
    selectedModel,
    sendChatMessage,
    loadChat,
  }
}

describe('chat controller', () => {
  it('starts a chat and waits for rendering before focusing input', async () => {
    const { controller, deps, model } = setup()
    const events: string[] = []
    deps.afterRender.mockImplementation(async () => {
      events.push('render')
    })
    deps.input.requestFocus.mockImplementation(() => {
      events.push('focus')
    })
    await controller.startChat({ attachments: [{ text: ' context ' }] })
    expect(model.currentChatParams.value.attachments).toEqual([
      { text: ' context ' },
    ])
    expect(deps.closeModals).toHaveBeenCalledOnce()
    expect(deps.openMainChat).not.toHaveBeenCalled()
    expect(events).toEqual(['render', 'focus'])
  })

  it('hands a quick-window request to the main window without starting locally', async () => {
    const { controller, deps, model, state } = setup()
    state.label = 'quick'
    await controller.startChat({ attachments: [{ text: 'context' }] })
    expect(deps.openMainChat).toHaveBeenCalledWith({ text: 'context' })
    expect(model.currentChatParams.value.id).toBeUndefined()
    expect(deps.input.requestFocus).not.toHaveBeenCalled()
    expect(deps.closeModals).toHaveBeenCalledOnce()
  })

  it('hands inferred selection context to the main window', async () => {
    const { controller, deps, state } = setup()
    state.label = 'quick'
    state.externalSelection = 'selection'
    await controller.attachToChat('selection')
    expect(deps.openMainChat).toHaveBeenCalledWith({
      text: 'selection',
      source: 'selection',
    })
    expect(deps.input.requestFocus).not.toHaveBeenCalled()
  })

  it('infers attachment sources and preserves an explicit source', async () => {
    const { controller, editor, model } = setup()
    editor.value = 'Draft'
    await controller.attachToChat('Draft')
    expect(model.currentChatParams.value.attachments).toEqual([
      { text: 'Draft', source: 'editor-text' },
    ])
    await controller.attachToChat('Another', 'selection')
    expect(model.currentChatParams.value.attachments).toContainEqual({
      text: 'Another',
      source: 'selection',
    })
  })

  it('sends the attachments the user added and nothing from the editor', async () => {
    const { controller, model, input, editor } = setup()
    input.value = ' Question '
    editor.value = 'Draft with a part'
    editor.selectedText = 'a part'
    model.currentChatParams.value.attachments = [{ text: 'pending' }]
    expect(await controller.sendInput()).toBe(true)
    expect(model.messages.value[0]).toMatchObject({
      content: 'Question',
      attachments: [{ text: 'pending' }],
    })
    expect(input.value).toBe('')
  })

  it('leaves an old selection out of a voice question and keeps instances independent', () => {
    const first = setup()
    const second = setup()
    first.editor.selectedText = 'selection'
    second.editor.selectedText = 'selection'
    first.controller.markEditorSelectionStale()
    expect(first.controller.voiceChatContext.value).toBeNull()
    expect(second.controller.voiceChatContext.value).toEqual({
      text: 'selection',
      source: 'editor-selection',
    })
  })

  it.each(['empty', 'generating', 'importing'] as const)(
    'keeps input intact when blocked by %s',
    async (reason) => {
      const { controller, model, input, deps } = setup()
      if (reason !== 'empty') input.value = 'Draft'
      if (reason === 'generating') model.isGenerating.value = true
      if (reason === 'importing') deps.files.importing.value = 1
      expect(await controller.sendInput()).toBe(false)
      expect(input.clear).not.toHaveBeenCalled()
    }
  )

  it('restores input when no model can dispatch the request', async () => {
    const { controller, selectedModel, input } = setup()
    selectedModel.value = null
    input.value = ' Failed question '
    expect(await controller.sendInput()).toBe(false)
    expect(input.value).toBe('Failed question')
  })

  it('does not overwrite a newer draft after a rejected dispatch completes', async () => {
    const { controller, model, input } = setup()
    let resolve!: (text: string) => void
    vi.spyOn(model, 'sendMessage').mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    input.value = 'First question'
    const pending = controller.sendInput()
    input.value = 'New draft'
    resolve('')
    await pending
    expect(input.value).toBe('New draft')
    expect(input.setValue).not.toHaveBeenCalled()
  })

  it('does not restore input into a different conversation', async () => {
    const { controller, model, input } = setup()
    let resolve!: (text: string) => void
    vi.spyOn(model, 'sendMessage').mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    input.value = 'Old question'
    const pending = controller.sendInput()
    await controller.startNewChat()
    resolve('')
    await pending
    expect(input.setValue).not.toHaveBeenCalled()
  })

  it('restores only the latest rejected submission', async () => {
    const { controller, model, input } = setup()
    const resolvers: ((text: string) => void)[] = []
    vi.spyOn(model, 'sendMessage').mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolvers.push(done)
        })
    )
    input.value = 'First'
    const first = controller.sendInput()
    input.value = 'Second'
    const second = controller.sendInput()
    resolvers[0]!('')
    await first
    expect(input.setValue).not.toHaveBeenCalled()
    resolvers[1]!('')
    await second
    expect(input.value).toBe('Second')
  })

  it('does not restore dispatched input when an answer fails later', async () => {
    const { controller, input, sendChatMessage, model } = setup()
    sendChatMessage.mockRejectedValue(new Error('failed'))
    input.value = 'Question'
    expect(await controller.sendInput()).toBe(true)
    await vi.waitFor(() => expect(model.isGenerating.value).toBe(false))
    expect(input.setValue).not.toHaveBeenCalled()
    expect(model.messages.value[0]?.content).toBe('Question')
  })

  it('opens history through the file controller and stales editor selection', async () => {
    const { controller, deps, loadChat, editor } = setup()
    editor.selectedText = 'selection'
    loadChat.mockResolvedValue({
      id: 'stored',
      title: 'Stored',
      lastMessageAt: '2026-10-11',
      messages: [{ role: 'user', content: 'question' }],
    })
    await controller.openChat('stored')
    expect(deps.files.whileOpening).toHaveBeenCalledOnce()
    expect(deps.input.requestFocus).toHaveBeenCalledOnce()
    expect(controller.voiceChatContext.value).toBeNull()
  })

  it('opens the last or a new chat through file lifecycle coordination', async () => {
    const { controller, deps, model } = setup()
    await controller.openLastOrNewChat()
    expect(deps.files.whileOpening).toHaveBeenCalledOnce()
    expect(model.currentChatParams.value.id).toBe('chat-1')
    expect(deps.input.requestFocus).toHaveBeenCalledOnce()
  })

  it('delegates model selection', async () => {
    const { controller, deps } = setup()
    await controller.selectModel('other-model')
    expect(deps.selectModel).toHaveBeenCalledWith('other-model')
  })
})

it('uses the request budget for both the composer and history image eligibility', () => {
  const { deps, model, input, selectedModel } = setup()
  selectedModel.value!.canUseImages = false
  model.messages.value = [
    {
      role: 'user',
      content: 'Old',
      images: [
        {
          id: 'image',
          mediaType: 'image/webp',
          width: 10,
          height: 10,
          size: 100,
        },
      ],
    },
    { role: 'assistant', content: 'Answer' },
  ]
  input.value = 'x'.repeat(101)
  const controller = createChatController({
    ...deps,
    requestBudgetCharacters: () => 100,
  })
  expect(controller.contextBudget.value).toMatchObject({
    budgetCharacters: 100,
    usedCharacters: 101,
    level: 'over',
  })
  expect(controller.imageModelRequired.value).toBe(false)
})
