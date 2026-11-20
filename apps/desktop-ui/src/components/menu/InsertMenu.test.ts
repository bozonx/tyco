import { config, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useActionMenuStore } from '../../stores/action-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'
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

  it('uses edited text for actions and restores it after returning', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.INSERT, { text: 'Original' })
    const wrapper = mountMenu({ text: 'Original' })
    await wrapper.get('textarea').setValue('Edited')
    expect(wrapper.findComponent(ShortcutList).props('text')).toBe('Edited')
    menus.nextModal(MenuModals.TRANSLATE, { text: 'Edited' })
    menus.back()
    expect(menus.currentModalParams).toMatchObject({ text: 'Edited' })
    await wrapper.get('textarea').setValue('')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.findComponent(ShortcutList).props('text')).toBe('')
  })

  it('lets the corrected text be edited before acting on it', async () => {
    const wrapper = mountMenu(correctionStep)
    const diff = wrapper.findComponent(Diff)
    expect(diff.props('editable')).toBe(true)
    diff.vm.$emit('update:newText', 'Corrected text, edited')
    await nextTick()
    expect(wrapper.findComponent(ShortcutList).props('text')).toBe(
      'Corrected text, edited'
    )
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
    expect(pageButtons[0].attributes('tabindex')).toBe('-1')
    expect(pageButtons[1].attributes('tabindex')).toBe('-1')
    expect(wrapper.find('.preview-area').exists()).toBe(true)

    const pointerDownEvent = new PointerEvent('pointerdown', {
      pointerType: 'mouse',
      cancelable: true,
    })
    pageButtons[1].element.dispatchEvent(pointerDownEvent)
    expect(pointerDownEvent.defaultPrevented).toBe(true)

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

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(1)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    )
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(0)

    // Shift+Tab wraps around to the last page
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    )
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(actionMenuStore.pageCount - 1)

    // Ctrl+Tab no longer switches pages
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true })
    )
    await wrapper.vm.$nextTick()
    expect(actionMenuStore.pageIndex).toBe(actionMenuStore.pageCount - 1)
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

  it('forwards explicit escMode to layout and shortcut list', () => {
    const wrapper = mountMenu({ text: 'Result', escMode: 'back' })
    expect(wrapper.findComponent(ShortcutList).props('escMode')).toBe('back')
  })

  it('disables text-dependent action buttons with hints when text is too short or empty', () => {
    mocks.editorPage = false
    desktop.setUserConfig({
      actionPages: [
        {
          inputMode: 'selection',
          slots: {
            q: { type: 'standard', actionId: 'correction' },
            w: { type: 'standard', actionId: 'transformationMenu' },
            e: { type: 'standard', actionId: 'stylingMenu' },
            r: { type: 'standard', actionId: 'translationMenu' },
            t: { type: 'standard', actionId: 'chatPromptsMenu' },
          },
        },
      ],
    })
    // 1-char text: too short for correction (needs 10), transformation (needs 2), styling (needs 2), translation (needs 2)
    const wrapperShort = mountMenu({ text: 'x' })
    const listShort = wrapperShort.findComponent(ShortcutList)
    const keysShort = listShort.props('leftLetterKeys') as {
      id?: string
      disabled?: boolean
      hint?: string
    }[]

    const correctionItem = keysShort.find((k) => k?.id === 'correction')
    expect(correctionItem?.disabled).toBe(true)
    expect(correctionItem?.hint).toBe('write.textTooShortForCorrection')

    const transformItem = keysShort.find((k) => k?.id === 'transformationMenu')
    expect(transformItem?.disabled).toBe(true)
    expect(transformItem?.hint).toBe('toast.textTooShortToProcess')

    const stylingItem = keysShort.find((k) => k?.id === 'stylingMenu')
    expect(stylingItem?.disabled).toBe(true)
    expect(stylingItem?.hint).toBe('toast.textTooShortToProcess')

    const translateItem = keysShort.find((k) => k?.id === 'translationMenu')
    expect(translateItem?.disabled).toBe(true)
    expect(translateItem?.hint).toBe('toast.textTooShortToTranslate')

    // chatPromptsMenu does not require text
    const promptsItem = keysShort.find((k) => k?.id === 'chatPromptsMenu')
    expect(promptsItem?.disabled).toBeFalsy()

    wrapperShort.unmount()

    // 2-char text: enough for transformation, styling, translation, but not correction (needs 10)
    const wrapperTwo = mountMenu({ text: 'xy' })
    const listTwo = wrapperTwo.findComponent(ShortcutList)
    const keysTwo = listTwo.props('leftLetterKeys') as {
      id?: string
      disabled?: boolean
      hint?: string
    }[]

    expect(keysTwo.find((k) => k?.id === 'correction')?.disabled).toBe(true)
    expect(
      keysTwo.find((k) => k?.id === 'transformationMenu')?.disabled
    ).toBeFalsy()
    expect(keysTwo.find((k) => k?.id === 'stylingMenu')?.disabled).toBeFalsy()
    expect(
      keysTwo.find((k) => k?.id === 'translationMenu')?.disabled
    ).toBeFalsy()

    wrapperTwo.unmount()
  })

  it('resets action menu page to the first page when mounted with diff or correction result', async () => {
    desktop.setUserConfig({
      actionPages: [
        { inputMode: 'selection', slots: {} },
        { inputMode: 'none', slots: {} },
      ],
    })
    const actionMenu = useActionMenuStore()
    actionMenu.setPage(1)
    expect(actionMenu.pageIndex).toBe(1)

    const wrapper = mountMenu({ text: 'New text', oldText: 'Old text' })
    expect(actionMenu.pageIndex).toBe(0)
    wrapper.unmount()
  })
})

afterEach(() => {
  config.global.plugins = []
  desktop.dispose()
})
