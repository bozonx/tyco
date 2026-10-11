import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import TranslateMenu from './TranslateMenu.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const transform = vi.hoisted(() => vi.fn())
vi.mock('../../stores/invocations', () => ({
  useInvocationsStore: () => ({ transform }),
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
            props: ['text', 'spaceKey', 'leftLetterKeys', 'toEditorVisible'],
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
    vi.spyOn(useIpcStore(), 'patchLocalState').mockResolvedValue({
      success: true,
      result: undefined,
    })
    useMenuModalsStore().nextModal(MenuModals.TRANSLATE)
  })

  it('translates into a configured language by its key', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.userConfig.toTranslateLanguages = ['de_DE']
    mountMenu()

    await shortcutListProps.leftLetterKeys[0].action()

    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: { language: 'de_DE', sourceLanguage: undefined },
      })
    )
  })

  it('translates into the language of the main menu item once', async () => {
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.updateStep(menuModalsStore.currentStepId!, {
      language: 'de_DE',
    })
    mountMenu({ language: 'de_DE' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: expect.objectContaining({ language: 'de_DE' }),
      })
    )
    await vi.waitFor(() =>
      expect(menuModalsStore.currentModal).not.toBe(MenuModals.TRANSLATE)
    )
    // back on the step, the menu waits for a choice
    menuModalsStore.back()
    expect(menuModalsStore.currentModal).toBe(MenuModals.TRANSLATE)
    expect(menuModalsStore.currentModalParams.language).toBeUndefined()
  })

  it('translates into any language picked from the full list', async () => {
    const ipcStore = useIpcStore()
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('it_IT')
    expect(ipcStore.patchLocalState).toHaveBeenCalledWith({
      recentTranslateLanguages: ['it_IT'],
    })
  })

  it('takes the source language picked after Tab', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Tab' })
    await input.setValue('pol')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform).toHaveBeenCalledWith(
      'core.translate',
      'Hello world',
      expect.objectContaining({
        toolConfig: { language: 'it_IT', sourceLanguage: 'pl_PL' },
      })
    )
  })

  it('translates nothing on Enter until a language is typed or chosen', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.localState = { recentTranslateLanguages: ['it_IT'] }
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Enter' })
    expect(transform).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('it_IT')
  })

  it('finds a language by its English name', async () => {
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('german')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    expect(transform.mock.calls[0]![2].toolConfig.language).toBe('de_DE')
  })
  it('drops late results and stages after cancellation without clearing a new operation', async () => {
    let resolve!: (value: typeof result) => void
    transform.mockReturnValue(
      new Promise<typeof result>((done) => {
        resolve = done
      })
    )
    useIpcStore().params.userConfig.toTranslateLanguages = ['de_DE']
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
