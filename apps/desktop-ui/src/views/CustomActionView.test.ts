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
    vi.spyOn(actionMenu, 'runConfiguredAction').mockImplementation(
      async (_config, text) => {
        await mockAction(text)
      }
    )

    mountView()
    await flushPromises()

    expect(mockAction).toHaveBeenCalledWith('Custom selected text')
    expect(hideWindowSpy).toHaveBeenCalled()
  })

  it('does not activate listening when the desktop cannot listen', async () => {
    desktop.setState({ canListen: false })
    desktop.setUserConfig({
      customActionSlots: [
        {
          action: { type: 'standard', actionId: 'listen' },
          takesSelection: false,
        },
      ],
    })
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('show_desktop_notification', () => undefined)

    mountView()
    await flushPromises()

    expect(desktop.backend.callsOf('activate_mode')).toEqual([])
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
    expect(desktop.backend.callsOf('show_desktop_notification')).toEqual([
      { summary: 'TyCo', body: expect.stringContaining('PipeWire') },
    ])
  })

  it('opens the editor from a custom slot without exporting selected text', async () => {
    desktop.setUserConfig({
      customActionSlots: [
        {
          action: { type: 'standard', actionId: 'openEditor' },
          takesSelection: false,
        },
      ],
    })
    desktop.backend.handle('activate_mode', () => {
      desktop.setState({ mode: 'editor', activationId: 43 })
    })
    desktop.backend.handle('hide_window', () => undefined)
    mountView()
    await flushPromises()
    expect(desktop.backend.callsOf('activate_mode')).toEqual([
      { mode: 'editor' },
    ])
    expect(desktop.backend.callsOf('hide_window')).toEqual([])
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
    vi.spyOn(actionMenu, 'runConfiguredAction').mockImplementation(
      async (_config, text) => {
        modals.nextModal(MenuModals.TRANSLATE, { text })
      }
    )

    mountView()
    await flushPromises()

    expect(modals.hasOpenModal).toBe(true)
    expect(hideWindowSpy).not.toHaveBeenCalled()
  })

  it('executes actionPage action and leaves window open', async () => {
    desktop.setUserConfig({
      customActionSlots: [
        { action: { type: 'actionPage', pageIndex: 1 }, takesSelection: true },
      ],
    })
    const hideWindowSpy = vi.fn().mockResolvedValue(undefined)
    desktop.backend.handle('hide_window', hideWindowSpy)

    const actionMenu = useActionMenuStore()
    const mockAction = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(actionMenu, 'runConfiguredAction').mockImplementation(
      async (_config, text) => {
        await mockAction(text)
      }
    )

    mountView()
    await flushPromises()

    expect(mockAction).toHaveBeenCalledWith('Custom selected text')
    expect(hideWindowSpy).not.toHaveBeenCalled()
  })

  it('waits for delayed selection capture when takesSelection is true', async () => {
    desktop.setState({ selectedText: null, revision: 1 })
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
    vi.spyOn(actionMenu, 'runConfiguredAction').mockImplementation(
      async (_config, text) => {
        await mockAction(text)
      }
    )

    mountView()
    await flushPromises()

    expect(mockAction).not.toHaveBeenCalled()

    // Simulate background capture completing and emitting state
    desktop.setState({ selectedText: 'Late arrived selection', revision: 2 })
    await flushPromises()

    expect(mockAction).toHaveBeenCalledWith('Late arrived selection')
    expect(hideWindowSpy).toHaveBeenCalled()
  })

  it('leaves window open when action switches to quick-window mode', async () => {
    desktop.setUserConfig({
      customActionSlots: [
        {
          action: { type: 'standard', actionId: 'voiceInput' },
          takesSelection: false,
        },
      ],
    })
    const hideWindowSpy = vi.fn().mockResolvedValue(undefined)
    desktop.backend.handle('hide_window', hideWindowSpy)

    const actionMenu = useActionMenuStore()
    const mockAction = vi.fn().mockImplementation(async () => {
      desktop.setState({ mode: 'voice' })
    })
    vi.spyOn(actionMenu, 'runConfiguredAction').mockImplementation(
      async (_config, text) => {
        await mockAction(text)
      }
    )

    mountView()
    await flushPromises()

    expect(mockAction).toHaveBeenCalled()
    expect(hideWindowSpy).not.toHaveBeenCalled()
  })
})
