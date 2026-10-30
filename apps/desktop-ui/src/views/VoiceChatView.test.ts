import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import VoiceChatView from './VoiceChatView.vue'

const mocks = vi.hoisted(() => ({
  chat: {
    voiceChatContext: { text: 'Selected context', source: 'selection' } as {
      text: string
      source: string
    } | null,
  },
  navPanel: { resetNavPanelState: vi.fn() },
  menuModals: { hasOpenModal: false },
  copyAction: vi.fn(),
}))

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

vi.mock('../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: {
    name: 'VoiceRecognitionMenu',
    props: ['variant', 'finishBehavior', 'context', 'target'],
    emits: ['corrected', 'cancelled', 'removeContext'],
    template: '<div class="voice-menu" />',
  },
}))

vi.mock('../components/menu/InsertMenu.vue', () => ({
  default: {
    name: 'InsertMenu',
    props: ['text', 'oldText', 'allowInsertButton', 'shortcutsDisabled'],
    template: '<div class="insert-menu" />',
  },
}))

vi.mock('../composables/use-voice-finish-signal', () => ({
  useVoiceFinishSignal: () => ({ value: '' }),
}))
vi.mock('../stores/menu-modals', () => ({
  useMenuModalsStore: () => mocks.menuModals,
}))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/chat', () => ({ useChatStore: () => mocks.chat }))
vi.mock('../stores/action-menu', () => ({
  useActionMenuStore: () => ({
    getDefaultActions: () => [
      { id: 'copyToClipboard', action: mocks.copyAction },
    ],
  }),
}))

describe('VoiceChatView', () => {
  let desktop: TestDesktop
  /** What the view sent to the desktop, without the error log */
  const sent = async () => {
    await flushPromises()
    return desktop.backend.calls
      .filter(({ command }) => command !== 'log_client_message')
      .map(({ command, args }) => [command, args])
  }

  afterEach(() => desktop.dispose())

  beforeEach(async () => {
    vi.clearAllMocks()
    desktop = await loadFakeDesktop({
      mode: 'voiceChat',
      activation: { activationId: 1, selectedText: 'Selected context' },
    })
    desktop.backend.handle('open_main_chat', () => undefined)
    desktop.backend.handle('hide_window', () => undefined)
    mocks.chat.voiceChatContext = {
      text: 'Selected context',
      source: 'selection',
    }
  })

  it('shows the context the question goes with', () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    expect(menu.props('target')).toBe('chat')
    expect(menu.props('context')).toBe('Selected context')
  })

  it('sends the question without the context the user removed', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('removeContext')
    await flushPromises()
    expect(menu.props('context')).toBeUndefined()

    menu.vm.$emit('corrected', 'Why?', 'Why?', undefined, 'submit')
    await flushPromises()

    expect(await sent()).toEqual([
      ['open_main_chat', { activationId: 1, question: 'Why?', autoSend: true }],
    ])
  })

  it('submits voice result to main chat with autoSend=true when intent is submit', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit(
      'corrected',
      'How does this work?',
      'How does this work?',
      undefined,
      'submit'
    )
    await flushPromises()

    expect(await sent()).toEqual([
      [
        'open_main_chat',
        {
          activationId: 1,
          attachment: { text: 'Selected context', source: 'selection' },
          question: 'How does this work?',
          autoSend: true,
        },
      ],
    ])
  })

  it('inserts voice result into chat input with autoSend=false when intent is insert', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit(
      'corrected',
      'Explain this function',
      'Explain this function',
      undefined,
      'insert'
    )
    await flushPromises()

    expect(await sent()).toEqual([
      [
        'open_main_chat',
        {
          activationId: 1,
          attachment: { text: 'Selected context', source: 'selection' },
          question: 'Explain this function',
          autoSend: false,
        },
      ],
    ])
  })

  it('opens the actions for the text instead of the chat when intent is next', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('corrected', 'Some text', 'Some text', undefined, 'next')
    await flushPromises()

    expect(
      wrapper.findComponent({ name: 'VoiceRecognitionMenu' }).exists()
    ).toBe(false)
    expect(wrapper.findComponent({ name: 'InsertMenu' }).props('text')).toBe(
      'Some text'
    )
    expect(await sent()).toEqual([])
  })

  it('copies the result via copyToClipboard action when intent is copy', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('corrected', 'Copied text', 'Copied text', undefined, 'copy')
    await flushPromises()

    expect(mocks.copyAction).toHaveBeenCalledWith('Copied text')
    expect(await sent()).toEqual([])
  })

  it('dismisses quick window on cancel', async () => {
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    const menu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    menu.vm.$emit('cancelled')

    expect(await sent()).toEqual([['hide_window', { activationId: 1 }]])
  })

  it('keeps the recognized text in the actions menu when opening chat fails', async () => {
    desktop.backend.handle('open_main_chat', () => {
      throw new FakeDesktopError({ code: 'operationFailed', message: 'Failed' })
    })
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    wrapper
      .findComponent({ name: 'VoiceRecognitionMenu' })
      .vm.$emit(
        'corrected',
        'Keep these words',
        'Keep these words',
        undefined,
        'submit'
      )
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).props('text')).toBe(
      'Keep these words'
    )
    expect((await sent()).map(([command]) => command)).toEqual([
      'open_main_chat',
    ])
    wrapper.unmount()
  })

  it('does not put a failed handoff into a newer activation', async () => {
    let fail!: () => void
    desktop.backend.handle(
      'open_main_chat',
      () =>
        new Promise((_resolve, reject) => {
          fail = () =>
            reject(
              new FakeDesktopError({
                code: 'operationFailed',
                message: 'Failed',
              })
            )
        })
    )
    const wrapper = mount(VoiceChatView, {
      global: { plugins: [desktop.pinia] },
    })
    wrapper
      .findComponent({ name: 'VoiceRecognitionMenu' })
      .vm.$emit('corrected', 'Old words', 'Old words', undefined, 'submit')
    await flushPromises()
    desktop.setState({ activationId: 2 })
    fail()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
    expect((await sent()).map(([command]) => command)).toEqual([
      'open_main_chat',
    ])
    wrapper.unmount()
  })
})
