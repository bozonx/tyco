import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import DiffModeToggle from './DiffModeToggle.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('DiffModeToggle', () => {
  it('highlights the active mode and emits update when clicked', async () => {
    const wrapper = mount(DiffModeToggle, {
      props: { modelValue: 'unified' },
      global: { stubs: { Icon: true } },
    })

    const buttons = wrapper.findAll('input[type=radio]')
    expect(buttons).toHaveLength(3)

    // First button (unified) should be active
    expect((buttons[0].element as HTMLInputElement).checked).toBe(true)
    expect((buttons[1].element as HTMLInputElement).checked).toBe(false)
    expect((buttons[2].element as HTMLInputElement).checked).toBe(false)

    // Click second button (split)
    await buttons[1].setValue(true)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['split'])

    // Click third button (result)
    await buttons[2].setValue(true)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(2)
    expect(wrapper.emitted('update:modelValue')![1]).toEqual(['result'])
  })
})
