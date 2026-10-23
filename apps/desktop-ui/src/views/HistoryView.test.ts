import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryView from './HistoryView.vue'
import { useHistoryStore } from '../stores/history'
import { useDesktopStore } from '../stores/desktop'

const mockToEditor = vi.fn()
vi.mock('../composables/use-editor-navigation', () => ({
  useEditorNavigation: () => ({ toEditor: mockToEditor }),
}))

const mockCopyText = vi.fn()
vi.mock('../composables/use-copy-text', () => ({
  useCopyText: () => mockCopyText,
}))

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }),
}))

describe('HistoryView.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads editor history on mount and displays items', async () => {
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'loadEditorHistory').mockImplementation(async () => {
      historyStore.editorHistory = [
        {
          id: 'item-1',
          kind: 'source',
          operation: 'correction',
          text: 'Source text',
          result: 'Result text',
          createdAt: Date.now(),
        } as any,
      ]
    })

    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          Icon: true,
          Button: true,
          SearchInput: true,
          HistoryList: {
            props: ['items'],
            template:
              '<div class="history-list-stub"><div v-for="item in items" :key="item.id" class="item">{{ item.value }}</div></div>',
          },
        },
      },
    })

    await flushPromises()

    expect(historyStore.loadEditorHistory).toHaveBeenCalledOnce()
    expect(wrapper.findAll('.item')).toHaveLength(1)
    expect(wrapper.text()).toContain('Result text')
  })

  it('shows error banner when loading history fails and retries on click', async () => {
    const historyStore = useHistoryStore()
    const loadSpy = vi
      .spyOn(historyStore, 'loadEditorHistory')
      .mockRejectedValueOnce(new Error('Load failed'))
      .mockResolvedValueOnce(undefined)

    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          Icon: true,
          SearchInput: true,
          HistoryList: {
            template: '<div class="list-stub"><slot name="notice" /></div>',
          },
          Button: { template: '<button class="btn-stub"><slot /></button>' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('.history-notice.is-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('history.loadFailed')

    const retryBtn = wrapper.find('.history-notice.is-error button')
    await retryBtn.trigger('click')
    await flushPromises()

    expect(loadSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.history-notice.is-error').exists()).toBe(false)
  })

  it('handles item action toEditor and navigates', async () => {
    const historyStore = useHistoryStore()
    historyStore.editorHistory = [
      {
        id: 'item-1',
        kind: 'draft',
        text: 'Source text',
        createdAt: Date.now(),
      } as any,
    ]
    vi.spyOn(historyStore, 'loadEditorHistory').mockResolvedValue()

    let capturedHandler!: (actionId: string, item: any) => void

    mount(HistoryView, {
      global: {
        stubs: {
          Icon: true,
          Button: true,
          SearchInput: true,
          HistoryList: {
            props: ['items'],
            setup(_props, { emit }) {
              capturedHandler = (actionId, item) =>
                emit('action', actionId, item)
              return () => null
            },
          },
        },
      },
    })

    await flushPromises()

    capturedHandler('toEditor', { id: 'item-1', value: 'Saved snippet' })
    expect(mockToEditor).toHaveBeenCalledWith('Saved snippet')
  })

  it('handles copy action on history item', async () => {
    const historyStore = useHistoryStore()
    historyStore.editorHistory = []
    vi.spyOn(historyStore, 'loadEditorHistory').mockResolvedValue()

    let capturedHandler!: (actionId: string, item: any) => void

    mount(HistoryView, {
      global: {
        stubs: {
          Icon: true,
          Button: true,
          SearchInput: true,
          HistoryList: {
            setup(_props, { emit }) {
              capturedHandler = (actionId, item) =>
                emit('action', actionId, item)
              return () => null
            },
          },
        },
      },
    })

    await flushPromises()

    capturedHandler('copy', { id: 'item-1', value: 'Text to copy' })
    expect(mockCopyText).toHaveBeenCalledWith('Text to copy')
  })

  it('shows disabled banner when history is disabled in config', async () => {
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'loadEditorHistory').mockResolvedValue()

    const desktop = useDesktopStore()
    desktop.desktopState.userConfig = {
      ...desktop.desktopState.userConfig,
      editor: { history: { storage: 'off' } },
    } as any

    const wrapper = mount(HistoryView, {
      global: {
        stubs: {
          Icon: true,
          Button: true,
          SearchInput: true,
          HistoryList: {
            template: '<div class="list-stub"><slot name="notice" /></div>',
          },
        },
      },
    })

    await flushPromises()
    expect(wrapper.text()).toContain('history.textsDisabled')
  })
})
