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
          : key === 'common.closeOrEscapeHint'
            ? 'Close or Escape'
            : key,
  }),
}))

describe('OverlayCloseButton', () => {
  it('renders close icon button with closeOrEscape title by default', () => {
    const wrapper = mount(OverlayCloseButton)
    expect(wrapper.find('button').attributes('title')).toBe('Close or Escape')
    expect(wrapper.find('button').attributes('aria-label')).toBe('Close')
  })

  it('renders closeAll title when hasBack is true', () => {
    const wrapper = mount(OverlayCloseButton, { props: { hasBack: true } })
    expect(wrapper.find('button').attributes('title')).toBe('Close All')
  })

  it('emits click on button click', async () => {
    const wrapper = mount(OverlayCloseButton)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
