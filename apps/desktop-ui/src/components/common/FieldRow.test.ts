import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'

import FieldInput from './FieldInput.vue'
import FieldRow from './FieldRow.vue'
import FieldCheckbox from './FieldCheckbox.vue'

const Form = defineComponent({
  components: { FieldRow, FieldInput, FieldCheckbox },
  props: { hint: String, error: String, disabled: Boolean },
  template: `<FieldRow label="Setting" :hint="hint" :error="error" :disabled="disabled" required>
    <FieldInput value="Text" />
    <FieldCheckbox :value="false" />
  </FieldRow>`,
})

describe('FieldRow', () => {
  it('links the label, hint, error and state to each control, including wrapped controls', async () => {
    const wrapper = mount(Form, {
      props: { hint: 'Helpful hint', error: 'Invalid value', disabled: true },
    })
    await wrapper.vm.$nextTick()
    const label = wrapper.get('label[id]')
    const inputs = wrapper.findAll('input')
    expect(label.attributes('for')).toBe(inputs[0].attributes('id'))
    expect(inputs[0].attributes('id')).not.toBe(inputs[1].attributes('id'))
    for (const input of inputs) {
      expect(input.attributes('aria-labelledby')).toBe(label.attributes('id'))
      expect(input.attributes('aria-describedby')).toBe(
        `${wrapper.get('.field-row-hint').attributes('id')} ${wrapper.get('.field-row-error').attributes('id')}`
      )
      expect(input.attributes('aria-invalid')).toBe('true')
      expect(input.attributes('disabled')).toBeDefined()
      expect(input.attributes('required')).toBeDefined()
    }
    await wrapper.setProps({
      hint: undefined,
      error: undefined,
      disabled: false,
    })
    expect(inputs[0].attributes('aria-describedby')).toBeUndefined()
    expect(inputs[0].attributes('aria-invalid')).toBeUndefined()
    expect(inputs[0].attributes('disabled')).toBeUndefined()
  })
  it('preserves explicit accessible names and native attributes on a wrapped control', () => {
    const wrapper = mount(FieldCheckbox, {
      props: { value: true },
      attrs: { 'aria-label': 'Enabled', disabled: true },
    })
    expect(wrapper.get('input').attributes('aria-label')).toBe('Enabled')
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('label').attributes('disabled')).toBeUndefined()
  })
  it('renders optional tooltip outside the native label and supports layout variants', () => {
    const wrapper = mount(FieldRow, {
      props: {
        label: 'Setting',
        info: 'Explanation',
        vertical: true,
        nested: true,
      },
    })
    expect(wrapper.get('label').text()).toBe('Setting')
    expect(wrapper.get('label').find('button').exists()).toBe(false)
    expect(wrapper.find('.info-tooltip-trigger').exists()).toBe(true)
    expect(wrapper.classes()).toContain('vertical')
    expect(wrapper.classes()).toContain('nested')
  })
})
