import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import ContentSearchBar from './ContentSearchBar.vue'

describe('ContentSearchBar', () => {
  it('renders input and emits update:modelValue on input', async () => {
    const wrapper = mount(ContentSearchBar, {
      global: { plugins: [i18n] },
      props: { modelValue: '', count: 0, activeIndex: -1 },
    })

    const input = wrapper.find('input')
    await input.setValue('query text')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['query text'])
  })

  it('displays match count when query is entered', () => {
    const wrapper = mount(ContentSearchBar, {
      global: { plugins: [i18n] },
      props: { modelValue: 'hello', count: 5, activeIndex: 1 },
    })

    const count = wrapper.find('.search-bar-count')
    expect(count.exists()).toBe(true)
    expect(count.text()).toContain('2 of 5')
  })

  it('emits next and prev events on enter and shift+enter', async () => {
    const wrapper = mount(ContentSearchBar, {
      global: { plugins: [i18n] },
      props: { modelValue: 'hello', count: 2, activeIndex: 0 },
    })

    const input = wrapper.find('input')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('next')).toHaveLength(1)

    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('prev')).toHaveLength(1)
  })

  it('emits close on Escape', async () => {
    const wrapper = mount(ContentSearchBar, {
      global: { plugins: [i18n] },
      props: { modelValue: 'hello', count: 2, activeIndex: 0 },
    })

    const input = wrapper.find('input')
    await input.trigger('keydown.esc')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
