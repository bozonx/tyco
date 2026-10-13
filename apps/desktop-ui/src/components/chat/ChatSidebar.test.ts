import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatSidebar from './ChatSidebar.vue'

const mocks = vi.hoisted(() => ({
  userConfig: { chatHistoryEnabled: true },
  chatHistory: [] as Array<{
    id: string
    title: string
    lastMessageAt: string
  }>,
  currentChatState: { id: null as string | null, title: '' },
  isGenerating: false,
  messages: [] as any[],
  startNewChat: vi.fn(),
  openChat: vi.fn(),
  clearChats: vi.fn(),
  deleteChat: vi.fn(),
  restoreChatItem: vi.fn(),
  releaseUndo: vi.fn(async () => undefined),
}))

vi.mock('../../lib/chat/chat-image-storage', () => ({
  releaseChatImageUndo: mocks.releaseUndo,
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toast: vi.fn() }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({
    desktopState: { userConfig: reactive(mocks.userConfig) },
  }),
}))

vi.mock('../../stores/chat', () => ({
  useChatStore: () => ({
    isGenerating: mocks.isGenerating,
    currentChatState: mocks.currentChatState,
    messages: mocks.messages,
    startNewChat: mocks.startNewChat,
    openChat: mocks.openChat,
    abandonChat: vi.fn(),
    whenSaved: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../stores/history', () => ({
  useHistoryStore: () => ({
    chatHistory: reactive(mocks.chatHistory),
    searchChats: vi.fn().mockResolvedValue([]),
    clearChats: mocks.clearChats,
    deleteChat: mocks.deleteChat,
    restoreChatItem: mocks.restoreChatItem,
  }),
}))

describe('ChatSidebar.vue', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userConfig.chatHistoryEnabled = true
    mocks.chatHistory.length = 0
    mocks.currentChatState.id = null
    mocks.currentChatState.title = ''
  })

  it('does not display warning banner or disabled hint when history is enabled', () => {
    const wrapper = mount(ChatSidebar, {
      global: {
        stubs: {
          Button: { template: '<button><slot /></button>' },
          Icon: true,
          SearchInput: true,
          DropdownMenu: true,
          ConfirmModal: true,
        },
      },
    })

    expect(wrapper.find('.sidebar-notice').exists()).toBe(false)
    expect(wrapper.find('.history-disabled-hint').exists()).toBe(false)
  })

  it('renders subtle hint under chats when history is disabled, without warning banner', () => {
    mocks.userConfig.chatHistoryEnabled = false

    const wrapper = mount(ChatSidebar, {
      global: {
        stubs: {
          Button: { template: '<button><slot /></button>' },
          Icon: true,
          SearchInput: true,
          DropdownMenu: true,
          ConfirmModal: true,
        },
      },
    })

    // No warning banner
    expect(wrapper.find('.sidebar-notice').exists()).toBe(false)

    // Subtle hint exists in footer under chat list
    const hint = wrapper.find('.sidebar-footer .history-disabled-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('history.chatsDisabled')
  })

  it('hides search input by default and toggles on magnifying glass click', async () => {
    const wrapper = mount(ChatSidebar, {
      global: {
        stubs: {
          Button: {
            props: ['title', 'active'],
            emits: ['click'],
            template:
              '<button :title="title" :data-active="active" @click="$emit(\'click\')"><slot /></button>',
          },
          Icon: true,
          SearchInput: {
            props: ['value'],
            template: '<input class="sidebar-search" :value="value" />',
            methods: { focus: vi.fn() },
          },
          DropdownMenu: true,
          ConfirmModal: true,
        },
      },
    })

    // Hidden initially
    expect(wrapper.find('.sidebar-search').exists()).toBe(false)

    // Click search button
    const searchBtn = wrapper.find('button[title="chat.searchChats"]')
    expect(searchBtn.exists()).toBe(true)
    await searchBtn.trigger('click')
    await flushPromises()

    // Now search input is displayed
    expect(wrapper.find('.sidebar-search').exists()).toBe(true)

    // Click again to close
    await searchBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.sidebar-search').exists()).toBe(false)
  })

  async function deleteImageChat() {
    const item = {
      id: 'image-chat',
      title: 'Image chat',
      lastMessageAt: new Date().toISOString(),
      messages: [],
    }
    mocks.chatHistory.push(item)
    mocks.deleteChat.mockResolvedValueOnce(item)
    const wrapper = mount(ChatSidebar, {
      global: {
        stubs: {
          Button: { template: '<button><slot /></button>' },
          Icon: true,
          SearchInput: true,
          DropdownMenu: {
            name: 'DropdownMenu',
            props: ['items'],
            template: '<span />',
          },
          ConfirmModal: {
            name: 'ConfirmModal',
            props: ['open'],
            emits: ['confirm'],
            template: '<span />',
          },
        },
      },
    })
    const menu = wrapper.findComponent({ name: 'DropdownMenu' })
    const actions = menu.props('items') as Array<{
      label: string
      action: () => void
    }>
    actions.find((action) => action.label === 'chat.deleteChat')!.action()
    await flushPromises()
    wrapper
      .findAllComponents({ name: 'ConfirmModal' })
      .at(-1)!
      .vm.$emit('confirm')
    await flushPromises()
    return wrapper
  }

  it('releases deleted image ownership when the undo window expires', async () => {
    vi.useFakeTimers()
    const wrapper = await deleteImageChat()
    expect(mocks.releaseUndo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8000)
    expect(mocks.releaseUndo).toHaveBeenCalledWith('image-chat')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('keeps deleted images pinned until undo persistence finishes', async () => {
    let finish!: () => void
    mocks.restoreChatItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const wrapper = await deleteImageChat()
    await wrapper.get('.sidebar-notice button').trigger('click')
    expect(mocks.releaseUndo).not.toHaveBeenCalled()
    finish()
    await flushPromises()
    expect(mocks.releaseUndo).toHaveBeenCalledWith('image-chat')
    wrapper.unmount()
  })
  it('keeps undo available after a failed restore and retries without releasing images early', async () => {
    mocks.restoreChatItem.mockRejectedValueOnce(new Error('Unavailable'))
    const wrapper = await deleteImageChat()
    await wrapper.get('.sidebar-notice button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sidebar-notice').exists()).toBe(true)
    expect(mocks.releaseUndo).not.toHaveBeenCalled()
    await wrapper.get('.sidebar-notice button').trigger('click')
    await flushPromises()
    expect(mocks.restoreChatItem).toHaveBeenCalledTimes(2)
    expect(mocks.releaseUndo).toHaveBeenCalledExactlyOnceWith('image-chat')
    expect(wrapper.find('.sidebar-notice').exists()).toBe(false)
    wrapper.unmount()
  })
})
