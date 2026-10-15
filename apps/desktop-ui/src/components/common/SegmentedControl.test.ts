import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'

import FieldRow from './FieldRow.vue'
import SegmentedControl from './SegmentedControl.vue'

const Form = defineComponent({
  components: { FieldRow, SegmentedControl },
  template: `<FieldRow group label="Webhook URL" hint="Choose the request method" disabled required>
    <SegmentedControl label="Request method" model-value="POST" :options="[{ id: 'POST', name: 'POST' }, { id: 'GET', name: 'GET' }]" />
  </FieldRow>`,
})

describe('SegmentedControl', () => {
  it('keeps its own accessible name inside a field and inherits field state', () => {
    const wrapper = mount(Form)
    const group = wrapper.get('[role="radiogroup"]')
    expect(group.attributes('aria-label')).toBe('Request method')
    expect(group.attributes('disabled')).toBeUndefined()
    expect(group.attributes('required')).toBeUndefined()
    expect(group.attributes('aria-disabled')).toBe('true')
    expect(group.attributes('aria-required')).toBe('true')
    expect(group.attributes('aria-labelledby')).toBeUndefined()
    expect(group.attributes('aria-describedby')).toBe(
      wrapper.get('.field-row-hint').attributes('id')
    )
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios[0].attributes('name')).toBe(radios[1].attributes('name'))
    for (const radio of radios) {
      expect(radio.attributes('disabled')).toBeDefined()
      expect(radio.attributes('required')).toBeDefined()
    }
  })
})
