import { config, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorInputStore } from '../../stores/editor-input'
import { useMenuModalsStore } from '../../stores/menu-modals'
import CopyButton from '../common/CopyButton.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import InsertMenu from './InsertMenu.vue'

const mocks = vi.hoisted(() => ({ editorPage: true }))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
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

let desktop: TestDesktop

describe('InsertMenu correction step', () => {
  beforeEach(async () => {
    desktop = installFakeDesktop()
    await desktop.load()
    config.global.plugins = [desktop.pinia]
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

  it('enables insertion without a window ID when the desktop supports focus return', async () => {
    mocks.editorPage = false
    desktop.backend.handle('get_text_insertion_status', () => ({
      keys: 'ready',
      target: 'focusReturn',
      missingClipboardTools: [],
    }))
    await desktop.load()
    expect(desktop.backend.activation.windowId).toBeNull()
    const list = mountMenu({
      text: 'GNOME text',
      insertOnly: true,
    }).findComponent(ShortcutList)
    expect(list.props('spaceKey')?.id).toBe('insertIntoWindow')
    expect(list.props('spaceKey')?.disabled).toBe(false)
  })

  it('uses menu.actions title by default and menu.correction when correction is true', () => {
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

  it('keeps insertIntoWindow as primary space action even when first action slot is different', () => {
    mocks.editorPage = false
    const wrapper = mountMenu({
      text: 'Result text',
      actions: [
        { id: 'copyToClipboard', action: vi.fn() },
        { id: 'insertIntoWindow', action: vi.fn() },
      ],
    })
    const list = wrapper.findComponent(ShortcutList)
    expect(list.props('spaceKey')?.id).toBe('insertIntoWindow')
  })

  it('renders page buttons and switches pages with keys when multiple pages exist', async () => {
    const actionMenuStore = (
      await import('../../stores/action-menu')
    ).useActionMenuStore()
    desktop.setUserConfig({
      actionPages: [
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'copyToClipboard' } },
        },
        {
          inputMode: 'none',
          slots: { q: { type: 'standard', actionId: 'askInChat' } },
        },
      ],
    })
    actionMenuStore.setPage(0)
    const wrapper = mountMenu({ text: 'Selected text' })
    const pageButtons = wrapper.findAll('.action-page-button')
    expect(pageButtons).toHaveLength(2)
    expect(pageButtons[0].classes()).toContain('is-active')
    expect(wrapper.find('.preview-area').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(1)
    expect(wrapper.find('.preview-area').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(0)
    expect(wrapper.find('.preview-area').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(0)
  })

  it('saves text as a snippet when save button is clicked', async () => {
    desktop.setUserConfig({ snippets: { items: [] } })
    const wrapper = mountMenu({ text: 'Sample text to save' })
    const saveBtn = wrapper.find('button[aria-label="action.saveAsSnippet"]')
    expect(saveBtn.exists()).toBe(true)
    await saveBtn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(desktop.backend.userConfig.snippets.items).toEqual([
      { id: 'snippet-1', text: 'Sample text to save' },
    ])
  })

  it('shows warning toast when saving exact duplicate snippet', async () => {
    desktop.setUserConfig({
      snippets: { items: [{ id: 'snippet-1', text: 'Existing text' }] },
    })
    const toast = (await import('../../stores/toast')).useToastStore()
    const toastSpy = vi.spyOn(toast, 'toastKey')

    const wrapper = mountMenu({ text: 'Existing text' })
    const saveBtn = wrapper.find('button[aria-label="action.saveAsSnippet"]')
    await saveBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(toastSpy).toHaveBeenCalledWith('toast.snippetAlreadyExists', 'warn')
    expect(desktop.backend.userConfig.snippets.items).toHaveLength(1)
  })
})

afterEach(() => {
  config.global.plugins = []
  desktop.dispose()
})
