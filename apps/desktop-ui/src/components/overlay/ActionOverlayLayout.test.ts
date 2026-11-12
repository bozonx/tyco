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
    const wrapper = mountLayout()
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

  it('closes the complete scenario with Shift+Escape', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.TRANSLATE, {})
    mountLayout()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true })
    )
    await flushPromises()
    expect(menus.menuBreadcrumbs).toEqual([])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
  })
})
