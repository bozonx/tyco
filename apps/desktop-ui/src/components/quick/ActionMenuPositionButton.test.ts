import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../lib/i18n'
import { loadFakeDesktop } from '../../test/install-fake-desktop'
import ActionMenuPositionButton from './ActionMenuPositionButton.vue'

const cleanups: (() => void)[] = []
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
)

describe('ActionMenuPositionButton', () => {
  it('selects saved positions from the dropdown and cycles with Alt+P', async () => {
    const desktop = await loadFakeDesktop({}, 'quick')
    cleanups.push(() => desktop.dispose())
    desktop.backend.handle('reposition_quick_window', () => undefined)
    const wrapper = mount(ActionMenuPositionButton, {
      global: { plugins: [desktop.pinia, i18n] },
      attachTo: document.body,
    })
    cleanups.push(() => wrapper.unmount())

    // Opens dropdown on button click
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const itemButtons = document.body.querySelectorAll('.dropdown-panel button')
    expect(itemButtons).toHaveLength(3)
    // Select 'right' (2nd option)
    ;(itemButtons[1] as HTMLButtonElement).click()
    await flushPromises()
    expect(desktop.backend.userConfig.quickWindow.actionMenuPosition).toBe(
      'right'
    )

    // Alt+P shortcut cycles to bottomRight
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyP',
        altKey: true,
        cancelable: true,
      })
    )
    await flushPromises()
    expect(desktop.backend.userConfig.quickWindow.actionMenuPosition).toBe(
      'bottomRight'
    )

    // Open dropdown again and select center (1st option)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const updatedButtons = document.body.querySelectorAll(
      '.dropdown-panel button'
    )
    ;(updatedButtons[0] as HTMLButtonElement).click()
    await flushPromises()
    expect(desktop.backend.userConfig.quickWindow.actionMenuPosition).toBe(
      'center'
    )
    expect(
      desktop.backend.calls.filter(
        (call) => call.command === 'reposition_quick_window'
      )
    ).toHaveLength(3)
  })
})
