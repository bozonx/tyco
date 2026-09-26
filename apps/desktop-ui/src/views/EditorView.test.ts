import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import EditorView from './EditorView.vue'

describe('Editor actions shortcut', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens actions with editor text and ignores repeats and open modals', () => {
    const editor = useEditorInputStore()
    editor.setValue('Editor text', 'plain')
    const modals = useMenuModalsStore()
    const open = vi.spyOn(modals, 'nextModal')
    const wrapper = mount(EditorView, {
      global: {
        stubs: {
          Editor: true,
          ContentPadding: { template: '<div><slot /></div>' },
        },
      },
    })
    const press = (repeat = false) => {
      const event = new KeyboardEvent('keydown', {
        code: 'KeyS',
        ctrlKey: true,
        repeat,
        cancelable: true,
      })
      window.dispatchEvent(event)
      return event
    }
    press(true)
    expect(open).not.toHaveBeenCalled()
    expect(press().defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith(MenuModals.INSERT, {
      text: 'Editor text',
    })
    press()
    expect(open).toHaveBeenCalledTimes(1)
    modals.closeAll()
    wrapper.unmount()
    press()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('follows the shared shortcut setting', () => {
    useIpcStore().params.userConfig.quickInputHotkeys = { next: 'Alt+S' }
    const open = vi.spyOn(useMenuModalsStore(), 'nextModal')
    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyS', ctrlKey: true })
    )
    expect(open).not.toHaveBeenCalled()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyS', altKey: true })
    )
    expect(open).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
