import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import FieldNumber from './FieldNumber.vue'

const wrappers: ReturnType<typeof mount>[] = []
function setup(props = {}) {
  const wrapper = mount(FieldNumber, { attachTo: document.body, props })
  wrappers.push(wrapper)
  const input = wrapper.get('input')
  const wheel = (deltaY: number, options: WheelEventInit = {}) => {
    const event = new WheelEvent('wheel', {
      deltaY,
      cancelable: true,
      ...options,
    })
    input.element.dispatchEvent(event)
    return event
  }
  return { wrapper, input, wheel }
}

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('FieldNumber', () => {
  it('does not clear a setting when the browser reports malformed input', async () => {
    const { wrapper, input } = setup({ modelValue: 0.5 })
    Object.defineProperty(input.element, 'validity', {
      value: { badInput: true },
    })
    await input.trigger('input')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.emitted('invalid-input')).toHaveLength(1)
  })
  it('requires both focus and hover and releases scrolling on mouse leave', async () => {
    const { wrapper, input, wheel } = setup({ modelValue: 5 })
    await input.trigger('mouseenter')
    expect(wheel(-100).defaultPrevented).toBe(false)
    await input.trigger('mouseleave')
    input.element.focus()
    expect(wheel(-100).defaultPrevented).toBe(false)
    await input.trigger('mouseenter')
    expect(wheel(-100).defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([['6']])
    await input.trigger('mouseleave')
    expect(wheel(-100).defaultPrevented).toBe(false)
    await input.trigger('mouseenter')
    input.element.blur()
    expect(wheel(-100).defaultPrevented).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('steps in both directions without decimal drift and respects bounds', async () => {
    const { wrapper, input, wheel } = setup({
      modelValue: 0.2,
      step: 0.1,
      min: 0,
      max: 0.3,
    })
    input.element.focus()
    await input.trigger('mouseenter')
    wheel(-1)
    wheel(-1)
    wheel(1)
    wheel(1)
    wheel(1)
    wheel(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['0.3'],
      ['0.2'],
      ['0.1'],
      ['0'],
    ])
  })

  it('preserves manual entry and clearing', async () => {
    const { wrapper, input } = setup()
    await input.setValue('42')
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['42'], ['']])
  })

  it('steps an empty field and passes input events to consumers', async () => {
    const { wrapper, input, wheel } = setup({ min: 1, step: 1 })
    input.element.focus()
    await input.trigger('mouseenter')
    wheel(-1)
    expect(wrapper.emitted('update:modelValue')).toEqual([['1']])
    expect(wrapper.emitted('input')).toHaveLength(1)
  })

  it.each([{ disabled: true }, { readonly: true }, { step: 'any' }])(
    'does not step unavailable inputs: %j',
    async (props) => {
      const { wrapper, input, wheel } = setup({ modelValue: 5, ...props })
      input.element.focus()
      await input.trigger('mouseenter')
      expect(wheel(-1).defaultPrevented).toBe(false)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    }
  )

  it('ignores horizontal scrolling and zoom gestures', async () => {
    const { wrapper, input, wheel } = setup({ modelValue: 5 })
    input.element.focus()
    await input.trigger('mouseenter')
    expect(wheel(0, { deltaX: 100 }).defaultPrevented).toBe(false)
    expect(wheel(-1, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
