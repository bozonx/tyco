import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ParallelModeToggle from './ParallelModeToggle.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ParallelModeToggle', () => {
  it('highlights active mode and emits update on click', async () => {
    const wrapper = mount(ParallelModeToggle, {
      props: { modelValue: 'split' },
      global: { stubs: { Icon: true } },
    })

    const buttons = wrapper.findAll('.mode-button')
    expect(buttons).toHaveLength(2)

    // First button (split) should be active
    expect(buttons[0].classes()).toContain('is-active')
    expect(buttons[1].classes()).not.toContain('is-active')

    // Click result button
    await buttons[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['result'])
  })
})
