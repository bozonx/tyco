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

const translateTo = vi.hoisted(() => vi.fn())
vi.mock('../../composables/useCallAi', () => ({
  useCallAi: () => ({ translateTo }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

const result = { text: 'Hallo Welt', provider: 'llm', kind: 'llm', quality: {} }

describe('TranslateMenu', () => {
  let shortcutListProps: Record<string, any> = {}

  const mountMenu = () =>
    mount(TranslateMenu, {
      props: { text: 'Hello world' },
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
    translateTo.mockReset()
    translateTo.mockResolvedValue(result)
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

    expect(translateTo).toHaveBeenCalledWith(
      'de_DE',
      'Hello world',
      expect.objectContaining({ sourceLanguage: undefined })
    )
  })

  it('translates into any language picked from the full list', async () => {
    const ipcStore = useIpcStore()
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('ital')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(translateTo).toHaveBeenCalled())
    expect(translateTo.mock.calls[0]![0]).toBe('it_IT')
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

    await vi.waitFor(() => expect(translateTo).toHaveBeenCalled())
    expect(translateTo).toHaveBeenCalledWith(
      'it_IT',
      'Hello world',
      expect.objectContaining({ sourceLanguage: 'pl_PL' })
    )
  })

  it('remembers the source language and swaps it with the target', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.localState = { translateSourceLanguage: 'pl_PL' }
    ipcStore.params.userConfig.toTranslateLanguages = ['de_DE']
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 's', code: 'KeyS', altKey: true })
    expect(ipcStore.patchLocalState).toHaveBeenCalledWith({
      translateSourceLanguage: 'de_DE',
    })

    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(translateTo).toHaveBeenCalled())
    expect(translateTo).toHaveBeenCalledWith(
      'pl_PL',
      'Hello world',
      expect.objectContaining({ sourceLanguage: 'de_DE' })
    )
  })

  it('stores auto-detect as no source language', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.localState = { translateSourceLanguage: 'pl_PL' }
    const wrapper = mountMenu()

    await shortcutListProps.spaceKey.action()
    await nextTick()
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Tab' })
    await input.setValue('auto')
    await input.trigger('keydown', { key: 'Enter' })

    expect(ipcStore.patchLocalState).toHaveBeenCalledWith({
      translateSourceLanguage: null,
    })
  })
})
