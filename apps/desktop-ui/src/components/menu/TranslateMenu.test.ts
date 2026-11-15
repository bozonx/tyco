import { translationLanguageIds } from '../../lib/translation/translation-languages'

import { DEFAULT_SESSION_STATE } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHistoryStore } from '../../stores/history'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import TranslateMenu from './TranslateMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }),
}))

const transform = vi.fn()

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

  let desktop: TestDesktop
  const setTargetLanguages = (targetLanguages: Record<string, string>) =>
    desktop.setUserConfig({
      translation: {
        ...desktop.backend.userConfig.translation,
        targetLanguages,
      },
    })
  const setRecentLanguages = (recentTranslateLanguages: string[]) =>
    desktop.setState({
      sessionState: { ...DEFAULT_SESSION_STATE, recentTranslateLanguages },
    })

  afterEach(() => desktop.dispose())

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    transform.mockReset()
    transform.mockResolvedValue(result)
    vi.spyOn(useInvocationsStore(), 'call').mockImplementation(transform)
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    useMenuModalsStore().nextModal(MenuModals.TRANSLATE)
  })

  it('translates into a configured language by its key', async () => {
    setTargetLanguages({ q: 'de-DE' })
    mountMenu()

    await shortcutListProps.leftLetterKeys[0].action()

    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        operationConfig: { language: 'de-DE', sourceLanguage: undefined },
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
        operationConfig: expect.objectContaining({ language: 'de-DE' }),
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
    desktop.setUserConfig({
      translation: {
        ...desktop.backend.userConfig.translation,
        provider: 'google',
      },
    })
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const targetColumn = wrapper.find('[data-field="target"]')
    const optionIds = targetColumn
      .findAll('.translate-option')
      .map((el) => el.attributes('data-option-id'))
    expect(optionIds.sort()).toEqual(
      translationLanguageIds('google', 'target').sort()
    )
    expect(optionIds.length).toBeGreaterThan(100)
  })

  it('translates into any language picked from the full list', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find<HTMLInputElement>('input[data-field="target"]')
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].operationConfig.language).toBe('it')
    await vi.waitFor(() =>
      expect(desktop.backend.callsOf('patch_session_state')).toEqual([
        { patch: { recentTranslateLanguages: ['it'] } },
      ])
    )
  })

  it('takes the source language picked after activating its field', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const sourceInput = wrapper.find<HTMLInputElement>(
      'input[data-field="source"]'
    )
    const targetInput = wrapper.find<HTMLInputElement>(
      'input[data-field="target"]'
    )
    await sourceInput.setValue('polish')
    await sourceInput.trigger('keydown', { key: 'Enter' })
    await targetInput.setValue('ital')
    await targetInput.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        operationConfig: { language: 'it', sourceLanguage: 'pl' },
      })
    )
  })

  it('translates nothing on Enter until a language is typed or chosen', async () => {
    setRecentLanguages(['it-IT'])
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find<HTMLInputElement>('input[data-field="target"]')
    await input.trigger('keydown', { key: 'Enter' })
    expect(transform).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].operationConfig.language).toBe('it-IT')
  })

  it('finds a language by its English name', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find<HTMLInputElement>('input[data-field="target"]')
    await input.setValue('german')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].operationConfig.language).toBe('de')
  })

  it('translates the highlighted language by clicking the Enter hint', async () => {
    setRecentLanguages(['it-IT'])
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const button = wrapper.find('button.shortcut-hint')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper
      .find<HTMLInputElement>('input[data-field="target"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].operationConfig.language).toBe('it-IT')
    wrapper.unmount()
  })

  it('switches active field with Tab key', async () => {
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const targetInput = wrapper.find<HTMLInputElement>(
      'input[data-field="target"]'
    )
    await targetInput.trigger('keydown', { key: 'Tab' })
    expect(wrapper.find('[data-field="source"]').classes()).toContain(
      'is-active'
    )
  })

  it('translates immediately when clicking a target language option', async () => {
    const wrapper = mountMenu()
    await shortcutListProps.spaceKey.action()
    await nextTick()
    const targetOptions = wrapper
      .find('[data-field="target"]')
      .findAll('.translate-option')
    await targetOptions[0].trigger('click')
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
  })

  it('drops late results and stages after cancellation without clearing a new operation', async () => {
    let resolve!: (value: typeof result) => void
    transform.mockReturnValue(
      new Promise<typeof result>((done) => {
        resolve = done
      })
    )
    setTargetLanguages({ q: 'de-DE' })
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
