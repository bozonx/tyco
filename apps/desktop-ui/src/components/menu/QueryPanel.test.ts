import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import QueryPanel from './QueryPanel.vue'

const options = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'German' },
]

describe('QueryPanel', () => {
  it.each(['Enter', 'Ctrl+Enter'] as const)(
    'uses %s for multiline submission and preserves Shift+Enter',
    async (submitKey) => {
      const wrapper = mount(QueryPanel, {
        props: { modelValue: 'request', multiline: true, submitKey },
      })
      const input = wrapper.find('textarea')
      await input.trigger('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
      })
      expect(wrapper.emitted('submit')).toBeUndefined()
      if (submitKey === 'Ctrl+Enter') {
        await input.trigger('keydown', { key: 'Enter', code: 'Enter' })
        expect(wrapper.emitted('submit')).toBeUndefined()
      }
      await input.trigger('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: submitKey === 'Ctrl+Enter',
      })
      expect(wrapper.emitted('submit')).toEqual([
        [{ ctrl: false, option: undefined }],
      ])
    }
  )
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
  it('keeps the slots live while disabled, so a stop button still works', () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: 'request', disabled: true },
      slots: { 'after-input': '<button class="stop">Stop</button>' },
    })
    expect(wrapper.find('.query-panel').attributes('inert')).toBeUndefined()
    expect(wrapper.find('.stop').element.closest('[inert]')).toBeNull()
    expect(wrapper.find('input').element.closest('[inert]')).not.toBeNull()
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
    const wrapper = mount(QueryPanel, {
      attachTo: document.body,
      props: { modelValue: '' },
    })
    const input = wrapper.find('input')

    await input.trigger('keydown', { key: 'Tab' })
    await input.trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true })
    await input.trigger('keydown', { key: 'Escape' })

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

  it('does not highlight options on mouseenter or submit a hovered option on Enter', async () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: 'typed', options },
    })

    const option = wrapper.findAll('[role="option"]')[0]
    await option.trigger('mouseenter')
    expect(option.classes()).not.toContain('is-highlighted')

    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submit')).toEqual([
      [{ option: undefined, ctrl: false }],
    ])
  })

  it('navigates above-popover options from the bottom on ArrowUp and back to input on ArrowDown', async () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: '', options, optionsPlacement: 'above-popover' },
    })
    expect(wrapper.find('.query-panel-options').classes()).toContain(
      'is-above-popover'
    )

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.is-highlighted').exists()).toBe(false)

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.findAll('[role="option"]')[1].classes()).toContain(
      'is-highlighted'
    )

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.findAll('[role="option"]')[0].classes()).toContain(
      'is-highlighted'
    )

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.findAll('[role="option"]')[1].classes()).toContain(
      'is-highlighted'
    )

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.is-highlighted').exists()).toBe(false)

    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submit')).toEqual([
      [{ option: options[1], ctrl: false }],
    ])
  })

  it('keeps footer-start live when disabled', () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: 'request', disabled: true },
      slots: { 'footer-start': '<button class="stop">Stop</button>' },
    })
    expect(wrapper.find('.stop').element.closest('[inert]')).toBeNull()
  })

  it('clears above-popover selection when clicking back on the input or blurring it', async () => {
    const wrapper = mount(QueryPanel, {
      props: { modelValue: '', options, optionsPlacement: 'above-popover' },
    })

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.findAll('[role="option"]')[1].classes()).toContain(
      'is-highlighted'
    )

    await input.trigger('mousedown')
    expect(wrapper.find('.is-highlighted').exists()).toBe(false)

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.findAll('[role="option"]')[1].classes()).toContain(
      'is-highlighted'
    )

    await input.trigger('blur')
    expect(wrapper.find('.is-highlighted').exists()).toBe(false)
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })

  it('supports multiline input: allows Shift+Enter and vertical arrows without options', async () => {
    const wrapper = mount(QueryPanel, {
      attachTo: document.body,
      props: { modelValue: 'line 1\nline 2', multiline: true },
    })
    try {
      const textarea = wrapper.find('textarea')
      expect(textarea.exists()).toBe(true)

      const shiftEnter = new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      textarea.element.dispatchEvent(shiftEnter)
      expect(shiftEnter.defaultPrevented).toBe(false)
      expect(wrapper.emitted('submit')).toBeUndefined()

      const arrowUp = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      })
      textarea.element.dispatchEvent(arrowUp)
      expect(arrowUp.defaultPrevented).toBe(false)

      await textarea.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('submit')).toEqual([
        [{ option: undefined, ctrl: false }],
      ])

      wrapper.vm.select(2, 5)
      expect(wrapper.vm.getSelection()).toEqual({ start: 2, end: 5 })
    } finally {
      wrapper.unmount()
    }
  })
})
