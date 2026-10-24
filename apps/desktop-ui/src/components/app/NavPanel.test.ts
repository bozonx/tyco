import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NavPanel from './NavPanel.vue'

const mocks = vi.hoisted(() => ({
  userConfig: { isInDevelopment: true },
  currentRoute: {
    value: { path: '/chat', query: {} as Record<string, string> },
  },
  appNavigation: {
    isCurrent: vi.fn((path: string) => path === '/chat'),
    currentProfileId: vi.fn<() => string | null>(() => null),
    goToChat: vi.fn(),
    goToProfileChat: vi.fn(),
    goToConfig: vi.fn(),
    goToHistory: vi.fn(),
  },
  editorNavigation: { toEditor: vi.fn() },
  chatStore: { openLastOrNewChat: vi.fn() },
  profileChatStore: { openLastOrNewChat: vi.fn() },
  useProfileChatStore: vi.fn(),
  navPanelStore: {
    navPanelState: { onEscape: null, escapeButtonLabelKey: '' },
  },
  menuModalsStore: { closeAll: vi.fn() },
  aiProfilesStore: {
    profiles: [] as { id: string; name: string }[],
    isLoaded: true,
    loadAll: vi.fn(),
  },
}))

vi.mock('../../stores/desktop', () => ({
  useDesktopStore: () => ({ userConfig: mocks.userConfig }),
}))

vi.mock('vue-router', () => ({ useRoute: () => mocks.currentRoute.value }))

vi.mock('../../composables/use-editor-navigation', () => ({
  useEditorNavigation: () => mocks.editorNavigation,
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../navigation', () => ({ appNavigation: mocks.appNavigation }))

vi.mock('../../stores/chat', () => ({
  useChatStore: () => mocks.chatStore,
  useProfileChatStore: (id: string) => {
    mocks.useProfileChatStore(id)
    return mocks.profileChatStore
  },
}))

vi.mock('../../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanelStore,
}))

vi.mock('../../stores/menu-modals', () => ({
  useMenuModalsStore: () => mocks.menuModalsStore,
}))

vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => mocks.aiProfilesStore,
}))

describe('NavPanel.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userConfig.isInDevelopment = true
    mocks.currentRoute.value = { path: '/chat', query: {} }
    mocks.aiProfilesStore.profiles = []
    mocks.appNavigation.isCurrent.mockImplementation(
      (path: string) => path === '/chat'
    )
  })

  it('hides profile tabs outside development mode', () => {
    mocks.userConfig.isInDevelopment = false
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)
    expect(wrapper.find('.profiles-tabs-container').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('nav.aiChat')
    expect(wrapper.find('[label="nav.history"]').exists()).toBe(false)
  })

  it('renders editor and ask AI tabs', () => {
    const wrapper = shallowMount(NavPanel)
    expect(wrapper.text()).toContain('nav.editor')
    expect(wrapper.text()).toContain('nav.aiChat')
  })

  it('renders divider and profile tabs when profiles are provided', async () => {
    mocks.aiProfilesStore.profiles = [
      { id: 'writer', name: 'Writer' },
      { id: 'coder', name: 'Coder' },
    ]
    const wrapper = shallowMount(NavPanel)

    expect(wrapper.find('.topbar-divider').exists()).toBe(true)
    const container = wrapper.find('.profiles-tabs-container')
    expect(container.exists()).toBe(true)

    const tabs = container.findAll('button')
    expect(tabs.length).toBe(2)
    expect(tabs[0].text()).toContain('Writer')
    expect(tabs[1].text()).toContain('Coder')
  })

  it('marks base chat as active when no profile query is present', () => {
    mocks.appNavigation.currentProfileId.mockReturnValue(null)
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)

    const buttons = wrapper.findAll('.topbar-tab')
    // buttons[0] is Editor, buttons[1] is Ask AI, buttons[2] is Writer
    expect(buttons[1].classes()).toContain('is-active')
    expect(buttons[2].classes()).not.toContain('is-active')
  })

  it('marks profile tab as active when query profile matches', () => {
    mocks.appNavigation.currentProfileId.mockReturnValue('writer')
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)

    const buttons = wrapper.findAll('.topbar-tab')
    expect(buttons[1].classes()).not.toContain('is-active')
    expect(buttons[2].classes()).toContain('is-active')
  })

  it('navigates to profile chat when profile tab is clicked', async () => {
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)

    const profileTab = wrapper.find('.profiles-tabs-container button')
    await profileTab.trigger('click')

    expect(mocks.menuModalsStore.closeAll).toHaveBeenCalled()
    expect(mocks.useProfileChatStore).toHaveBeenCalledWith('writer')
    expect(mocks.profileChatStore.openLastOrNewChat).toHaveBeenCalled()
    expect(mocks.chatStore.openLastOrNewChat).not.toHaveBeenCalled()
  })

  it('opens the "Ask AI" chat from a profile chat', async () => {
    mocks.appNavigation.currentProfileId.mockReturnValue('writer')
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)

    await wrapper.findAll('.topbar-tab')[1].trigger('click')

    expect(mocks.chatStore.openLastOrNewChat).toHaveBeenCalled()
    expect(mocks.profileChatStore.openLastOrNewChat).not.toHaveBeenCalled()
  })

  it('handles wheel scroll horizontally on profiles container', async () => {
    mocks.aiProfilesStore.profiles = [{ id: 'writer', name: 'Writer' }]
    const wrapper = shallowMount(NavPanel)

    const container = wrapper.find('.profiles-tabs-container')
    const element = container.element as HTMLElement
    element.scrollLeft = 0

    await container.trigger('wheel', { deltaY: 50, deltaX: 0 })
    expect(element.scrollLeft).toBe(50)
  })
})
