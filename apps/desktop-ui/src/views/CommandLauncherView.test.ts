import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import CommandLauncherView from './CommandLauncherView.vue'

const desktopState = reactive({ isWindowShown: true })

const menuModalsState = reactive({ hasOpenModal: false })

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div class="content-padding-stub"><slot /></div>' },
}))

vi.mock('../components/menu/CommandLauncher.vue', () => ({
  default: {
    name: 'CommandLauncher',
    props: ['shortcutsDisabled'],
    template:
      '<div class="command-launcher-stub" :data-disabled="shortcutsDisabled" />',
  },
}))

vi.mock('../stores/ipc', () => ({ useIpcStore: () => ({ desktopState }) }))

vi.mock('../stores/menu-modals', () => ({
  useMenuModalsStore: () => menuModalsState,
}))

describe('CommandLauncherView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopState.isWindowShown = true
    menuModalsState.hasOpenModal = false
  })

  it('enables shortcuts when window is shown and no modal is open', () => {
    const wrapper = mount(CommandLauncherView)
    const launcher = wrapper.findComponent({ name: 'CommandLauncher' })

    expect(launcher.exists()).toBe(true)
    expect(launcher.props('shortcutsDisabled')).toBe(false)
  })

  it('disables shortcuts when a modal is open', async () => {
    const wrapper = mount(CommandLauncherView)
    const launcher = wrapper.findComponent({ name: 'CommandLauncher' })

    menuModalsState.hasOpenModal = true
    await flushPromises()

    expect(launcher.props('shortcutsDisabled')).toBe(true)
  })

  it('disables shortcuts when window is hidden', async () => {
    const wrapper = mount(CommandLauncherView)
    const launcher = wrapper.findComponent({ name: 'CommandLauncher' })

    desktopState.isWindowShown = false
    await flushPromises()

    expect(launcher.props('shortcutsDisabled')).toBe(true)
  })
})
