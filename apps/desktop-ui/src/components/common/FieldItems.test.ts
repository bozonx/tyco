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

  it('handles move up and down', async () => {
    const items = [{ name: 'First' }, { name: 'Second' }]
    const wrapper = mount(FieldItems, {
      props: { items },
      global: { stubs: { Icon: true } },
    })

    const moveDownBtns = wrapper.findAll('.control-btn:nth-child(2)')
    expect(moveDownBtns).toHaveLength(2)
    await moveDownBtns[0].trigger('click')

    expect(wrapper.emitted('update:items')).toBeTruthy()
    expect(wrapper.emitted('update:items')![0][0]).toEqual([
      { name: 'Second' },
      { name: 'First' },
    ])
  })

  it('handles drag and drop reordering', async () => {
    const items = [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]
    const wrapper = mount(FieldItems, {
      props: { items },
      global: { stubs: { Icon: true } },
    })

    const cards = wrapper.findAll('.item-card')
    const handles = wrapper.findAll('.drag-handle')

    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
      getData: vi.fn(),
    }

    await handles[0].trigger('dragstart', { dataTransfer })
    await cards[2].trigger('drop')

    expect(wrapper.emitted('update:items')).toBeTruthy()
    expect(wrapper.emitted('update:items')![0][0]).toEqual([
      { name: 'Beta' },
      { name: 'Gamma' },
      { name: 'Alpha' },
    ])
  })
})
