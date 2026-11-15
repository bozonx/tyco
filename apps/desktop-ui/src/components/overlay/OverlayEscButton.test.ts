import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OverlayEscButton from './OverlayEscButton.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'common.close' ? 'Close' : key === 'common.back' ? 'Back' : key,
  }),
}))

describe('OverlayEscButton', () => {
  it('renders default close state with Esc key', () => {
    const wrapper = mount(OverlayEscButton)
    expect(wrapper.text()).toContain('Esc')
    expect(wrapper.text()).toContain('Close')
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('renders back mode with arrow icon and back label', () => {
    const wrapper = mount(OverlayEscButton, { props: { mode: 'back' } })
    expect(wrapper.text()).toContain('Esc')
    expect(wrapper.text()).toContain('Back')
    expect(wrapper.find('.overlay-esc-icon').exists()).toBe(true)
  })

  it('allows custom label and title', () => {
    const wrapper = mount(OverlayEscButton, {
      props: { label: 'Custom Exit', title: 'Exit Now' },
    })
    expect(wrapper.text()).toContain('Custom Exit')
    expect(wrapper.attributes('title')).toBe('Exit Now')
  })

  it('emits click on click and close-all on shift-click', async () => {
    const wrapper = mount(OverlayEscButton)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
    expect(wrapper.emitted('close-all')).toBeUndefined()

    await wrapper.trigger('click', { shiftKey: true })
    expect(wrapper.emitted('click')).toHaveLength(2)
    expect(wrapper.emitted('close-all')).toHaveLength(1)
  })
})
