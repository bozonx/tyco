import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import VoiceRecordingActions from './VoiceRecordingActions.vue'

let desktop: TestDesktop
beforeEach(() => {
  desktop = installFakeDesktop()
  desktop.setState({ windowId: 'target' })
})
afterEach(() => desktop.dispose())

const mountActions = (props: Record<string, unknown>) =>
  mount(VoiceRecordingActions, {
    global: { plugins: [i18n, desktop.pinia] },
    props: {
      isFinishing: false,
      finish: async () => {},
      cancel: async () => {},
      ...props,
    },
  })
const primaryKeys = (wrapper: ReturnType<typeof mountActions>) =>
  wrapper
    .find('.shortcut.is-primary')
    .findAll('kbd')
    .map((key) => key.text())

describe('VoiceRecordingActions', () => {
  it('offers typing and submission without actions for an AI prompt', async () => {
    const wrapper = mountActions({
      compact: true,
      chat: true,
      finishBehavior: 'prompt',
      hasText: false,
    })
    expect(wrapper.findAll('.shortcut')).toHaveLength(1)
    expect(wrapper.text()).toContain('Type text')
    await wrapper.setProps({ hasText: true })
    expect(
      wrapper
        .findAll('.shortcut')
        .map((button) => button.findAll('kbd').map((key) => key.text()))
    ).toEqual([
      ['Shift', 'Space'],
      ['Space', 'Enter'],
    ])
    expect(wrapper.find('.is-primary').text()).toContain('To prompt input')
  })

  it('opens dictation actions with Shift+Space without a separate edit-text action', async () => {
    const intents: unknown[] = []
    const wrapper = mountActions({
      finishBehavior: 'insertIntoTarget',
      finish: async (intent: unknown) => {
        intents.push(intent)
      },
    })
    const buttons = wrapper.findAll('.shortcut')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.findAll('kbd').map((key) => key.text())).toEqual([
      'Shift',
      'Space',
    ])
    expect(wrapper.text()).not.toContain('Tab')
    await buttons[0]!.trigger('click')
    expect(intents).toEqual(['next'])
  })

  it('adds the hotkey that opened the input to the primary button', () => {
    for (const finishBehavior of ['insertIntoTarget', 'submitToChat']) {
      expect(
        primaryKeys(mountActions({ finishBehavior, finishHotkey: 'Ctrl+V' }))
      ).toEqual(['Space', 'Enter', 'Ctrl+V'])
      expect(primaryKeys(mountActions({ finishBehavior }))).toEqual([
        'Space',
        'Enter',
      ])
    }
  })

  it('shows Shift, Space, Enter for voice-to-input when submitting to chat', () => {
    const wrapper = mountActions({ finishBehavior: 'submitToChat' })
    const buttons = wrapper.findAll('.shortcut')
    const secondaryKeyTexts = buttons[1]
      ?.findAll('kbd')
      .map((key) => key.text())
    expect(secondaryKeyTexts).toEqual(['Shift', 'Space'])
  })

  it('keeps cancellation out of the footer', () => {
    const wrapper = mountActions({
      compact: true,
      chat: true,
      cancelShortcut: true,
    })
    expect(wrapper.findAll('.shortcut')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Cancel')
  })

  it('triggers submit when clicking the send-right-away button in compact chat mode', async () => {
    const intents: unknown[] = []
    const wrapper = mountActions({
      compact: true,
      chat: true,
      finish: async (intent?: unknown) => {
        intents.push(intent)
      },
    })
    const shortcutButtons = wrapper.findAll('.shortcut')
    expect(shortcutButtons).toHaveLength(2)
    expect(shortcutButtons[0]?.findAll('kbd').map((k) => k.text())).toEqual([
      'Shift',
      'Space',
    ])
    await shortcutButtons[0]?.trigger('click')
    expect(intents).toEqual(['submit'])
  })

  it('names the application the text goes to', () => {
    desktop.setState({ windowId: 'target', windowAppName: 'Thunderbird' })
    const wrapper = mountActions({ finishBehavior: 'insertIntoTarget' })
    const insert = wrapper.find('.shortcut.is-primary')
    expect(insert.text()).toContain('To Thunderbi…')
    expect(insert.attributes('title')).toBe('Insert into Thunderbird')
  })

  it('leads to the actions once the target window is gone', async () => {
    const intents: unknown[] = []
    desktop.setState({ windowId: null })
    const wrapper = mountActions({
      finishBehavior: 'insertIntoTarget',
      finish: async (intent: unknown) => {
        intents.push(intent)
      },
    })
    expect(wrapper.find('.voice-actions-notice').text()).toBe(
      'No window to insert into'
    )
    const primary = wrapper.find('.shortcut.is-primary')
    expect(primary.text()).toContain('Actions')
    expect(primaryKeys(wrapper)).toEqual(['Space', 'Enter'])
    const insert = wrapper.findAll('.shortcut').at(-1)!
    expect(insert.attributes('disabled')).toBeDefined()
    await primary.trigger('click')
    expect(intents).toEqual(['next'])
  })

  it('tells in the quick panel that its keys do not arrive', async () => {
    desktop.dispose()
    desktop = installFakeDesktop({}, 'quick')
    desktop.setState({ windowId: 'target' })
    vi.useFakeTimers()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    try {
      const wrapper = mountActions({ finishBehavior: 'insertIntoTarget' })
      expect(wrapper.find('.voice-actions-notice').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(wrapper.find('.voice-actions-notice').text()).toBe(
        'Keys are inactive: click the panel'
      )
      hasFocus.mockReturnValue(true)
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(0)
      expect(wrapper.find('.voice-actions-notice').exists()).toBe(false)
    } finally {
      hasFocus.mockRestore()
      vi.useRealTimers()
    }
  })
})
