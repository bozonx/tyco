import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FieldSelect from './FieldSelect.vue'

describe('FieldSelect', () => {
  it('preserves numeric and string IDs and skips disabled options', async () => {
    const wrapper = mount(FieldSelect, {
      props: {
        modelValue: 1,
        options: [
          { id: 1, name: 'Number', group: 'Numeric' },
          { id: 2, name: 'Disabled', group: 'Numeric', disabled: true },
          { id: '1', name: 'String', group: 'Text' },
        ],
      },
      global: { stubs: { Teleport: true } },
    })
    const select = wrapper.get('[role="combobox"]')
    expect(select.text()).toBe('Number')
    await select.trigger('keydown', { key: ' ' })

    const numericGroup = wrapper.get('[role="group"][aria-label="Numeric"]')
    const [numeric, disabled] = numericGroup.findAll('[role="option"]')
    expect(numeric.attributes('aria-selected')).toBe('true')
    expect(disabled.attributes('aria-disabled')).toBe('true')
    await disabled.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await select.trigger('keydown', { key: 'ArrowDown' })
    const string = wrapper.get(
      '[role="group"][aria-label="Text"] [role="option"]'
    )
    expect(select.attributes('aria-activedescendant')).toBe(
      string.attributes('id')
    )
    await select.trigger('keydown', { key: 'Home' })
    await select.trigger('keydown', { key: 'S' })
    expect(select.attributes('aria-activedescendant')).toBe(
      string.attributes('id')
    )
    await select.trigger('keydown', { key: 'Enter' })
    await wrapper.setProps({ modelValue: '1' })
    expect(select.text()).toBe('String')

    await select.trigger('click')
    await wrapper
      .get('[role="group"][aria-label="Numeric"] [role="option"]')
      .trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['1'], [1]])
  })
})
