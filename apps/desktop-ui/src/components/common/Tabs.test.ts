import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import Tabs from './Tabs.vue'

const tabs = [
  { key: 'one', text: 'One' },
  { key: 'two', text: 'Two' },
]
describe('Tabs', () => {
  it('links tabs and panel and moves focus with arrow keys, Home and End', async () => {
    const wrapper = mount(Tabs, {
      attachTo: document.body,
      props: {
        tabs,
        label: 'Preview',
        modelValue: 'one',
        'onUpdate:modelValue': (value) => {
          void wrapper.setProps({ modelValue: value })
        },
      },
      slots: { panel: 'Content' },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('tabindex')).toBe('0')
    expect(buttons[1].attributes('tabindex')).toBe('-1')
    expect(buttons[0].attributes('aria-controls')).toBe(
      wrapper.get('[role="tabpanel"]').attributes('id')
    )
    ;(buttons[0].element as HTMLElement).focus()
    await buttons[0].trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(document.activeElement).toBe(buttons[1].element)
    expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(
      buttons[1].attributes('id')
    )
    await buttons[1].trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0].element)
    await buttons[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(buttons[1].element)
  })
})
