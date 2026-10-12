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
        value: 'one',
        'onUpdate:value': (value) => {
          void wrapper.setProps({ value })
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
  it('uses ordinary buttons for navigation without advertising tab semantics', () => {
    const wrapper = mount(Tabs, {
      props: {
        tabs,
        label: 'Settings',
        kind: 'navigation',
        value: 'two',
        variant: 'vertical',
      },
    })
    expect(wrapper.get('[role="navigation"]').attributes('aria-label')).toBe(
      'Settings'
    )
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
    expect(wrapper.findAll('button')[1].attributes('aria-current')).toBe('page')
    expect(
      wrapper
        .findAll('button')
        .every((button) => button.attributes('tabindex') === '0')
    ).toBe(true)
  })
})
