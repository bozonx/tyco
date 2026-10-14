import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Button from './Button.vue'

describe('Button', () => {
  it('renders slot content, classes, and emits click', async () => {
    const wrapper = mount(Button, {
      props: { variant: 'neutral', size: 'sm' },
      slots: { default: 'Press me' },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.text()).toContain('Press me')
    expect(wrapper.classes()).toContain('btn')
    expect(wrapper.classes()).toContain('btn-neutral')
    expect(wrapper.classes()).toContain('btn-sm')

    await wrapper.trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })
  it('defaults to a non-submit button and forwards the native click event', async () => {
    const wrapper = mount(Button, { props: { variant: 'danger', size: 'xs' } })
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toContain('btn-error')
    expect(wrapper.classes()).toContain('btn-xs')
    await wrapper.trigger('click', { shiftKey: true })
    expect(wrapper.emitted('click')?.[0][0]).toBeInstanceOf(MouseEvent)
    expect((wrapper.emitted('click')?.[0][0] as MouseEvent).shiftKey).toBe(true)
  })
  it('blocks actions while loading and preserves the accessible label', async () => {
    const wrapper = mount(Button, {
      props: { loading: true },
      slots: { default: 'Save' },
    })
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).toBe('Save')
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
    await wrapper.setProps({ loading: false })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
