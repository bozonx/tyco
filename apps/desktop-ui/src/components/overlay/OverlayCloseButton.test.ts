import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OverlayCloseButton from './OverlayCloseButton.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'common.close'
        ? 'Close'
        : key === 'common.closeAllHint'
          ? 'Close All'
          : key,
  }),
}))

describe('OverlayCloseButton', () => {
  it('renders close icon button with proper title and label', () => {
    const wrapper = mount(OverlayCloseButton)
    expect(wrapper.find('button').attributes('title')).toBe('Close All')
    expect(wrapper.find('button').attributes('aria-label')).toBe('Close')
  })

  it('emits click on button click', async () => {
    const wrapper = mount(OverlayCloseButton)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
