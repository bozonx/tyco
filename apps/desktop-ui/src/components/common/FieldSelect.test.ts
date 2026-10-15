import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FieldSelect from './FieldSelect.vue'

describe('FieldSelect', () => {
  it('preserves option identity when numeric and string IDs serialize to the same DOM value', async () => {
    const wrapper = mount(FieldSelect, {
      props: {
        modelValue: 1,
        options: [
          { id: 1, name: 'Number', group: 'Numeric' },
          { id: '1', name: 'String', group: 'Text' },
        ],
      },
    })
    const select = wrapper.element as HTMLSelectElement
    expect(select.selectedIndex).toBe(0)
    await wrapper.setProps({ modelValue: '1' })
    expect(select.selectedIndex).toBe(1)
    select.selectedIndex = 0
    await wrapper.trigger('change')
    select.selectedIndex = 1
    await wrapper.trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[1], ['1']])
  })
})
