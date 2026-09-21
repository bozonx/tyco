import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FieldItems from './FieldItems.vue'
import Button from './Button.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('FieldItems.vue', () => {
  it('renders items with slot content and handles adding item', async () => {
    const items = [{ name: 'Task 1' }, { name: 'Task 2' }]
    const wrapper = mount(FieldItems, {
      props: { items },
      slots: {
        item: '<template #item="{ item }"><div class="custom-item">{{ item.name }}</div></template>',
      },
      global: { stubs: { Icon: true } },
    })

    const customItems = wrapper.findAll('.custom-item')
    expect(customItems).toHaveLength(2)
    expect(customItems[0].text()).toBe('Task 1')
    expect(customItems[1].text()).toBe('Task 2')

    const addBtn = wrapper.findAllComponents(Button).at(-1)!
    await addBtn.trigger('click')

    expect(wrapper.emitted('update:items')).toBeTruthy()
    expect(wrapper.emitted('update:items')![0][0]).toEqual([
      { name: 'Task 1' },
      { name: 'Task 2' },
      {},
    ])
  })

  it('handles remove item', async () => {
    const items = [{ name: 'Item 1' }, { name: 'Item 2' }]
    const wrapper = mount(FieldItems, {
      props: { items },
      global: { stubs: { Icon: true } },
    })

    const deleteBtns = wrapper.findAll('.delete-btn')
    expect(deleteBtns).toHaveLength(2)
    await deleteBtns[0].trigger('click')

    expect(wrapper.emitted('update:items')).toBeTruthy()
    expect(wrapper.emitted('update:items')![0][0]).toEqual([{ name: 'Item 2' }])
  })

  it('has no manual move buttons', () => {
    const wrapper = mount(FieldItems, {
      props: { items: [{ name: 'First' }, { name: 'Second' }] },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.findAll('.control-btn')).toHaveLength(0)
    expect(wrapper.findAll('.drag-handle')).toHaveLength(2)
  })

  it('reorders items by dragging the handle', async () => {
    const items = [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]
    const wrapper = mount(FieldItems, {
      props: { items },
      attachTo: document.body,
      global: { stubs: { Icon: true } },
    })
    mockItemRects(wrapper.findAll('.item-card'))

    dispatchPointer('pointerdown', 20, wrapper.find('.drag-handle').element)
    await wrapper.vm.$nextTick()
    expect(document.body.classList.contains('is-sorting')).toBe(true)

    dispatchPointer('pointermove', 125)
    await wrapper.vm.$nextTick()
    const cards = wrapper.findAll('.item-card')
    expect(cards[0].classes()).toContain('is-dragged')
    expect(cards[0].attributes('style')).toContain('translateY(105px)')
    expect(cards[1].attributes('style')).toContain('translateY(-48px)')

    dispatchPointer('pointerup', 125)
    await wrapper.vm.$nextTick()

    expect(document.body.classList.contains('is-sorting')).toBe(false)
    expect(wrapper.emitted('update:items')![0][0]).toEqual([
      { name: 'Beta' },
      { name: 'Gamma' },
      { name: 'Alpha' },
    ])
    wrapper.unmount()
  })

  it('cancels dragging on Escape', async () => {
    const wrapper = mount(FieldItems, {
      props: { items: [{ name: 'Alpha' }, { name: 'Beta' }] },
      attachTo: document.body,
      global: { stubs: { Icon: true } },
    })
    mockItemRects(wrapper.findAll('.item-card'))

    dispatchPointer('pointerdown', 20, wrapper.find('.drag-handle').element)
    await wrapper.vm.$nextTick()
    dispatchPointer('pointermove', 120)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    dispatchPointer('pointerup', 120)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:items')).toBeFalsy()
    expect(wrapper.findAll('.item-card')[0].attributes('style')).toBeUndefined()
    wrapper.unmount()
  })
})

// Three 40px cards spaced by 8px, as laid out by the real stylesheet.
function mockItemRects(cards: { element: Element }[]) {
  cards.forEach(({ element }, index) => {
    const top = index * 48
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom: top + 40,
      height: 40,
    } as DOMRect)
  })
}

// jsdom has no PointerEvent; a MouseEvent with a pointerId stands in for it.
function dispatchPointer(
  type: string,
  clientY: number,
  target: EventTarget = window
) {
  const event = new MouseEvent(type, { clientY, bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event)
}
