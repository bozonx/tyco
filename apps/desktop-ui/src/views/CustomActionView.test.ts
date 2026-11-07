import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useActionMenuStore } from '../stores/action-menu'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import CustomActionView from './CustomActionView.vue'

describe('CustomActionView', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop(
      {
        mode: 'customAction',
        window: { isWindowShown: true },
        activation: {
          activationId: 42,
          selectedText: 'Custom selected text',
          customActionIndex: 0,
        },
      },
      'quick'
    )
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountView = () =>
    mount(CustomActionView, { global: { plugins: [desktop.pinia] } })

  it('hides window if slot action is empty', async () => {
    desktop.setUserConfig({
      customActionSlots: [{ action: null, takesSelection: true }],
    })
    const hideWindowSpy = vi.fn().mockResolvedValue(undefined)
    desktop.backend.handle('hide_window', hideWindowSpy)

    mountView()
    await flushPromises()

    expect(hideWindowSpy).toHaveBeenCalled()
  })

  it('executes the configured action and hides window when no modal is opened', async () => {
    desktop.setUserConfig({
      customActionSlots: [
        {
          action: { type: 'standard', actionId: 'copyToClipboard' },
          takesSelection: true,
        },
      ],
    })
    const hideWindowSpy = vi.fn().mockResolvedValue(undefined)
    desktop.backend.handle('hide_window', hideWindowSpy)

    const actionMenu = useActionMenuStore()
    const mockAction = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(actionMenu, 'resolveActionItem').mockReturnValue({
      id: 'copyToClipboard',
      name: 'Copy',
      action: mockAction,
    })

    mountView()
    await flushPromises()

    expect(mockAction).toHaveBeenCalledWith('Custom selected text')
    expect(hideWindowSpy).toHaveBeenCalled()
  })

  it('executes modal action and leaves window open', async () => {
    desktop.setUserConfig({
      customActionSlots: [
        {
          action: { type: 'standard', actionId: 'translationMenu' },
          takesSelection: true,
        },
      ],
    })
    const hideWindowSpy = vi.fn().mockResolvedValue(undefined)
    desktop.backend.handle('hide_window', hideWindowSpy)

    const actionMenu = useActionMenuStore()
    const modals = useMenuModalsStore()
    vi.spyOn(actionMenu, 'resolveActionItem').mockReturnValue({
      id: 'translationMenu',
      name: 'Translate',
      action: vi.fn().mockImplementation(async () => {
        modals.nextModal(MenuModals.TRANSLATE, { text: 'Custom selected text' })
      }),
    })

    mountView()
    await flushPromises()

    expect(modals.hasOpenModal).toBe(true)
    expect(hideWindowSpy).not.toHaveBeenCalled()
  })
})
