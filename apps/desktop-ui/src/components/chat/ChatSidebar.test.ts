import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatSidebar from './ChatSidebar.vue'

const mocks = vi.hoisted(() => ({
  userConfig: { chatHistoryEnabled: true },
  chatHistory: [] as Array<{
    id: string
    description: string
    lastMsgDate: string
  }>,
  newChatParams: { id: null as string | null, title: '' },
  isGenerating: false,
  messages: [] as any[],
  startNewChat: vi.fn(),
  openChat: vi.fn(),
  clearChatHistory: vi.fn(),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/useToast', () => ({
  default: () => ({ toast: vi.fn() }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ params: { userConfig: reactive(mocks.userConfig) } }),
}))

vi.mock('../../stores/chat', () => ({
  useChatStore: () => ({
    isGenerating: mocks.isGenerating,
    newChatParams: mocks.newChatParams,
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
    clearChatHistory: mocks.clearChatHistory,
  }),
}))

describe('ChatSidebar.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userConfig.chatHistoryEnabled = true
    mocks.chatHistory.length = 0
    mocks.newChatParams.id = null
    mocks.newChatParams.title = ''
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
            props: ['modelValue'],
            template: '<input class="sidebar-search" :value="modelValue" />',
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
})
