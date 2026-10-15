import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ActionTemplateField from './ActionTemplateField.vue'

import { ACTION_TEXT_PLACEHOLDER as TEXT_PLACEHOLDER } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ActionTemplateField', () => {
  for (const multiline of [false, true]) {
    it(`replaces the focused selection and restores its caret (multiline=${multiline})`, async () => {
      const wrapper = mount(ActionTemplateField, {
        attachTo: document.body,
        props: { modelValue: 'Hello world', multiline },
        attrs: { 'aria-label': 'Template', maxlength: 120 },
      })
      const field = wrapper.get(multiline ? 'textarea' : 'input')
      const element = field.element as HTMLInputElement | HTMLTextAreaElement
      element.focus()
      element.setSelectionRange(6, 11)
      const next = `Hello ${TEXT_PLACEHOLDER}`
      const insertion = wrapper.vm.insert(TEXT_PLACEHOLDER)
      await wrapper.setProps({ modelValue: next })
      await insertion
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([next])
      await wrapper.vm.insert('!')
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([`${next}!`])
      expect(element).toBe(document.activeElement)
      expect(field.attributes('aria-label')).toBe('Template')
      expect(field.attributes('maxlength')).toBe('120')
    })
  }
})
