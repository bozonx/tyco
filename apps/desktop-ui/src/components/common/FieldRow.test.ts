import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FieldRow from './FieldRow.vue'

describe('FieldRow.vue', () => {
  it('renders simple label without info tooltip', () => {
    const wrapper = mount(FieldRow, { props: { label: 'Simple Setting' } })

    expect(wrapper.find('.field-row-title').text()).toBe('Simple Setting')
    expect(wrapper.find('.field-row-last-word').exists()).toBe(false)
  })

  it('binds the last word of multi-word label together with InfoTooltip', () => {
    const wrapper = mount(FieldRow, {
      props: { label: 'Keep editor history', info: 'Some explanation text' },
      global: { stubs: { Icon: true } },
    })

    const lastWordEl = wrapper.find('.field-row-last-word')
    expect(lastWordEl.exists()).toBe(true)
    expect(lastWordEl.text()).toContain('history')
    expect(lastWordEl.find('.info-tooltip-container').exists()).toBe(true)

    // Full label text preserves all words
    expect(wrapper.find('.field-row-title').text()).toContain(
      'Keep editor history'
    )
  })

  it('binds single-word label with InfoTooltip inside field-row-last-word', () => {
    const wrapper = mount(FieldRow, {
      props: { label: 'Theme', info: 'Appearance theme' },
      global: { stubs: { Icon: true } },
    })

    const lastWordEl = wrapper.find('.field-row-last-word')
    expect(lastWordEl.exists()).toBe(true)
    expect(lastWordEl.text()).toContain('Theme')
    expect(lastWordEl.find('.info-tooltip-container').exists()).toBe(true)
  })

  it('applies nested class when nested prop is true', () => {
    const wrapper = mount(FieldRow, {
      props: { label: 'Nested setting', nested: true },
    })

    expect(wrapper.classes()).toContain('nested')
  })

  it('applies vertical class when vertical prop is true', () => {
    const wrapper = mount(FieldRow, {
      props: { label: 'Vertical setting', vertical: true },
    })

    expect(wrapper.classes()).toContain('vertical')
  })

  it('renders hint text and control slot', () => {
    const wrapper = mount(FieldRow, {
      props: { label: 'Setting', hint: 'Helpful hint' },
      slots: { default: '<input class="test-input" />' },
    })

    expect(wrapper.find('.field-row-hint').text()).toBe('Helpful hint')
    expect(wrapper.find('.test-input').exists()).toBe(true)
  })
})
