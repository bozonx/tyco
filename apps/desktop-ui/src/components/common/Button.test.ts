import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Button from './Button.vue'

describe('Button', () => {
  it('renders slot content, classes, and emits click', async () => {
    const wrapper = mount(Button, {
      props: {
        neutral: true,
        sm: true,
      },
      slots: {
        default: 'Press me',
      },
      global: {
        stubs: {
          Icon: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Press me')
    expect(wrapper.classes()).toContain('btn')
    expect(wrapper.classes()).toContain('btn-neutral')
    expect(wrapper.classes()).toContain('btn-sm')

    await wrapper.trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
