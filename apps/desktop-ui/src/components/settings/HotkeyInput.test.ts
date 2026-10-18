import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HotkeyInput from './HotkeyInput.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('HotkeyInput.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders configured shortcut keys', () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+Shift+K', placeholder: 'No shortcut' },
      global: {
        stubs: {
          Icon: true,
          KeyboardKey: { template: '<span class="key-stub"><slot /></span>' },
        },
      },
    })

    const keys = wrapper.findAll('.key-stub').map((k) => k.text())
    expect(keys).toEqual(['Ctrl', 'Shift', 'K'])
    expect(wrapper.classes()).not.toContain('is-recording')
  })

  it('renders placeholder when value is empty', () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: '', placeholder: 'Press keys...' },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    expect(wrapper.find('.hotkey-placeholder').text()).toBe('Press keys...')
  })

  it('starts recording on click when not readonly', async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+K' },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    await wrapper.trigger('click')

    expect(wrapper.classes()).toContain('is-recording')
    expect(wrapper.emitted('recording')?.[0]).toEqual([true])
  })

  it('does not start recording when readonly is true', async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+K', readonly: true },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    await wrapper.trigger('click')

    expect(wrapper.classes()).not.toContain('is-recording')
    expect(wrapper.emitted('recording')).toBeUndefined()
  })

  it('records valid shortcut on keydown and emits the model value', async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+K' },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    await wrapper.trigger('click')

    // Press Ctrl+Shift+P
    await wrapper.trigger('keydown', {
      key: 'P',
      code: 'KeyP',
      ctrlKey: true,
      shiftKey: true,
    })

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Ctrl+Shift+P'])
  })

  it('shows invalid hint on non-modifier single key', async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+K' },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    await wrapper.trigger('click')

    // Press bare 'A' key (invalid shortcut without modifier)
    await wrapper.trigger('keydown', { key: 'a', code: 'KeyA' })

    expect(wrapper.classes()).toContain('is-invalid')
    expect(wrapper.find('.hotkey-hint').text()).toBe(
      'settings.hotkeyInput.needsModifier'
    )
  })

  it('cancels recording on Escape', async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modelValue: 'Ctrl+K' },
      global: { stubs: { Icon: true, KeyboardKey: true } },
    })

    await wrapper.trigger('click')
    expect(wrapper.classes()).toContain('is-recording')

    await wrapper.trigger('keydown', { key: 'Escape', code: 'Escape' })
    await wrapper.trigger('blur')

    expect(wrapper.classes()).not.toContain('is-recording')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
