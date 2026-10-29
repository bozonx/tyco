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
    expect(secondaryKeyTexts).toEqual(['Shift', 'Space', 'Enter'])
  })
})
