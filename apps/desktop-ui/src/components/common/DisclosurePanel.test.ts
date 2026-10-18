import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DisclosurePanel from './DisclosurePanel.vue'

describe('DisclosurePanel.vue', () => {
  it('renders default panel and toggles on header click', async () => {
    const wrapper = mount(DisclosurePanel, {
      props: { title: 'Panel Title', expanded: false },
      slots: { default: '<div class="body-content">Body Content</div>' },
    })

    expect(wrapper.find('.body-content').exists()).toBe(false)

    // In default density without actions, trailing chevron is not rendered
    expect(
      wrapper.find('.disclosure-panel-header > .disclosure-chevron').exists()
    ).toBe(false)

    await wrapper.find('.disclosure-header').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    await wrapper.setProps({ expanded: true })
    expect(wrapper.find('.body-content').exists()).toBe(true)
  })

  it('renders trailing chevron in compact mode or with actions slot', async () => {
    const wrapper = mount(DisclosurePanel, {
      props: { title: 'Compact Panel', density: 'compact', expanded: false },
      slots: { actions: '<button class="action-btn">Action</button>' },
    })

    // Trailing chevron exists in panel header
    const trailingChevron = wrapper.find(
      '.disclosure-panel-header > .disclosure-chevron'
    )
    expect(trailingChevron.exists()).toBe(true)
    expect(trailingChevron.classes()).not.toContain('is-expanded')

    // Chevron inside DisclosureHeader button should be hidden
    expect(
      wrapper.find('.disclosure-header .disclosure-chevron').exists()
    ).toBe(false)

    // Clicking trailing chevron triggers toggle
    await trailingChevron.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    await wrapper.setProps({ expanded: true })
    expect(
      wrapper.find('.disclosure-panel-header > .disclosure-chevron').classes()
    ).toContain('is-expanded')
  })

  it('delegates header clicks to toggle, ignoring interactive elements', async () => {
    const wrapper = mount(DisclosurePanel, {
      props: { title: 'Interactive Test', density: 'compact', expanded: false },
      slots: {
        before: '<button class="drag-handle">Drag</button>',
        actions: `
          <button class="nav-badge">Navigate</button>
          <label class="switch-control"><input type="checkbox" /></label>
          <div class="empty-badge-space">Empty</div>
        `,
      },
    })

    const header = wrapper.find('.disclosure-panel-header')

    // Click on drag handle (button) - should NOT toggle
    await header.find('.drag-handle').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    // Click on nav badge (button) - should NOT toggle
    await header.find('.nav-badge').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    // Click on switch input - should NOT toggle
    await header.find('input[type="checkbox"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    // Click on switch label - should NOT toggle
    await header.find('.switch-control').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    // Click on empty space inside actions slot - SHOULD toggle
    await header.find('.empty-badge-space').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    // Click directly on header container - SHOULD toggle
    await header.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(2)
  })
})
