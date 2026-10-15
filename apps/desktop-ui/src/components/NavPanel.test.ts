import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NavPanel from './NavPanel.vue'

const mocks = vi.hoisted(() => ({
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
  navPanelStore: {
    navPanelState: { onEscape: null, escapeButtonLabelKey: '' },
  },
  menuModalsStore: { closeAll: vi.fn() },
}))

vi.mock('vue-router', () => ({ useRoute: () => mocks.currentRoute.value }))

vi.mock('../composables/use-editor-navigation', () => ({
  useEditorNavigation: () => mocks.editorNavigation,
}))

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../lib/navigation/navigation', () => ({
  appNavigation: mocks.appNavigation,
}))

vi.mock('../stores/chat', () => ({ useChatStore: () => mocks.chatStore }))

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanelStore,
}))

vi.mock('../stores/menu-modals', () => ({
  useMenuModalsStore: () => mocks.menuModalsStore,
}))

describe('NavPanel.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentRoute.value = { path: '/chat', query: {} }
    mocks.appNavigation.isCurrent.mockImplementation(
      (path: string) => path === '/chat'
    )
  })

  it('renders editor and ask AI tabs', () => {
    const wrapper = shallowMount(NavPanel)
    expect(wrapper.text()).toContain('nav.editor')
    expect(wrapper.text()).toContain('nav.aiChat')
  })

  it('does not render profile container or divider when profiles prop is empty', () => {
    const wrapper = shallowMount(NavPanel, { props: { profiles: [] } })
    expect(wrapper.find('.topbar-divider').exists()).toBe(false)
    expect(wrapper.find('.profiles-tabs-container').exists()).toBe(false)
  })

  it('renders divider and profile tabs when profiles are provided', async () => {
    const profiles = [
      { id: 'writer', name: 'Writer', icon: 'mdi:feather' },
      { id: 'coder', name: 'Coder' },
    ]
    const wrapper = shallowMount(NavPanel, { props: { profiles } })

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
    const wrapper = shallowMount(NavPanel, {
      props: { profiles: [{ id: 'writer', name: 'Writer' }] },
    })

    const buttons = wrapper.findAll('.topbar-tab')
    // buttons[0] is Editor, buttons[1] is Ask AI, buttons[2] is Writer
    expect(buttons[1].classes()).toContain('is-active')
    expect(buttons[2].classes()).not.toContain('is-active')
  })

  it('marks profile tab as active when query profile matches', () => {
    mocks.appNavigation.currentProfileId.mockReturnValue('writer')
    const wrapper = shallowMount(NavPanel, {
      props: { profiles: [{ id: 'writer', name: 'Writer' }] },
    })

    const buttons = wrapper.findAll('.topbar-tab')
    expect(buttons[1].classes()).not.toContain('is-active')
    expect(buttons[2].classes()).toContain('is-active')
  })

  it('navigates to profile chat when profile tab is clicked', async () => {
    const wrapper = shallowMount(NavPanel, {
      props: { profiles: [{ id: 'writer', name: 'Writer' }] },
    })

    const profileTab = wrapper.find('.profiles-tabs-container button')
    await profileTab.trigger('click')

    expect(mocks.menuModalsStore.closeAll).toHaveBeenCalled()
    expect(mocks.appNavigation.goToProfileChat).toHaveBeenCalledWith('writer')
  })

  it('handles wheel scroll horizontally on profiles container', async () => {
    const wrapper = shallowMount(NavPanel, {
      props: { profiles: [{ id: 'writer', name: 'Writer' }] },
    })

    const container = wrapper.find('.profiles-tabs-container')
    const element = container.element as HTMLElement
    element.scrollLeft = 0

    await container.trigger('wheel', { deltaY: 50, deltaX: 0 })
    expect(element.scrollLeft).toBe(50)
  })
})
