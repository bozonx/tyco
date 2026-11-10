import { config, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorInputStore } from '../../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
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

  it('passes the heard message as context and dictated text as the AI prompt', async () => {
    mocks.editorPage = false
    desktop.setUserConfig({
      actionPages: [
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'quickAiRequest' } },
        },
      ],
    })
    const wrapper = mountMenu({
      text: 'Decline politely',
      replyTo: 'Can you come tomorrow?',
    })
    const list = wrapper.findComponent(ShortcutList)
    const actions = list.props('leftLetterKeys') as {
      id?: string
      action: (text: string) => Promise<void>
    }[]
    const action = actions.find((item) => item?.id === 'quickAiRequest')
    expect(action).toBeDefined()
    await action!.action('Decline politely')
    const modals = useMenuModalsStore()
    expect(modals.currentModal).toBe(MenuModals.QUICK_AI_REQUEST)
    expect(modals.currentModalParams).toMatchObject({
      text: 'Can you come tomorrow?',
      prompt: 'Decline politely',
      inputMode: 'text',
    })
    wrapper.unmount()
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

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true })
    )
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(1)

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        shiftKey: true,
      })
    )
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(0)
  })

  it('saves text as a favorite when save button is clicked', async () => {
    desktop.setUserConfig({ favorites: { items: [] } })
    const wrapper = mountMenu({ text: 'Sample text to save' })
    const saveBtn = wrapper.find('button[aria-label="action.saveAsFavorite"]')
    expect(saveBtn.exists()).toBe(true)
    await saveBtn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(desktop.backend.userConfig.favorites.items).toEqual([
      { id: 'favorite-1', text: 'Sample text to save' },
    ])
  })

  it('does not show a saved state when the config write fails', async () => {
    desktop.backend.handle('save_user_config', () => {
      throw new Error('Disk full')
    })
    const wrapper = mountMenu({ text: 'Sample text to save' })
    await wrapper
      .find('button[aria-label="action.saveAsFavorite"]')
      .trigger('click')
    await flushPromises()
    expect(
      wrapper.find('button[aria-label="action.savedAsFavorite"]').exists()
    ).toBe(false)
    expect(desktop.backend.userConfig.favorites.items).toHaveLength(0)
  })

  it('shows warning toast when saving exact duplicate favorite', async () => {
    desktop.setUserConfig({
      favorites: { items: [{ id: 'favorite-1', text: 'Existing text' }] },
    })
    const toast = (await import('../../stores/toast')).useToastStore()
    const toastSpy = vi.spyOn(toast, 'toastKey')

    const wrapper = mountMenu({ text: 'Existing text' })
    const saveBtn = wrapper.find('button[aria-label="action.saveAsFavorite"]')
    await saveBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(toastSpy).toHaveBeenCalledWith('toast.favoriteAlreadyExists', 'warn')
    expect(desktop.backend.userConfig.favorites.items).toHaveLength(1)
  })

  it('disables context and blocks context-requiring actions on remove context click', async () => {
    const wrapper = mountMenu({ text: 'Some text to transform' })
    const removeBtn = wrapper.find('button[aria-label="action.removeContext"]')
    expect(removeBtn.exists()).toBe(true)

    await removeBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.context-disabled-banner').exists()).toBe(true)
    const shortcutList = wrapper.findComponent(ShortcutList)
    expect(shortcutList.props('text')).toBe('')

    // Restore context
    const restoreBtn = wrapper.find('.context-restore-btn')
    expect(restoreBtn.exists()).toBe(true)
    await restoreBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.context-disabled-banner').exists()).toBe(false)
    expect(wrapper.findComponent(ShortcutList).props('text')).toBe(
      'Some text to transform'
    )
  })
})

afterEach(() => {
  config.global.plugins = []
  desktop.dispose()
})
