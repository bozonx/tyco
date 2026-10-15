import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NavigationList from './NavigationList.vue'
const tabs = [
  { id: 'one', name: 'One' },
  { id: 'two', name: 'Two' },
]
describe('NavigationList', () => {
  it('uses ordinary buttons for navigation without advertising tab semantics', () => {
    const wrapper = mount(NavigationList, {
      props: { items: tabs, label: 'Settings', modelValue: 'two' },
    })
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Settings')
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
    expect(wrapper.findAll('button')[1].attributes('aria-current')).toBe('page')
    expect(
      wrapper
        .findAll('button')
        .every((button) => button.attributes('tabindex') === undefined)
    ).toBe(true)
  })
  it('uses the same selection contract for nested plugin entries and preserves their status', async () => {
    const wrapper = mount(NavigationList, {
      props: {
        label: 'Settings',
        modelValue: 'general',
        items: [
          { id: 'general', name: 'General' },
          {
            id: 'plugin:example',
            name: 'Example plugin',
            nested: true,
            status: 'Enabled',
            isEnabled: true,
          },
        ],
      },
    })
    const plugin = wrapper.findAll('button')[1]
    expect(plugin.text()).toContain('Enabled')
    await plugin.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['plugin:example']])
    await wrapper.setProps({ modelValue: 'plugin:example' })
    expect(plugin.attributes('aria-current')).toBe('page')
    expect(
      wrapper.findAll('button')[0].attributes('aria-current')
    ).toBeUndefined()
  })
})
