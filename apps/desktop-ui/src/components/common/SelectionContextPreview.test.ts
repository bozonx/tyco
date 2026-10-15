import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SelectionContextPreview from './SelectionContextPreview.vue'

describe('SelectionContextPreview', () => {
  it('renders title, text preview, and emits remove on close button click', async () => {
    const wrapper = mount(SelectionContextPreview, {
      props: {
        text: 'Selected sample text',
        title: 'Context title',
        removeTitle: 'Dismiss',
      },
    })

    expect(wrapper.text()).toContain('Context title')
    expect(wrapper.text()).toContain('Selected sample text')

    const button = wrapper.findComponent({ name: 'IconButton' })
    expect(button.exists()).toBe(true)
    await button.trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
