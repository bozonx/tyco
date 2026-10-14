import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EditorContextMenu from './EditorContextMenu.vue'
import type { EditorMenuItem } from '../../lib/editor/menu-item'

describe('EditorContextMenu.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  const actionFn = vi.fn()

  const items: EditorMenuItem[] = [
    { id: 'cut', label: 'Cut', icon: 'mdi:content-cut', action: actionFn },
    { id: 'copy', label: 'Copy', icon: 'mdi:content-copy', action: actionFn },
    {
      id: 'more',
      label: 'More Actions',
      icon: 'mdi:dots-horizontal',
      children: [
        { id: 'sub-1', label: 'Sub Item 1', action: actionFn },
        { id: 'sub-2', label: 'Sub Item 2', action: actionFn, disabled: true },
      ],
    },
    { id: 'disabled', label: 'Disabled Item', disabled: true },
  ]

  it('renders menu items teleported to body', async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: { Icon: true } },
    })

    await flushPromises()

    const menu = document.body.querySelector('.editor-context-menu')
    expect(menu).not.toBeNull()
    const renderedItems = document.body.querySelectorAll(
      '.editor-context-menu__item'
    )
    expect(renderedItems.length).toBe(4)
    expect(renderedItems[0].textContent).toContain('Cut')
    expect(renderedItems[1].textContent).toContain('Copy')

    wrapper.unmount()
  })

  it('triggers item action on click and emits close', async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: { Icon: true } },
    })

    await flushPromises()

    const firstItem = document.body.querySelector<HTMLButtonElement>(
      '.editor-context-menu__item'
    )!
    firstItem.click()
    await flushPromises()

    expect(actionFn).toHaveBeenCalledOnce()
    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
  })

  it('opens submenu on mouseenter for items with children', async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: { Icon: true } },
    })

    await flushPromises()

    const moreItem =
      document.body.querySelector<HTMLButtonElement>('[data-index="2"]')!
    moreItem.dispatchEvent(new MouseEvent('mouseenter'))
    await flushPromises()

    const menus = document.body.querySelectorAll('.editor-context-menu')
    expect(menus.length).toBe(2) // parent and submenu
    expect(document.body.textContent).toContain('Sub Item 1')

    wrapper.unmount()
  })

  it('closes on Escape key press', async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: { Icon: true } },
    })

    await flushPromises()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    )
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
  })

  it('closes when clicking outside the menu', async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: { Icon: true } },
    })

    await flushPromises()

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
  })
})
