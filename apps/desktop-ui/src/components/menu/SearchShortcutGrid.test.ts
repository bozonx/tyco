import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SearchShortcutGrid from './SearchShortcutGrid.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }))

const mountGrid = (count: number, query = '') =>
  mount(SearchShortcutGrid, {
    props: {
      items: makeItems(count),
      placeholder: 'Search',
      emptyText: 'Empty',
      query,
    },
    global: {
      stubs: {
        AppIcon: true,
        KeyboardKey: { template: '<kbd class="kbd"><slot /></kbd>' },
      },
    },
    attachTo: document.body,
  })

const selectedIds = (wrapper: ReturnType<typeof mountGrid>) =>
  (wrapper.emitted('select') ?? []).map(([item]) => (item as { id: string }).id)

describe('SearchShortcutGrid', () => {
  it('focuses the grid at first, so shortcut keys pick right away', async () => {
    const wrapper = mountGrid(3)
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(
      wrapper.find('.search-grid-grid').element
    )
    wrapper.unmount()
  })

  it('focuses the search when there is nothing to pick', async () => {
    const wrapper = mountGrid(0)
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(
      wrapper.find('.search-grid-search-input').element
    )
    wrapper.unmount()
  })

  it('moves the shortcut window by whole windows with PageDown', async () => {
    const wrapper = mountGrid(20)
    const grid = wrapper.find('.search-grid-grid')

    await grid.trigger('keydown', { key: 'PageDown' })
    const cells = wrapper.findAll('.search-grid-cell')
    // The window stops at the last row: items 5..19
    expect(cells[4]?.find('.search-grid-slot-key').exists()).toBe(false)
    expect(cells[5]?.find('.search-grid-slot-key').text()).toBe('Q')
    expect(cells[5]?.classes()).toContain('is-selected')

    await grid.trigger('keydown', { key: 'w', code: 'KeyW' })
    expect(selectedIds(wrapper)).toEqual(['item-6'])

    await grid.trigger('keydown', { key: 'PageUp' })
    await grid.trigger('keydown', { key: 'w', code: 'KeyW' })
    expect(selectedIds(wrapper)).toEqual(['item-6', 'item-1'])
    wrapper.unmount()
  })

  it('slides the window when the selection leaves it', async () => {
    const wrapper = mountGrid(30)
    const grid = wrapper.find('.search-grid-grid')
    for (let step = 0; step < 3; step++)
      await grid.trigger('keydown', { key: 'ArrowDown' })
    // Row 3 is selected, the window now starts at row 1
    await grid.trigger('keydown', { key: 'q', code: 'KeyQ' })
    expect(selectedIds(wrapper)).toEqual(['item-5'])
    wrapper.unmount()
  })

  it('ignores a shortcut key without an item', async () => {
    const wrapper = mountGrid(3)
    await wrapper
      .find('.search-grid-grid')
      .trigger('keydown', { key: 't', code: 'KeyT' })
    expect(selectedIds(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('goes to the search with Ctrl+F and slash', async () => {
    const wrapper = mountGrid(3)
    await wrapper.vm.$nextTick()
    const grid = wrapper.find('.search-grid-grid')
    const input = wrapper.find('.search-grid-search-input')

    await grid.trigger('keydown', { key: '/' })
    expect(document.activeElement).toBe(input.element)
    expect((input.element as HTMLInputElement).value).toBe('')

    ;(grid.element as HTMLElement).focus()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })
    )
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('picks with Alt and a shortcut key from the search', async () => {
    const wrapper = mountGrid(3)
    await wrapper
      .find('.search-grid-search-input')
      .trigger('keydown', { key: 'e', code: 'KeyE', altKey: true })
    expect(selectedIds(wrapper)).toEqual(['item-2'])
    wrapper.unmount()
  })

  it('steps back with Escape: clears the query, returns to the grid, then closes', async () => {
    const wrapper = mountGrid(3, 'abc')
    const input = wrapper.find('.search-grid-search-input')
    ;(input.element as HTMLElement).focus()

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:query')?.at(-1)).toEqual([''])
    await wrapper.setProps({ query: '' })

    await input.trigger('keydown', { key: 'Escape' })
    expect(document.activeElement).toBe(
      wrapper.find('.search-grid-grid').element
    )
    expect(wrapper.emitted('escape')).toBeUndefined()

    await wrapper
      .find('.search-grid-grid')
      .trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('escape')).toEqual([[false]])
    wrapper.unmount()
  })
})
