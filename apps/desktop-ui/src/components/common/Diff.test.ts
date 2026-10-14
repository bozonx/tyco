import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Diff from './Diff.vue'
import * as diffModel from '../../lib/diff/diff-model'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('Diff', () => {
  it('renders unified diff with added and removed classes', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Old text for testing',
        newText: 'New text for testing',
        mode: 'unified',
      },
    })

    expect(wrapper.find('.diff-unified-view').exists()).toBe(true)
    const removed = wrapper.findAll('.removed')
    const added = wrapper.findAll('.added')

    expect(removed.length).toBeGreaterThan(0)
    expect(added.length).toBeGreaterThan(0)
    expect(removed[0].text()).toBe('Old')
    expect(added[0].text()).toBe('New')
  })

  it('renders split diff with original and modified columns', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Original text',
        newText: 'Corrected text',
        mode: 'split',
      },
    })

    expect(wrapper.find('.diff-split-view').exists()).toBe(true)
    const columns = wrapper.findAll('.split-column')
    expect(columns).toHaveLength(2)

    // Left pane has removed
    expect(columns[0].find('.removed').exists()).toBe(true)
    expect(columns[0].find('.removed').text()).toBe('Original')

    // Right pane has added
    expect(columns[1].find('.added').exists()).toBe(true)
    expect(columns[1].find('.added').text()).toBe('Corrected')
  })

  it('renders clean result in result mode', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Original text',
        newText: 'Only final result',
        mode: 'result',
      },
    })

    expect(wrapper.find('.diff-result-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('Only final result')
    expect(wrapper.find('.added').exists()).toBe(false)
    expect(wrapper.find('.removed').exists()).toBe(false)
  })

  it('shows no-diff message when texts are identical', () => {
    const wrapper = mount(Diff, {
      props: {
        oldText: 'Identical text',
        newText: 'Identical text',
        mode: 'unified',
      },
    })

    expect(wrapper.find('.no-diff').exists()).toBe(true)
  })
  it('skips diff computation in result mode and computes once when switching modes', async () => {
    const compute = vi.spyOn(diffModel, 'computeWordDiff')
    const wrapper = mount(Diff, {
      props: { oldText: 'Old text', newText: 'New text', mode: 'result' },
    })
    expect(compute).not.toHaveBeenCalled()
    await wrapper.setProps({ mode: 'split' })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.removed').text()).toBe('Old')
    expect(wrapper.find('.added').text()).toBe('New')
    wrapper.unmount()
  })
})
