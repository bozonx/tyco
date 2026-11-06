import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DESKTOP_EVENTS } from '@tyco/shared'

import { useActionMenuStore } from '../stores/action-menu'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import SelectionView from './SelectionView.vue'

describe('SelectionView', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop(
      {
        mode: 'selectionActions',
        window: { isWindowShown: true, windowProfile: 'sheet' },
        activation: {
          activationId: 3,
          selectedText: 'Selected text',
          actionPageIndex: 0,
        },
      },
      'quick'
    )
    desktop.setUserConfig({
      actionPages: [
        { inputMode: 'selection', slots: {} },
        { inputMode: 'selection', slots: {} },
        { inputMode: 'selection', slots: {} },
      ],
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountView = () =>
    mount(SelectionView, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          ContentPadding: { template: '<div><slot /></div>' },
          InsertMenu: true,
        },
      },
    })

  it('cycles pages on repeated ACTION_PAGE_TURN events and closes any nested modal', async () => {
    const actionMenu = useActionMenuStore()
    const modals = useMenuModalsStore()
    const wrapper = mountView()
    await flushPromises()

    expect(actionMenu.pageIndex).toBe(0)

    modals.nextModal(MenuModals.TRANSLATE, { text: 'Selected text' })
    expect(modals.hasOpenModal).toBe(true)

    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 3,
      pageIndex: 0,
    })
    await flushPromises()
    expect(modals.hasOpenModal).toBe(false)
    expect(actionMenu.pageIndex).toBe(1)

    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 3,
      pageIndex: 0,
    })
    await flushPromises()
    expect(actionMenu.pageIndex).toBe(2)

    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 3,
      pageIndex: 0,
    })
    await flushPromises()
    expect(actionMenu.pageIndex).toBe(0)

    // Another page hotkey jumps directly first, then cycles when pressed again
    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 3,
      pageIndex: 2,
    })
    await flushPromises()
    expect(actionMenu.pageIndex).toBe(2)

    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 3,
      pageIndex: 2,
    })
    await flushPromises()
    expect(actionMenu.pageIndex).toBe(0)

    // Stale activation ids are ignored
    await desktop.emit(DESKTOP_EVENTS.ACTION_PAGE_TURN, {
      activationId: 99,
      pageIndex: 1,
    })
    await flushPromises()
    expect(actionMenu.pageIndex).toBe(0)

    wrapper.unmount()
  })
})
