import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ChatView from './ChatView.vue'

const mocks = vi.hoisted(() => ({
  navPanel: { resetNavPanelState: vi.fn() },
  history: { loadChatHistory: vi.fn(async () => {}) },
  startNewChat: vi.fn(),
  mediaMatches: false,
}))

const chatState = reactive({
  isGenerating: false,
  startNewChat: () => mocks.startNewChat(),
})

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/history', () => ({ useHistoryStore: () => mocks.history }))

vi.mock('../stores/chat', () => ({ useChatStore: () => chatState }))

vi.mock('../components/chat/AiChat.vue', () => ({
  default: { name: 'AiChat', template: '<div class="ai-chat-stub" />' },
}))

vi.mock('../components/chat/ChatSidebar.vue', () => ({
  default: {
    name: 'ChatSidebar',
    emits: ['collapse', 'navigate'],
    template: '<div class="chat-sidebar-stub" />',
  },
}))

vi.mock('../components/common/IconButton.vue', () => ({
  default: {
    name: 'IconButton',
    props: ['icon', 'title', 'label', 'disabled'],
    emits: ['click'],
    template:
      '<button class="icon-button-stub" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
}))

describe('ChatView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatState.isGenerating = false
    mocks.mediaMatches = false
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: mocks.mediaMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it('resets nav panel and loads chat history on mount', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    expect(mocks.navPanel.resetNavPanelState).toHaveBeenCalledWith({})
    expect(mocks.history.loadChatHistory).toHaveBeenCalledOnce()
    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AiChat' }).exists()).toBe(true)
    expect(wrapper.find('.sidebar-closed-tools').exists()).toBe(false)
  })

  it('collapses sidebar when collapse event is emitted and expands via open button', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    const sidebar = wrapper.findComponent({ name: 'ChatSidebar' })
    sidebar.vm.$emit('collapse')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(false)
    expect(wrapper.find('.sidebar-closed-tools').exists()).toBe(true)

    const buttons = wrapper.findAllComponents({ name: 'IconButton' })
    const openBtn = buttons.find((btn) => btn.props('icon') === 'mdi:dock-left')
    expect(openBtn?.exists()).toBe(true)

    await openBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(true)
    expect(wrapper.find('.sidebar-closed-tools').exists()).toBe(false)
  })

  it('triggers startNewChat and disables the button during generation', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    wrapper.findComponent({ name: 'ChatSidebar' }).vm.$emit('collapse')
    await flushPromises()

    const buttons = wrapper.findAllComponents({ name: 'IconButton' })
    const newChatBtn = buttons.find((btn) => btn.props('icon') === 'mdi:plus')
    expect(newChatBtn?.props('disabled')).toBe(false)

    await newChatBtn!.trigger('click')
    expect(mocks.startNewChat).toHaveBeenCalledOnce()

    chatState.isGenerating = true
    await flushPromises()
    expect(newChatBtn?.props('disabled')).toBe(true)
  })

  it('closes sidebar when clicking the backdrop', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    const backdrop = wrapper.find('button.sidebar-backdrop')
    expect(backdrop.exists()).toBe(true)

    await backdrop.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(false)
  })

  it('closes sidebar on navigate event only when in mobile viewport', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    const sidebar = wrapper.findComponent({ name: 'ChatSidebar' })
    sidebar.vm.$emit('navigate')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(true)

    mocks.mediaMatches = true
    sidebar.vm.$emit('navigate')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ChatSidebar' }).exists()).toBe(false)
  })
})
