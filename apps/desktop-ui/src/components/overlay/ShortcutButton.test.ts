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
      props: { keys: ['Tab'], variant: 'primary', size: 'sm' },
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

  it('sets tabindex to -1 for tile buttons to keep them out of Tab navigation', () => {
    const tileWrapper = mount(ShortcutButton, {
      props: { keys: ['Q'], tile: true },
      slots: { default: 'Tile action' },
    })
    expect(tileWrapper.find('button').attributes('tabindex')).toBe('-1')

    const regularWrapper = mount(ShortcutButton, {
      props: { keys: ['Space'] },
      slots: { default: 'Normal action' },
    })
    expect(regularWrapper.find('button').attributes('tabindex')).toBeUndefined()
  })

  it('prevents default on mouse pointerdown to avoid retaining focus', async () => {
    const wrapper = mount(ShortcutButton, {
      props: { keys: ['Q'] },
      slots: { default: 'Mouse action' },
    })

    const button = wrapper.find('button')
    const event = new PointerEvent('pointerdown', {
      pointerType: 'mouse',
      cancelable: true,
    })
    button.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    const touchEvent = new PointerEvent('pointerdown', {
      pointerType: 'touch',
      cancelable: true,
    })
    button.element.dispatchEvent(touchEvent)
    expect(touchEvent.defaultPrevented).toBe(false)
  })
})
