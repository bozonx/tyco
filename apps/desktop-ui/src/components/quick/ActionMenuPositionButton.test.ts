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
  it('cycles saved positions with the button and Alt+P', async () => {
    const desktop = await loadFakeDesktop({}, 'quick')
    cleanups.push(() => desktop.dispose())
    desktop.backend.handle('reposition_quick_window', () => undefined)
    const wrapper = mount(ActionMenuPositionButton, {
      global: { plugins: [desktop.pinia, i18n] },
    })
    cleanups.push(() => wrapper.unmount())
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(desktop.backend.userConfig.quickWindow.actionMenuPosition).toBe(
      'right'
    )
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
    await wrapper.get('button').trigger('click')
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
