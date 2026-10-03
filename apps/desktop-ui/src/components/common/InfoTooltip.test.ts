import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InfoTooltip from './InfoTooltip.vue'

describe('InfoTooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders trigger button with icon and accessible attributes', () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Some helpful text', teleport: false },
      global: { stubs: { Icon: true } },
    })

    const trigger = wrapper.find('.info-tooltip-trigger')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-label')).toBe('Info')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(false)
  })

  it('shows tooltip on mouse enter and hides on mouse leave', async () => {
    vi.useFakeTimers()
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Helpful explanation', teleport: false },
      global: { stubs: { Icon: true } },
    })

    await wrapper.find('.info-tooltip-container').trigger('mouseenter')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(true)
    expect(wrapper.find('.info-tooltip-popover').text()).toContain(
      'Helpful explanation'
    )

    await wrapper.find('.info-tooltip-container').trigger('mouseleave')
    vi.advanceTimersByTime(200)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(false)
    vi.useRealTimers()
  })

  it('pins tooltip open on click and unpins on second click', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Pinned text', teleport: false },
      global: { stubs: { Icon: true } },
    })

    const trigger = wrapper.find('.info-tooltip-trigger')
    await trigger.trigger('click')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(true)
    expect(trigger.attributes('aria-expanded')).toBe('true')

    await trigger.trigger('click')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(false)
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('closes pinned tooltip on Escape key', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Close on esc', teleport: false },
      global: { stubs: { Icon: true } },
    })

    const trigger = wrapper.find('.info-tooltip-trigger')
    await trigger.trigger('click')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(true)

    await trigger.trigger('keydown.escape')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(false)
  })

  it('renders custom slot content', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { teleport: false },
      slots: {
        default: '<span class="custom-content">Multiline<br>Content</span>',
      },
      global: { stubs: { Icon: true } },
    })

    await wrapper.find('.info-tooltip-trigger').trigger('click')
    expect(wrapper.find('.custom-content').exists()).toBe(true)
    expect(wrapper.find('.info-tooltip-popover').text()).toContain('Multiline')
  })

  it('teleports popover to document.body when teleport prop is true', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Teleported content', teleport: true },
      attachTo: document.body,
      global: { stubs: { Icon: true } },
    })

    await wrapper.find('.info-tooltip-trigger').trigger('click')
    const popover = document.body.querySelector('.info-tooltip-popover')
    expect(popover).not.toBeNull()
    expect(popover?.textContent).toContain('Teleported content')

    wrapper.unmount()
  })
})
