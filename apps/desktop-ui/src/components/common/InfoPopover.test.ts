import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import InfoPopover from './InfoPopover.vue'

describe('InfoPopover', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders trigger button and teleports interactive popover to document.body by default', async () => {
    const wrapper = mount(InfoPopover, {
      props: { text: 'Popover content' },
      attachTo: document.body,
      global: { stubs: { Icon: true } },
    })

    const trigger = wrapper.find('.info-tooltip-trigger')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-haspopup')).toBe('dialog')

    await trigger.trigger('click')
    expect(wrapper.find('.info-tooltip-popover').exists()).toBe(false)
    const popover = document.body.querySelector('.info-tooltip-popover')
    expect(popover).not.toBeNull()
    expect(popover?.textContent).toContain('Popover content')
    expect(popover?.getAttribute('role')).toBe('dialog')

    wrapper.unmount()
  })
})
