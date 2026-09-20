import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import DropdownMenu from './DropdownMenu.vue'

describe('DropdownMenu', () => {
  it('toggles menu, renders items and triggers actions', async () => {
    const actionSpy = vi.fn()
    const wrapper = mount(DropdownMenu, {
      props: {
        label: 'Case',
        items: [
          { label: 'UPPERCASE', action: actionSpy },
          { label: 'lowercase', action: vi.fn() },
        ],
      },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.text()).toContain('Case')
    expect(wrapper.find('.absolute').exists()).toBe(false)

    // Open menu
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.absolute').exists()).toBe(true)
    expect(wrapper.text()).toContain('UPPERCASE')
    expect(wrapper.text()).toContain('lowercase')

    // Click an item
    const itemButtons = wrapper.findAll('.absolute button')
    expect(itemButtons).toHaveLength(2)
    await itemButtons[0].trigger('click')

    expect(actionSpy).toHaveBeenCalledTimes(1)
    // Menu closes after selection
    expect(wrapper.find('.absolute').exists()).toBe(false)
  })
})
