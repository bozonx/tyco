import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Diff from './Diff.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('Diff', () => {
  it('renders unified diff with added and removed classes', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Старый текст для теста',
        newText: 'Новый текст для теста',
        mode: 'unified',
      },
    })

    expect(wrapper.find('.diff-unified-view').exists()).toBe(true)
    const removed = wrapper.findAll('.removed')
    const added = wrapper.findAll('.added')

    expect(removed.length).toBeGreaterThan(0)
    expect(added.length).toBeGreaterThan(0)
    expect(removed[0].text()).toBe('Старый')
    expect(added[0].text()).toBe('Новый')
  })

  it('renders split diff with original and modified columns', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Исходный текст',
        newText: 'Исправленный текст',
        mode: 'split',
      },
    })

    expect(wrapper.find('.diff-split-view').exists()).toBe(true)
    const columns = wrapper.findAll('.diff-split-column')
    expect(columns).toHaveLength(2)

    // Left pane has removed
    expect(columns[0].find('.removed').exists()).toBe(true)
    expect(columns[0].find('.removed').text()).toBe('Исходный')

    // Right pane has added
    expect(columns[1].find('.added').exists()).toBe(true)
    expect(columns[1].find('.added').text()).toBe('Исправленный')
  })

  it('renders clean result in result mode', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Исходный текст',
        newText: 'Только финальный результат',
        mode: 'result',
      },
    })

    expect(wrapper.find('.diff-result-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('Только финальный результат')
    expect(wrapper.find('.added').exists()).toBe(false)
    expect(wrapper.find('.removed').exists()).toBe(false)
  })

  it('shows no-diff message when texts are identical', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Одинаковый текст',
        newText: 'Одинаковый текст',
        mode: 'unified',
      },
    })

    expect(wrapper.find('.no-diff').exists()).toBe(true)
  })
})
