import { flushPromises, mount } from '@vue/test-utils'
import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import ChatView from './ChatView.vue'

const mocks = vi.hoisted(() => ({
  startNewChat: vi.fn(),
  openLastOrNewChat: vi.fn(),
  mediaMatches: false,
  profileId: null as string | null,
  goToEditor: vi.fn(),
  goToChat: vi.fn(),
  goToConfig: vi.fn(),
  aiProfiles: {
    isLoaded: true,
    vaultError: '',
    profiles: [{ id: 'writer', name: 'Writer' }],
    loadAll: vi.fn(),
    getProfile(id: string) {
      return this.profiles.find((profile) => profile.id === id)
    },
  },
}))

function chatFor(profileId: string | null) {
  return reactive({
    profileId,
    isGenerating: false,
    currentChatParams: { id: null as string | null },
    startNewChat: () => mocks.startNewChat(profileId),
    openLastOrNewChat: () => mocks.openLastOrNewChat(profileId),
  })
}
const chatState = chatFor(null)
const profileChatState = chatFor('writer')

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../composables/use-chat-scope', () => ({
  resolveChatScope: (profileId: string | null) => ({
    chat: profileId ? profileChatState : chatState,
    input: {},
  }),
  provideChatScope: vi.fn(),
}))

vi.mock('../stores/ai-profiles', () => ({
  useAiProfilesStore: () => mocks.aiProfiles,
}))

vi.mock('../navigation', () => ({
  appNavigation: {
    currentProfileId: () => mocks.profileId,
    goToEditor: mocks.goToEditor,
    goToChat: mocks.goToChat,
    goToConfig: mocks.goToConfig,
  },
}))

vi.mock('../components/common/AppIcon.vue', () => ({
  default: { name: 'AppIcon', template: '<i />' },
}))

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
  let desktop: TestDesktop
  beforeEach(async () => {
    vi.clearAllMocks()
    desktop = await loadFakeDesktop()
    desktop.setUserConfig({ isInDevelopment: true })
    chatState.isGenerating = false
    mocks.mediaMatches = false
    mocks.profileId = null
    mocks.aiProfiles.profiles = [{ id: 'writer', name: 'Writer' }]
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
  afterEach(() => {
    disposePinia(desktop.pinia)
    desktop.dispose()
  })

  it('hides a profile route outside development mode', () => {
    desktop.setUserConfig({ isInDevelopment: false })
    mocks.profileId = 'writer'
    const wrapper = mount(ChatView)
    expect(wrapper.find('.profile-header').exists()).toBe(false)
    expect(mocks.goToEditor).toHaveBeenCalled()
  })

  it('shows the sidebar and the chat on mount', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

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
    expect(mocks.startNewChat).toHaveBeenCalledWith(null)

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

  it('shows the chat of the profile in the route with its name', async () => {
    mocks.profileId = 'writer'
    const wrapper = mount(ChatView)
    await flushPromises()

    expect(wrapper.find('.profile-header').text()).toContain('Writer')
    expect(mocks.openLastOrNewChat).toHaveBeenCalledWith('writer')

    wrapper.findComponent({ name: 'ChatSidebar' }).vm.$emit('collapse')
    await flushPromises()
    const newChatBtn = wrapper
      .findAllComponents({ name: 'IconButton' })
      .find((btn) => btn.props('icon') === 'mdi:plus')
    await newChatBtn!.trigger('click')
    expect(mocks.startNewChat).toHaveBeenCalledWith('writer')
  })

  it('opens the settings of the shown profile', async () => {
    mocks.profileId = 'writer'
    const wrapper = mount(ChatView)
    await flushPromises()

    const settings = wrapper
      .findAllComponents({ name: 'IconButton' })
      .find((btn) => btn.props('icon') === 'mdi:cog-outline')
    await settings!.trigger('click')

    expect(mocks.goToConfig).toHaveBeenCalledWith('ai-profile:writer')
  })

  it('leaves for "Ask AI" when the profile is gone', async () => {
    mocks.profileId = 'removed'
    mount(ChatView)
    await flushPromises()

    expect(mocks.goToChat).toHaveBeenCalled()
  })

  it('shows no profile header in "Ask AI"', async () => {
    const wrapper = mount(ChatView)
    await flushPromises()

    expect(wrapper.find('.profile-header').exists()).toBe(false)
    expect(mocks.openLastOrNewChat).not.toHaveBeenCalled()
  })
})
