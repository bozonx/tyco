import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import VoiceRecordingActions from './VoiceRecordingActions.vue'

const mountActions = (props: Record<string, unknown>) =>
  mount(VoiceRecordingActions, {
    global: { plugins: [i18n] },
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

  it('shows a labelled Esc cancel button in compact chat mode when cancelShortcut is enabled', async () => {
    let cancelled = false
    const wrapper = mountActions({
      compact: true,
      chat: true,
      cancelShortcut: true,
      cancel: async () => {
        cancelled = true
      },
    })
    const shortcutButtons = wrapper.findAll('.shortcut')
    expect(shortcutButtons).toHaveLength(3)
    expect(shortcutButtons[2]?.findAll('kbd').map((k) => k.text())).toEqual([
      'Space',
      'Enter',
    ])
    expect(shortcutButtons[2]?.text()).toContain('Finish')
    expect(shortcutButtons[0]?.findAll('kbd').map((k) => k.text())).toEqual([
      'Esc',
    ])
    expect(shortcutButtons[1]?.findAll('kbd').map((k) => k.text())).toEqual([
      'Shift',
      'Space',
    ])
    expect(shortcutButtons[1]?.text()).toContain('Send right away')
    await shortcutButtons[0]?.trigger('click')
    expect(cancelled).toBe(true)
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
    expect(shortcutButtons).toHaveLength(3)
    expect(shortcutButtons[1]?.findAll('kbd').map((k) => k.text())).toEqual([
      'Shift',
      'Space',
    ])
    await shortcutButtons[1]?.trigger('click')
    expect(intents).toEqual(['submit'])
  })
})
