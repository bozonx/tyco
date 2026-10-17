import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ShortcutSlots from './ShortcutSlots.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ShortcutSlots', () => {
  it('preserves add and remove actions', async () => {
    const wrapper = mount(ShortcutSlots, { props: { items: ['a', null, 'c'] } })
    const cards = wrapper.findAll('.shortcut-slot')
    expect(wrapper.find('[draggable]').exists()).toBe(false)
    await cards[1].find('.empty-slot').trigger('click')
    expect(wrapper.emitted('add')).toEqual([[1]])
    await cards[0].find('.delete-btn').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[0]])
    wrapper.unmount()
  })

  it('swaps slots using pointer events', async () => {
    const wrapper = mount(ShortcutSlots, {
      props: { items: ['a', null, 'c'] },
      attachTo: document.body,
    })
    wrapper.findAll('.shortcut-slot').forEach(({ element }, index) => {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        top: index * 50,
        bottom: index * 50 + 40,
        height: 40,
        left: 0,
        right: 100,
      } as DOMRect)
    })
    const dispatch = (type: string, y: number, target: EventTarget) => {
      const event = new MouseEvent(type, {
        clientX: 20,
        clientY: y,
        bubbles: true,
      })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
    }
    dispatch('pointerdown', 10, wrapper.find('.drag-handle').element)
    dispatch('pointermove', 60, window)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.shortcut-slot')[1].classes()).toContain(
      'is-drop-target'
    )
    dispatch('pointerup', 60, window)
    expect(wrapper.emitted('move')).toEqual([[0, 1]])
    wrapper.unmount()
  })
})
