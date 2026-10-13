import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import QueryPanel from './QueryPanel.vue'

const options = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'German' },
]

describe('QueryPanel', () => {
  it('blocks query submission while another operation is pending and restores focus afterwards', async () => {
    const wrapper = mount(QueryPanel, {
      attachTo: document.body,
      props: { modelValue: 'request', disabled: true },
    })
    try {
      await wrapper.find('input').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('submit')).toBeUndefined()
      await wrapper.setProps({ disabled: false })
      await nextTick()
      expect(document.activeElement).toBe(wrapper.find('input').element)
      await wrapper.find('input').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('submit')).toHaveLength(1)
    } finally {
      wrapper.unmount()
    }
  })
  it('preserves forward and backward tab navigation', () => {
    const wrapper = mount(QueryPanel, { props: { modelValue: '' } })
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      })
      wrapper.find('input').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    wrapper.unmount()
  })

  it('links each combobox to its own list and active option', async () => {
    const parent = mount({
      components: { QueryPanel },
      props: { options: { type: Array, default: () => options } },
      template:
        '<QueryPanel model-value="" :options="options" auto-highlight /><QueryPanel model-value="" :options="options" auto-highlight />',
    })
    const [first, second] = parent.findAllComponents(QueryPanel)
    expect(first.find('[role="listbox"]').attributes('id')).not.toBe(
      second.find('[role="listbox"]').attributes('id')
    )
    for (const wrapper of [first, second]) {
      expect(wrapper.find('input').attributes('aria-controls')).toBe(
        wrapper.find('[role="listbox"]').attributes('id')
      )
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        wrapper.find('[role="option"]').attributes('id')
      )
    }
    await parent.setProps({ options: [] })
    for (const wrapper of [first, second]) {
      expect(wrapper.find('input').attributes('aria-controls')).toBeUndefined()
      expect(
        wrapper.find('input').attributes('aria-activedescendant')
      ).toBeUndefined()
    }
    parent.unmount()
  })

  it('submits the highlighted option, moved by the arrows', async () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: '', options, autoHighlight: true },
    })
    const input = wrapper.find('input')

    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true })

    expect(wrapper.emitted('submit')).toEqual([
      [{ option: options[0], ctrl: false }],
      [{ option: options[1], ctrl: true }],
    ])
  })

  it('submits the typed text when nothing is highlighted', async () => {
    const wrapper = mount(QueryPanel, { props: { modelValue: 'x', options } })

    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toEqual([
      [{ option: undefined, ctrl: false }],
    ])
  })

  it('goes back on Esc and passes Ctrl+S on', async () => {
    const wrapper = mount(QueryPanel, { props: { modelValue: '' } })
    const input = wrapper.find('input')

    await input.trigger('keydown', { key: 'Tab' })
    await input.trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true })
    await input.trigger('keyup', { key: 'Escape' })

    expect(wrapper.emitted('tab')).toBeUndefined()
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('heads each group and highlights the selected option first', async () => {
    const grouped = [
      { id: 'en', label: 'English', group: 'Recent' },
      { id: 'de', label: 'German', group: 'All', selected: true },
      { id: 'fr', label: 'French', group: 'All' },
    ]
    const wrapper = mount(QueryPanel, {
      props: { modelValue: '', options: grouped, autoHighlight: true },
    })

    expect(
      wrapper.findAll('.query-panel-group').map((group) => group.text())
    ).toEqual(['Recent', 'All'])

    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toEqual([
      [{ option: grouped[1], ctrl: false }],
    ])
  })
})
