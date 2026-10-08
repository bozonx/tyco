import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import FieldSortableChecklist from './FieldSortableChecklist.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('FieldSortableChecklist.vue', () => {
  const options = [
    { id: 'acute', labelKey: 'plugin.diacritics.acute' },
    { id: 'grave', labelKey: 'plugin.diacritics.grave' },
  ]

  it('renders options with default values and labels', () => {
    const wrapper = mount(FieldSortableChecklist, {
      props: { options, defaultValue: [{ id: 'acute', enabled: true }] },
      global: { stubs: { Icon: true } },
    })

    const cards = wrapper.findAll('.checklist-item-card')
    expect(cards).toHaveLength(2)

    const inputs = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(inputs[0].element.checked).toBe(true)
    expect(inputs[1].element.checked).toBe(false)
  })

  it('toggles checkbox and emits update:value', async () => {
    const wrapper = mount(FieldSortableChecklist, {
      props: { options, defaultValue: [{ id: 'acute', enabled: true }] },
      global: { stubs: { Icon: true } },
    })

    const inputs = wrapper.findAll('input[type="checkbox"]')
    await inputs[1].trigger('change')

    expect(wrapper.emitted('update:value')).toBeTruthy()
    const emitted = wrapper.emitted('update:value')![0][0]
    expect(emitted).toEqual([
      { id: 'acute', enabled: true },
      { id: 'grave', enabled: true },
    ])
  })

  it('reorders items by dragging handle', async () => {
    const wrapper = mount(FieldSortableChecklist, {
      props: {
        options,
        value: [
          { id: 'acute', enabled: true },
          { id: 'grave', enabled: false },
        ],
      },
      attachTo: document.body,
      global: { stubs: { Icon: true } },
    })

    mockItemRects(wrapper.findAll('.checklist-item-card'))

    dispatchPointer(
      'pointerdown',
      10,
      wrapper.findAll('.drag-handle')[0].element
    )
    await wrapper.vm.$nextTick()
    expect(document.body.classList.contains('is-sorting')).toBe(true)

    dispatchPointer('pointermove', 70)
    await wrapper.vm.$nextTick()

    dispatchPointer('pointerup', 70)
    await wrapper.vm.$nextTick()

    expect(document.body.classList.contains('is-sorting')).toBe(false)
    expect(wrapper.emitted('update:value')).toBeTruthy()
    const emitted = wrapper.emitted('update:value')![0][0]
    expect(emitted).toEqual([
      { id: 'grave', enabled: false },
      { id: 'acute', enabled: true },
    ])
    wrapper.unmount()
  })
})

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

function dispatchPointer(
  type: string,
  clientY: number,
  target: EventTarget = window
) {
  const event = new MouseEvent(type, { clientY, bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event)
}
