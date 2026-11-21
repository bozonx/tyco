import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PathDisplay from './PathDisplay.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('PathDisplay.vue', () => {
  it('renders path text and copy button by default', () => {
    const wrapper = mount(PathDisplay, { props: { path: '/home/user/data' } })

    expect(wrapper.get('.path-display-text').text()).toBe('/home/user/data')
    expect(wrapper.find('.path-display-copy-btn').exists()).toBe(true)
    expect(wrapper.find('.path-display-open-btn').exists()).toBe(false)
  })

  it('renders placeholder when path is empty and hides copy button', () => {
    const wrapper = mount(PathDisplay, {
      props: { path: '', placeholder: 'No folder selected' },
    })

    const textEl = wrapper.get('.path-display-text')
    expect(textEl.text()).toBe('No folder selected')
    expect(textEl.classes()).toContain('path-display-placeholder')
    expect(wrapper.find('.path-display-copy-btn').exists()).toBe(false)
  })

  it('shows open button when canOpen is true and emits open event', async () => {
    const wrapper = mount(PathDisplay, {
      props: { path: '/home/user/data', canOpen: true },
    })

    const openBtn = wrapper.get('.path-display-open-btn')
    expect(openBtn.attributes('aria-label')).toBe('settings.storageOpenFolder')
    await openBtn.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('renders custom actions passed via slot', () => {
    const wrapper = mount(PathDisplay, {
      props: { path: '/home/user/data' },
      slots: { actions: '<button class="custom-action">Change</button>' },
    })

    expect(wrapper.find('.custom-action').exists()).toBe(true)
    expect(wrapper.get('.custom-action').text()).toBe('Change')
  })

  it('applies is-wrap class when wrap is true', () => {
    const wrapper = mount(PathDisplay, {
      props: { path: '/home/user/data', wrap: true },
    })

    expect(wrapper.classes()).toContain('is-wrap')
  })
})
