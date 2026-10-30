import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorInputStore } from '../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import EditorView from './EditorView.vue'

describe('Editor actions shortcut', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    desktop.backend.handle('hide_window', () => undefined)
  })

  afterEach(() => desktop.dispose())

  it('does not hide the editor when Escape was handled by its search panel', async () => {
    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })
    const event = new KeyboardEvent('keydown', {
      code: 'Escape',
      cancelable: true,
    })
    event.preventDefault()
    window.dispatchEvent(event)
    await flushPromises()
    expect(desktop.backend.callsOf('hide_window')).toEqual([])
    wrapper.unmount()
  })

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
    expect(useNavPanelStore().navPanelState.escapeButtonLabelKey).toBe(
      'menu.actions'
    )
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
    desktop.setUserConfig({
      editor: { ...desktop.backend.userConfig.editor, submitKey: 'Ctrl+Enter' },
    })
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

  it('closes editor on Escape while keeping unsaved text in memory', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Unsaved text', 'plain')

    const wrapper = mount(EditorView, {
      global: { stubs: { Editor: true, ContentPadding: true } },
    })

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        cancelable: true,
      })
    )
    await flushPromises()

    expect(editor.value).toBe('Unsaved text')
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
    expect(desktop.backend.callsOf('add_editor_history_item')).toEqual([])
    wrapper.unmount()
  })

  it('opens actions with selected editor text when selection exists', () => {
    const editor = useEditorInputStore()
    editor.setValue('Full text', 'plain')
    editor.setSelection('Selected snippet', 0, 16)
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
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', ctrlKey: true })
    )
    expect(open).toHaveBeenCalledWith(MenuModals.INSERT, {
      text: 'Selected snippet',
    })
    wrapper.unmount()
  })
})
