import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ResultViewModeToggle from './ResultViewModeToggle.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('result view mode toggle', () => {
  it('uses the provided label and modes, and ignores an unchanged selection', async () => {
    const wrapper = mount(ResultViewModeToggle, {
      props: { value: 'split', label: 'Review', modes: ['split', 'result'] },
      global: { stubs: { Icon: true } },
    })
    expect(wrapper.get('[role=radiogroup]').attributes('aria-label')).toBe(
      'Review'
    )
    const inputs = wrapper.findAll('input[type=radio]')
    expect(inputs.map((input) => input.attributes('aria-label'))).toEqual([
      'diff.modeSplit',
      'diff.modeResult',
    ])
    await inputs[0].trigger('change')
    expect(wrapper.emitted('update:value')).toBeUndefined()
    await inputs[1].setValue(true)
    expect(wrapper.emitted('update:value')).toEqual([['result']])
    await wrapper.setProps({ value: 'result' })
    expect((inputs[1].element as HTMLInputElement).checked).toBe(true)
  })
})
