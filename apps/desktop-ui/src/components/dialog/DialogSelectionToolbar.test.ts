import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDialogStore } from '../../stores/dialog'
import DialogSelectionToolbar from './DialogSelectionToolbar.vue'

describe('DialogSelectionToolbar.vue', () => {
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

  it('renders selection count and triggers actions', async () => {
    const dialog = useDialogStore()
    dialog.selectedTurnIds = ['turn-1', 'turn-2']

    const wrapper = mount(DialogSelectionToolbar, {
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('2 selected')

    const buttons = wrapper.findAll('button')
    // First button is clear (IconButton)
    const clearButton = buttons[0]
    await clearButton.trigger('click')
    expect(dialog.selectedTurnIds).toEqual([])
  })

  it('clears selection on Escape key', async () => {
    const dialog = useDialogStore()
    dialog.selectedTurnIds = ['turn-1']

    const wrapper = mount(DialogSelectionToolbar, {
      global: { plugins: [i18n] },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(dialog.selectedTurnIds).toEqual([])
    wrapper.unmount()
  })
})
