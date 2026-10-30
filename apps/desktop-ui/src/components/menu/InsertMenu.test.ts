import { config, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDesktopStore } from '../../stores/desktop'
import { useEditorInputStore } from '../../stores/editor-input'
import { useMenuModalsStore } from '../../stores/menu-modals'
import CopyButton from '../common/CopyButton.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import InsertMenu from './InsertMenu.vue'

const mocks = vi.hoisted(() => ({ editorPage: true }))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

vi.mock('../../navigation', () => ({
  appNavigation: { isCurrent: () => mocks.editorPage, goToEditor: vi.fn() },
}))

const mountMenu = (props: Record<string, unknown>) =>
  mount(InsertMenu, {
    props,
    global: {
      stubs: {
        Icon: true,
        ShortcutList: true,
        Diff: true,
        TextPreview: true,
        ActionOverlayLayout: {
          props: ['title'],
          template:
            '<div data-testid="layout" :data-title="title"><slot name="header-extra" /><slot name="preview" /><slot name="actions" /></div>',
        },
      },
    },
  })

const correctionStep = {
  correction: true,
  text: 'Corrected text',
  oldText: 'Original text',
  originalText: 'Original text',
  isEditorButtonVisible: true,
}

describe('InsertMenu correction step', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    config.global.plugins = [pinia]
    localStorage.clear()
    mocks.editorPage = true
  })

  it('over the editor, only puts the correction back in place', async () => {
    const editor = useEditorInputStore()
    editor.setValue('Before Original text after', 'plain')
    editor.setSelection('Original text', 7, 20)
    const closeAll = vi.spyOn(useMenuModalsStore(), 'closeAll')
    const wrapper = mountMenu(correctionStep)
    const list = wrapper.findComponent(ShortcutList)

    expect(list.props('leftLetterKeys')).toEqual([])
    expect(list.props('isEditorButtonVisible')).toBe(false)
    const space = list.props('spaceKey')
    expect(space?.id).toBe('applyToEditor')

    await space?.action('Corrected text')
    expect(editor.value).toBe('Before Corrected text after')
    expect(closeAll).toHaveBeenCalled()
  })

  it('elsewhere, keeps inserting into the window', () => {
    mocks.editorPage = false
    const list = mountMenu(correctionStep).findComponent(ShortcutList)

    expect(list.props('spaceKey')?.id).not.toBe('applyToEditor')
    expect(list.props('isEditorButtonVisible')).toBe(true)
  })

  it('enables insertion without a window ID when the desktop supports focus return', () => {
    mocks.editorPage = false
    const desktop = useDesktopStore()
    vi.spyOn(desktop, 'canInsertIntoWindow', 'get').mockReturnValue(true)
    expect(desktop.desktopState.windowId).toBeNull()
    const list = mountMenu({
      text: 'GNOME text',
      insertOnly: true,
    }).findComponent(ShortcutList)
    expect(list.props('spaceKey')?.id).toBe('insertIntoWindow')
    expect(list.props('spaceKey')?.disabled).toBe(false)
  })

  it('uses menu.actions title by default and menu.correction when isCorrecting', () => {
    const defaultWrapper = mountMenu({ text: 'Some text' })
    expect(
      defaultWrapper.find('[data-testid="layout"]').attributes('data-title')
    ).toBe('menu.actions')

    const correctionWrapper = mountMenu(correctionStep)
    expect(
      correctionWrapper.find('[data-testid="layout"]').attributes('data-title')
    ).toBe('menu.correction')
  })

  it('renders a copy button for the result when text is present', () => {
    const wrapper = mountMenu({ text: 'Result to copy' })
    const copyButton = wrapper.findComponent(CopyButton)
    expect(copyButton.exists()).toBe(true)
    expect(copyButton.props('value')).toBe('Result to copy')
  })

  it('hides the copy button while correcting', () => {
    const wrapper = mountMenu({ text: 'In progress', isCorrecting: true })
    const copyButton = wrapper.findComponent(CopyButton)
    expect(copyButton.exists()).toBe(false)
  })

  it('switches to original text and updates actions when diff mode is original', async () => {
    const wrapper = mountMenu({ text: 'Result text', oldText: 'Original text' })
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('text')).toBe('Result text')
    expect(list.props('sourceText')).toBe('Original text')
    expect(list.props('editorButtonLabel')).toBe('shortcuts.insertIntoEditor')

    const toggle = wrapper.findComponent({ name: 'ResultViewModeToggle' })
    toggle.vm.$emit('update:modelValue', 'original')
    await wrapper.vm.$nextTick()

    expect(list.props('text')).toBe('Original text')
    expect(list.props('sourceText')).toBe('')
    expect(list.props('editorButtonLabel')).toBe('history.originalToEditor')

    const copyButton = wrapper.findComponent(CopyButton)
    expect(copyButton.props('value')).toBe('Original text')
  })
})

afterEach(() => {
  config.global.plugins = []
})
