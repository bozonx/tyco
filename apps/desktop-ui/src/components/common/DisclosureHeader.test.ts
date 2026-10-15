import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DisclosureHeader from './DisclosureHeader.vue'
describe('DisclosureHeader', () => {
  it('links an expanded body and lets the parent control disclosure state', async () => {
    const wrapper = mount(DisclosureHeader, {
      props: {
        title: 'Connection',
        controls: 'connection-body',
        expanded: false,
      },
    })
    expect(wrapper.attributes('aria-expanded')).toBe('false')
    expect(wrapper.attributes('aria-controls')).toBeUndefined()
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.attributes('aria-expanded')).toBe('false')
    await wrapper.setProps({ expanded: true })
    expect(wrapper.attributes('aria-controls')).toBe('connection-body')
  })
})
