import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ActionOverlayLayout from './ActionOverlayLayout.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ActionOverlayLayout navigation', () => {
  let desktop: TestDesktop
  beforeEach(async () => {
    desktop = await loadFakeDesktop({ mode: 'quickInput' }, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
  })
  afterEach(() => desktop.dispose())
  const mountLayout = () =>
    mount(ActionOverlayLayout, {
      props: { title: 'Translate' },
      global: { plugins: [desktop.pinia] },
    })

  it('offers close and other actions at a directly opened picker', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.TRANSLATE, { text: 'Source' })
    const wrapper = mount(ActionOverlayLayout, {
      props: { otherActionsText: 'Source' },
      global: { plugins: [desktop.pinia] },
    })
    // at the root only the close cross remains; Escape also closes
    expect(wrapper.find('.action-overlay-esc').exists()).toBe(false)
    expect(wrapper.find('.action-overlay-close').exists()).toBe(true)
    const other = wrapper
      .findAll('button')
      .find((button) => button.text().includes('menu.otherActions'))!
    await other.trigger('click')
    expect(menus.menuBreadcrumbs).toEqual([MenuModals.INSERT])
    expect(menus.currentModalParams).toMatchObject({ text: 'Source' })
    menus.back()
    expect(menus.currentModal).toBe(MenuModals.NONE)
  })

  it.each([MenuModals.NONE, MenuModals.INSERT, MenuModals.TRANSLATE])(
    'does not infer other actions from the shared stack (%s)',
    (modal) => {
      const menus = useMenuModalsStore()
      if (modal === MenuModals.INSERT)
        menus.nextModal(MenuModals.INSERT, { text: 'Source' })
      if (modal === MenuModals.TRANSLATE)
        menus.nextModal(MenuModals.TRANSLATE, { text: 'Source' })
      const wrapper = mountLayout()
      expect(wrapper.text()).not.toContain('menu.otherActions')
      wrapper.unmount()
    }
  )

  it('never offers other actions on the root action menu', () => {
    useMenuModalsStore().nextModal(MenuModals.INSERT, { text: 'Source' })
    const wrapper = mount(ActionOverlayLayout, {
      props: { otherActionsText: 'Source' },
      global: { plugins: [desktop.pinia] },
    })
    expect(wrapper.text()).not.toContain('menu.otherActions')
    expect(wrapper.find('.action-overlay-esc').exists()).toBe(false)
    expect(wrapper.find('.action-overlay-close').exists()).toBe(true)
    wrapper.unmount()
  })

  it('goes back from a step over the selection action menu', async () => {
    desktop.setState({ mode: 'selectionActions' })
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.VOICE_COMMANDS, { text: '' })
    const wrapper = mount(ActionOverlayLayout, {
      props: { otherActionsText: 'Source' },
      global: { plugins: [desktop.pinia] },
    })
    // a step, not the root: Back and the cross, no scenario switch
    expect(wrapper.get('.action-overlay-esc').text()).toContain('common.back')
    expect(wrapper.find('.action-overlay-close').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('menu.otherActions')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menus.currentModal).toBe(MenuModals.NONE)
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(0)
    wrapper.unmount()
  })

  it('makes the action menu opened by other actions the root', async () => {
    desktop.setState({ mode: 'translation' })
    const menus = useMenuModalsStore()
    menus.startScenario(MenuModals.INSERT, { text: 'Source' })
    const wrapper = mountLayout()
    expect(wrapper.find('.action-overlay-esc').exists()).toBe(false)
    expect(wrapper.find('.action-overlay-close').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
    wrapper.unmount()
  })

  it('closes at the root with one visible Escape action', async () => {
    const wrapper = mountLayout()
    expect(wrapper.find('.action-overlay-esc').exists()).toBe(false)
    expect(wrapper.find('.action-overlay-close').exists()).toBe(true)
    await wrapper.get('.action-overlay-close').trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
  })

  it('keeps only Back at the editor root: the window frame closes it', async () => {
    desktop.dispose()
    desktop = await loadFakeDesktop({ mode: 'editor' }, 'main')
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, { text: 'Editor draft' })
    const wrapper = mountLayout()
    expect(wrapper.get('.action-overlay-esc').text()).toContain('common.back')
    expect(wrapper.find('.action-overlay-close').exists()).toBe(false)
    await wrapper.get('.action-overlay-esc').trigger('click')
    expect(menus.menuBreadcrumbs).toEqual([])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(0)
    wrapper.unmount()
  })

  it('switches a directly rendered quick surface to root actions', async () => {
    const menus = useMenuModalsStore()
    const wrapper = mount(ActionOverlayLayout, {
      props: { title: 'Translate', otherActionsText: 'Selection' },
      global: { plugins: [desktop.pinia] },
    })
    const other = wrapper
      .findAll('button')
      .find((button) => button.text().includes('menu.otherActions'))!
    await other.trigger('click')
    expect(menus.menuBreadcrumbs).toEqual([MenuModals.INSERT])
    expect(menus.currentModalParams).toMatchObject({ text: 'Selection' })
  })

  it('returns to the previous step and keeps a separate close button', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, { text: 'Source' })
    menus.nextModal(MenuModals.TRANSLATE, { text: 'Source' })
    const wrapper = mountLayout()
    expect(wrapper.text()).not.toContain('menu.otherActions')
    await wrapper.get('.action-overlay-esc').trigger('click')
    expect(menus.currentModal).toBe(MenuModals.INSERT)
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(0)
  })

  it('closes the complete scenario with the cross', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, {})
    menus.nextModal(MenuModals.TRANSLATE, {})
    const wrapper = mountLayout()
    await wrapper.get('.action-overlay-close').trigger('click')
    await flushPromises()
    expect(menus.menuBreadcrumbs).toEqual([])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
  })

  it('closes the complete scenario with the close cross', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.TRANSLATE, {})
    const wrapper = mountLayout()
    expect(wrapper.get('.action-overlay-close').attributes('title')).toBe(
      'common.closeAllHint'
    )
    await wrapper.get('.action-overlay-close').trigger('click')
    await flushPromises()
    expect(menus.menuBreadcrumbs).toEqual([])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
  })
})

describe('ActionOverlayLayout over the editor', () => {
  let desktop: TestDesktop
  beforeEach(async () => {
    desktop = await loadFakeDesktop({ mode: 'editor' }, 'main')
    desktop.backend.handle('hide_window', () => undefined)
  })
  afterEach(() => desktop.dispose())

  it('returns to the editor from its action menu', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, { text: 'Text' })
    const wrapper = mount(ActionOverlayLayout, {
      global: { plugins: [desktop.pinia] },
    })
    expect(wrapper.get('.action-overlay-esc').text()).toContain('common.back')
    expect(wrapper.find('.action-overlay-close').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menus.currentModal).toBe(MenuModals.NONE)
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(0)
    wrapper.unmount()
  })

  it('goes back from a step of the action menu', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, { text: 'Text' })
    menus.nextModal(MenuModals.TRANSLATE, { text: 'Text' })
    const wrapper = mount(ActionOverlayLayout, {
      global: { plugins: [desktop.pinia] },
    })
    expect(wrapper.get('.action-overlay-esc').text()).toContain('common.back')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menus.menuBreadcrumbs).toEqual([MenuModals.INSERT])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(0)
    wrapper.unmount()
  })
})
