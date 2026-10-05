import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import QueryPanel from './QueryPanel.vue'

const options = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'German' },
]

describe('QueryPanel', () => {
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

  it('goes back on Esc and passes Tab and Ctrl+S on', async () => {
    const wrapper = mount(QueryPanel, { props: { modelValue: '' } })
    const input = wrapper.find('input')

    await input.trigger('keydown', { key: 'Tab' })
    await input.trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true })
    await input.trigger('keyup', { key: 'Escape' })

    expect(wrapper.emitted('tab')).toHaveLength(1)
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
