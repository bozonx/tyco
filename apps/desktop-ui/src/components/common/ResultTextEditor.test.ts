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
    for (const key of ['Enter', ' ', 'ArrowLeft', 'q', 'Tab']) {
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

  it('blurs on Escape and lets Shift+Escape reach the overlay', () => {
    const onKeydown = vi.fn()
    const wrapper = mount(ResultTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'Result', label: 'Result' },
      attrs: { onKeydown },
    })
    const textarea = wrapper.get('textarea').element
    textarea.focus()
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(escape)
    expect(document.activeElement).not.toBe(textarea)
    expect(escape.defaultPrevented).toBe(true)
    expect(onKeydown).not.toHaveBeenCalled()

    textarea.focus()
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        shiftKey: true,
        bubbles: true,
      })
    )
    expect(onKeydown).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(textarea)
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
