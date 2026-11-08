import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryList, { type HistoryListItem } from './HistoryList.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: { value: 'en-US' },
  }),
}))

describe('HistoryList.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleItems: HistoryListItem[] = [
    { id: '1', value: 'First item short text', time: Date.now() - 1000 },
    {
      id: '2',
      value: 'Second item with long content '.repeat(20),
      original: { label: 'Original', text: 'Original text' },
      time: Date.now() - 5000,
    },
  ]

  it('renders empty state when items list is empty', () => {
    const wrapper = mount(HistoryList, {
      props: { items: [], emptyHint: 'No history yet' },
      global: {
        stubs: {
          StateMessage: {
            props: ['title', 'message', 'icon'],
            template:
              '<div class="ui-state-stub"><span class="title">{{ title }}</span><span class="msg">{{ message }}</span></div>',
          },
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.find('.ui-state-stub').exists()).toBe(true)
    expect(wrapper.find('.ui-state-stub .title').text()).toBe('history.empty')
    expect(wrapper.find('.ui-state-stub .msg').text()).toBe('No history yet')
  })

  it('renders grouped items and displays text', () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems },
      global: {
        stubs: {
          StateMessage: true,
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    const items = wrapper.findAll('.history-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('First item short text')
  })

  it('filters items by searchQuery', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, searchQuery: 'Second' },
      global: {
        stubs: {
          StateMessage: true,
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    const items = wrapper.findAll('.history-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-history-id')).toBe('2')
  })

  it('shows nothing found state when query matches nothing', () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, searchQuery: 'non-existent-match' },
      global: {
        stubs: {
          StateMessage: {
            props: ['title'],
            template: '<div class="ui-state-stub">{{ title }}</div>',
          },
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.find('.ui-state-stub').text()).toBe('history.nothingFound')
  })

  it('handles clear confirmation workflow', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, totalCount: 2 },
      global: {
        stubs: {
          Button: { props: ['variant'], template: '<button><slot /></button>' },
          IconButton: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    // Click clear button
    const clearBtn = wrapper.find('.clear-btn')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')

    // Confirm button should appear
    const confirmBtn = wrapper.find('.confirm-clear-btn')
    expect(confirmBtn.exists()).toBe(true)

    await confirmBtn.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('toggles expand for long items', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems },
      global: {
        stubs: {
          Button: true,
          IconButton: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    const longItem = wrapper.find('[data-history-id="2"]')
    const toggleBtn = longItem.find('.history-expand-toggle')
    expect(toggleBtn.exists()).toBe(true)
    expect(toggleBtn.text()).toContain('history.expand')
    expect(toggleBtn.attributes('aria-expanded')).toBe('false')

    await toggleBtn.trigger('click')
    expect(longItem.find('.history-text-value').classes()).toContain('expanded')
    expect(toggleBtn.text()).toContain('history.collapse')
    expect(toggleBtn.attributes('aria-expanded')).toBe('true')
    expect(toggleBtn.attributes('aria-controls')).toBe(
      longItem.get('.history-text-value').attributes('id')
    )
  })

  it('emits action event when action button is clicked', async () => {
    const actions = [
      { id: 'copy', icon: 'mdi:content-copy', title: 'Copy' },
      { id: 'delete', icon: 'mdi:delete', title: 'Delete', danger: true },
    ]

    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, actions },
      global: {
        stubs: {
          IconButton: {
            props: ['title', 'icon'],
            template:
              '<button class="icon-btn-stub" :title="title" @click="$emit(\'click\')"><slot /></button>',
          },
          Button: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    const firstItem = wrapper.find('[data-history-id="1"]')
    const actionButtons = firstItem.findAll('.icon-btn-stub')
    expect(actionButtons.length).toBeGreaterThan(0)

    await actionButtons[0].trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['copy', sampleItems[0]])
  })
})
