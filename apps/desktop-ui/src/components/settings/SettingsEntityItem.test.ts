import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SettingsEntityItem from './SettingsEntityItem.vue'

describe('SettingsEntityItem.vue', () => {
  it('renders title and description with default tone', () => {
    const wrapper = mount(SettingsEntityItem, {
      props: {
        icon: 'mdi:robot-outline',
        title: 'Custom Bot',
        description: 'Assists with code',
      },
    })
    expect(wrapper.text()).toContain('Custom Bot')
    expect(wrapper.text()).toContain('Assists with code')
    expect(wrapper.find('.is-primary').exists()).toBe(true)
    expect(wrapper.find('.settings-entity-chevron').exists()).toBe(false)
  })

  it('emits open on card click and target button click when openable', async () => {
    const wrapper = mount(SettingsEntityItem, {
      props: { icon: 'mdi:folder', title: 'Project A', openable: true },
    })
    expect(wrapper.find('.settings-entity-chevron').exists()).toBe(true)

    await wrapper.get('.settings-entity-target').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)

    await wrapper.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(2)
  })

  it('does not emit open when clicking inside trailing slot', async () => {
    const wrapper = mount(SettingsEntityItem, {
      props: { icon: 'mdi:folder', title: 'Project A', openable: true },
      slots: { actions: '<button class="action-btn">Action</button>' },
    })
    await wrapper.get('.action-btn').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
