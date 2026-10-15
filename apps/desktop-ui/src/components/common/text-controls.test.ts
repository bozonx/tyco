import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FieldInput from './FieldInput.vue'
import FieldTextArea from './FieldTextArea.vue'
import IconButton from './IconButton.vue'

describe('text control adapters', () => {
  for (const component of [FieldInput, FieldTextArea]) {
    it(`preserves native attributes, focus and selection for ${component.__name}`, async () => {
      const wrapper = mount(component, {
        attachTo: document.body,
        props: { modelValue: 'Hello world', appearance: 'plain' },
        attrs: { 'aria-label': 'Draft', maxlength: 120 },
      })
      wrapper.vm.focus()
      wrapper.vm.select(2, 5)
      expect(wrapper.vm.isFocused()).toBe(true)
      expect(wrapper.vm.getSelection()).toEqual({ start: 2, end: 5 })
      expect(wrapper.attributes('aria-label')).toBe('Draft')
      expect(wrapper.attributes('maxlength')).toBe('120')
      expect(wrapper.classes()).toContain('is-plain')
      await wrapper.setValue('Edited')
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Edited'])
    })
  }
  it('keeps icon button focus and its accessible name while loading', async () => {
    const wrapper = mount(IconButton, {
      attachTo: document.body,
      props: { label: 'Send', icon: 'mdi:arrow-up' },
    })
    wrapper.vm.focus()
    expect(document.activeElement).toBe(wrapper.element)
    await wrapper.setProps({ loading: true })
    expect(wrapper.attributes('aria-label')).toBe('Send')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.loading')).toHaveLength(1)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
