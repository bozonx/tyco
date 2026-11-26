import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { i18n } from '../lib/i18n'
import { useDesktopStore } from '../stores/desktop'
import { useDialogStore } from '../stores/dialog'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import DialogView from './DialogView.vue'

vi.mock('../components/dialog/DialogToolbar.vue', () => ({
  default: {
    name: 'DialogToolbar',
    template: '<div class="dialog-toolbar-mock" />',
  },
}))

describe('DialogView.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        dialog: { ...DEFAULT_USER_CONFIG.dialog, isEnabled: true },
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('renders headphones notice for call source when not yet acknowledged', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        source: 'microphoneAndSystem',
        isHeadphonesNoticeAcknowledged: false,
      },
    })
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const notice = wrapper.find('.dialog-headphones-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(i18n.global.t('dialog.headphonesNotice'))

    const button = notice.find('button')
    await button.trigger('click')
    await flushPromises()

    const desktopStore = useDesktopStore()
    expect(desktopStore.userConfig.dialog.isHeadphonesNoticeAcknowledged).toBe(
      true
    )
    expect(wrapper.find('.dialog-headphones-notice').exists()).toBe(false)
  })

  it('does not render headphones notice when already acknowledged', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        source: 'microphoneAndSystem',
        isHeadphonesNoticeAcknowledged: true,
      },
    })
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.find('.dialog-headphones-notice').exists()).toBe(false)
  })

  it('does not render headphones notice for computer sound source', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        source: 'system',
        isHeadphonesNoticeAcknowledged: false,
      },
    })
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.find('.dialog-headphones-notice').exists()).toBe(false)
  })

  it('renders headphones hint in empty state for call source', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        source: 'microphoneAndSystem',
      },
    })
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const emptyHint = wrapper.find('.dialog-empty-hint')
    expect(emptyHint.exists()).toBe(true)
    expect(emptyHint.text()).toContain(
      i18n.global.t('dialog.emptyHeadphonesHint')
    )
  })

  it('renders content search bar when isSearchOpen is true', async () => {
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.findComponent({ name: 'ContentSearchBar' }).exists()).toBe(
      false
    )

    const dialogStore = useDialogStore()
    dialogStore.openSearch()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ContentSearchBar' }).exists()).toBe(
      true
    )
  })

  it('does not render headphones hint in empty state for computer sound source', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        source: 'system',
      },
    })
    const wrapper = mount(DialogView, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.find('.dialog-empty-hint').exists()).toBe(false)
  })
})
