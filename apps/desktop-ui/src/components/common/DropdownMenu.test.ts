import { flushPromises, mount } from '@vue/test-utils'
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
      global: { stubs: { Icon: true, Teleport: true } },
    })

    expect(wrapper.text()).toContain('Case')
    expect(wrapper.find('.dropdown-panel').exists()).toBe(false)

    // Open menu
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.dropdown-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('UPPERCASE')
    expect(wrapper.text()).toContain('lowercase')

    // Click an item
    const itemButtons = wrapper.findAll('.dropdown-panel button')
    expect(itemButtons).toHaveLength(2)
    await itemButtons[0].trigger('click')

    expect(actionSpy).toHaveBeenCalledTimes(1)
    // Menu closes after selection
    expect(wrapper.find('.dropdown-panel').exists()).toBe(false)
  })

  it('supports square, xs, placement and align props', async () => {
    const wrapper = mount(DropdownMenu, {
      props: {
        icon: 'mdi:robot-outline',
        square: true,
        size: 'xs',
        hideChevron: true,
        placement: 'top',
        align: 'right',
        items: [{ label: 'Item 1', action: vi.fn() }],
      },
      global: { stubs: { Icon: true, Teleport: true } },
    })

    const trigger = wrapper.find('button')
    expect(trigger.classes()).toContain('btn-xs')
    expect(trigger.classes()).toContain('btn-square')

    await trigger.trigger('click')
    await flushPromises()
    const panel = wrapper.find('.dropdown-panel')
    expect(panel.attributes('style')).toContain('position: fixed')
  })
  it('opens from the keyboard, navigates items, and restores focus on Escape', async () => {
    const wrapper = mount(DropdownMenu, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
      props: {
        label: 'Actions',
        items: [
          { label: 'First', action: vi.fn() },
          { label: 'Last', action: vi.fn() },
        ],
      },
    })
    const trigger = wrapper.get('button')
    ;(trigger.element as HTMLElement).focus()
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const items = wrapper.findAll('[role="menuitem"]')
    expect(document.activeElement).toBe(items[0].element)
    await items[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(items[1].element)
    await items[1].trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0].element)
    await items[0].trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })
  it('closes when focus moves outside the popover', async () => {
    const wrapper = mount(DropdownMenu, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
      props: { label: 'Actions', items: [{ label: 'First', action: vi.fn() }] },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(outside)
  })
})
