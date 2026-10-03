import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ShortcutButton from './ShortcutButton.vue'

describe('ShortcutButton', () => {
  it('renders keys, label, and emits click event', async () => {
    const wrapper = mount(ShortcutButton, {
      props: { keys: ['Space', 'Enter'], icon: 'mdi:check' },
      slots: { default: 'Confirm action' },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.text()).toContain('Space')
    expect(wrapper.text()).toContain('Enter')
    expect(wrapper.text()).toContain('Confirm action')
    expect(wrapper.classes()).toContain('shortcut')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('applies primary and sm variant classes', () => {
    const wrapper = mount(ShortcutButton, {
      props: { keys: ['Tab'], primary: true, sm: true },
      slots: { default: 'Tab action' },
    })

    expect(wrapper.classes()).toContain('is-primary')
    expect(wrapper.classes()).toContain('is-sm')
  })

  it('respects disabled state and prevents click emit', async () => {
    const wrapper = mount(ShortcutButton, {
      props: { keys: ['Tab'], disabled: true },
      slots: { default: 'Disabled action' },
    })

    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
