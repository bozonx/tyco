import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
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
        code: 'Enter',
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

  it('ignores bare Tab so editor indentation is not hijacked', () => {
    const modals = useMenuModalsStore()
    const open = vi.spyOn(modals, 'nextModal')
    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })
    const tabEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      cancelable: true,
    })
    window.dispatchEvent(tabEvent)
    expect(open).not.toHaveBeenCalled()
    expect(tabEvent.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('keeps Ctrl+Enter for actions whatever sends the text', () => {
    useIpcStore().params.userConfig.submitKey = 'ctrlEnter'
    const open = vi.spyOn(useMenuModalsStore(), 'nextModal')
    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })
    const enter = new KeyboardEvent('keydown', {
      code: 'Enter',
      cancelable: true,
    })
    window.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', ctrlKey: true })
    )
    expect(open).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('closes editor on Escape and snapshots draft if text exists', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Unsaved text', 'plain')
    const snapshotSpy = vi.spyOn(editor, 'snapshotDraft')
    const ipc = useIpcStore()
    const callFunctionSpy = vi.spyOn(ipc, 'callFunctionOrNotify')

    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', cancelable: true })
    )
    await flushPromises()

    expect(snapshotSpy).toHaveBeenCalled()
    expect(callFunctionSpy).toHaveBeenCalledWith('closeWindow')
    wrapper.unmount()
  })
})
