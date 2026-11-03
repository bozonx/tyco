import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ChatPromptsKeypad from './ChatPromptsKeypad.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ChatPromptsKeypad.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'chat')
    desktop.setUserConfig({
      chatPrompts: {
        items: [
          { id: 'p1', name: 'Summarize', rule: 'Summarize the text' },
          { id: 'p2', name: 'Explain', rule: 'Explain in simple terms' },
        ],
        slots: { q: 'p1', w: 'p2' },
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('renders buttons for configured slots and handles mouse click', async () => {
    const anchor = document.createElement('div')
    const wrapper = mount(ChatPromptsKeypad, {
      props: { isOpen: true, anchor },
      global: { plugins: [desktop.pinia], stubs: { Teleport: true } },
    })

    const buttons = wrapper.findAllComponents({ name: 'ShortcutButton' })
    expect(buttons.length).toBe(2)
    expect(buttons[0].text()).toContain('Summarize')
    expect(buttons[1].text()).toContain('Explain')

    await buttons[0].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['Summarize the text']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('selects prompt on keyboard key press', async () => {
    const anchor = document.createElement('div')
    const wrapper = mount(ChatPromptsKeypad, {
      props: { isOpen: true, anchor },
      global: { plugins: [desktop.pinia], stubs: { Teleport: true } },
    })

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' })
    )

    expect(wrapper.emitted('select')).toEqual([['Summarize the text']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Escape key press', async () => {
    const anchor = document.createElement('div')
    const wrapper = mount(ChatPromptsKeypad, {
      props: { isOpen: true, anchor },
      global: { plugins: [desktop.pinia], stubs: { Teleport: true } },
    })

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })
    )

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('shows empty hint when no prompts are configured', async () => {
    desktop.setUserConfig({ chatPrompts: { items: [], slots: {} } })
    const anchor = document.createElement('div')
    const wrapper = mount(ChatPromptsKeypad, {
      props: { isOpen: true, anchor },
      global: { plugins: [desktop.pinia], stubs: { Teleport: true } },
    })

    const emptyHint = wrapper.find('.chat-prompts-empty-hint')
    expect(emptyHint.exists()).toBe(true)
    expect(emptyHint.text()).toBe('chat.noPromptsConfigured')
  })
})
