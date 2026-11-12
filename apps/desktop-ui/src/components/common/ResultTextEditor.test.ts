import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ResultTextEditor from './ResultTextEditor.vue'

describe('ResultTextEditor', () => {
  it('keeps typing and shortcuts inside the editor without preventing native input', async () => {
    const onKeydown = vi.fn()
    const wrapper = mount(ResultTextEditor, {
      props: { modelValue: 'Result', label: 'Result' },
      attrs: { onKeydown },
    })
    const textarea = wrapper.get('textarea')
    for (const key of ['Enter', ' ', 'ArrowLeft', 'q']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      })
      textarea.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(onKeydown).not.toHaveBeenCalled()
    await textarea.setValue('Edited\nresult')
    expect(wrapper.emitted('update:modelValue')).toEqual([['Edited\nresult']])
    expect(textarea.attributes('aria-label')).toBe('Result')
    expect(wrapper.find('.highlight').exists()).toBe(false)
  })

  it('renders optional highlights as text outside the editable control', () => {
    const wrapper = mount(ResultTextEditor, {
      props: {
        modelValue: '<b>Result</b>',
        label: 'Result',
        parts: [{ value: '<b>Result</b>', added: true }],
      },
    })
    expect(wrapper.get('.highlight').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.added').text()).toBe('<b>Result</b>')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('<b>Result</b>')
  })
})
