import QueryPanel from './QueryPanel.vue'
import { translationLanguageIds } from '../../lib/translation/translation-languages'

import { DEFAULT_SESSION_STATE } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHistoryStore } from '../../stores/history'
import { useDesktopStore } from '../../stores/desktop'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import TranslateMenu from './TranslateMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }),
}))

const transform = vi.hoisted(() => vi.fn())
vi.mock('../../stores/invocations', () => ({
  useInvocationsStore: () => ({ call: transform }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

const result = {
  ok: true,
  content: 'Hallo Welt',
  meta: { provider: 'llm', kind: 'llm', quality: {} },
}

describe('TranslateMenu', () => {
  let shortcutListProps: Record<string, any> = {}

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(TranslateMenu, {
      props: { text: 'Hello world', ...props },
      global: {
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template: `<div><slot name="preview" /><slot name="actions" /></div>`,
          },
          ShortcutList: {
            props: [
              'text',
              'spaceKey',
              'leftLetterKeys',
              'isEditorButtonVisible',
            ],
            setup(props: any) {
              shortcutListProps = props
              return () => null
            },
          },
        },
      },
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    transform.mockReset()
    transform.mockResolvedValue(result)
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    vi.spyOn(useDesktopStore(), 'patchSessionState').mockResolvedValue({
      success: true,
      result: useDesktopStore().desktopState.sessionState,
    })
    useMenuModalsStore().nextModal(MenuModals.TRANSLATE)
  })

  it('translates into a configured language by its key', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.translation.targetLanguages = { q: 'de-DE' }
    mountMenu()

    await shortcutListProps.leftLetterKeys[0].action()

    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: { language: 'de-DE', sourceLanguage: undefined },
      })
    )
  })

  it('translates into the language of the main menu item once', async () => {
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.updateStep(
      menuModalsStore.currentStepId!,
      MenuModals.TRANSLATE,
      { language: 'de-DE' }
    )
    mountMenu({ language: 'de-DE' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: expect.objectContaining({ language: 'de-DE' }),
      })
    )
    await vi.waitFor(() =>
      expect(menuModalsStore.currentModal).not.toBe(MenuModals.TRANSLATE)
    )
    // back on the step, the menu waits for a choice
    menuModalsStore.back()
    expect(menuModalsStore.currentModal).toBe(MenuModals.TRANSLATE)
    expect(menuModalsStore.currentModalParams).toHaveProperty(
      'language',
      undefined
    )
  })

  it('offers the whole provider catalog without requiring a search', async () => {
    useDesktopStore().desktopState.userConfig.translation.provider = 'google'
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const options = wrapper.findComponent(QueryPanel).props('options')!
    expect(options.map((option) => option.id).sort()).toEqual(
      translationLanguageIds('google', 'target').sort()
    )
    expect(options.length).toBeGreaterThan(100)
  })

  it('translates into any language picked from the full list', async () => {
    const desktop = useDesktopStore()
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('it')
    expect(desktop.patchSessionState).toHaveBeenCalledWith({
      recentTranslateLanguages: ['it'],
    })
  })

  it('takes the source language picked after activating its field', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await wrapper.find('.language-field').trigger('click')
    await input.setValue('polish')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: { language: 'it', sourceLanguage: 'pl' },
      })
    )
  })

  it('translates nothing on Enter until a language is typed or chosen', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.sessionState = {
      ...DEFAULT_SESSION_STATE,
      recentTranslateLanguages: ['it-IT'],
    }
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Enter' })
    expect(transform).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('it-IT')
  })

  it('finds a language by its English name', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('german')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('de')
  })

  it('translates the highlighted language by clicking the Enter hint', async () => {
    useDesktopStore().desktopState.sessionState = {
      ...DEFAULT_SESSION_STATE,
      recentTranslateLanguages: ['it-IT'],
    }
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const button = wrapper.find('button.shortcut-hint')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('it-IT')
    wrapper.unmount()
  })
  it('drops late results and stages after cancellation without clearing a new operation', async () => {
    let resolve!: (value: typeof result) => void
    transform.mockReturnValue(
      new Promise<typeof result>((done) => {
        resolve = done
      })
    )
    useDesktopStore().desktopState.userConfig.translation.targetLanguages = {
      q: 'de-DE',
    }
    const wrapper = mountMenu()
    const pending = shortcutListProps.leftLetterKeys[0].action()
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    const options = transform.mock.calls[0]![2]
    const menu = useMenuModalsStore()
    menu.cancelPending()
    expect(options.signal.aborted).toBe(true)
    menu.setPendingModal({ label: 'New operation' })
    options.onProgress('repairing')
    resolve(result)
    await pending
    expect(useHistoryStore().saveSourceResult).not.toHaveBeenCalled()
    expect(menu.currentModal).toBe(MenuModals.TRANSLATE)
    expect(menu.pendingModal).toEqual({ label: 'New operation' })
    wrapper.unmount()
  })
})
