import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InlineNotice from './InlineNotice.vue'

describe('InlineNotice', () => {
  it('keeps passive errors silent and announces feedback only when requested', async () => {
    const wrapper = mount(InlineNotice, {
      props: { kind: 'error', message: 'Failed upload' },
      slots: { default: '<button>Retry</button>' },
    })
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.text()).toContain('Failed upload')
    expect(wrapper.get('button').text()).toBe('Retry')
    await wrapper.setProps({ announcement: 'polite' })
    expect(wrapper.attributes('role')).toBe('status')
    await wrapper.setProps({ announcement: 'assertive' })
    expect(wrapper.attributes('role')).toBe('alert')
  })
})
