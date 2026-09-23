import { describe, expect, it } from 'vitest'

import { applyProviderInfo, type HotkeySettingsState } from './hotkey-settings'

describe('hotkey settings', () => {
  it('hydrates provider capabilities and initial action statuses', () => {
    const state: HotkeySettingsState = { canConfigure: true, statuses: {} }

    applyProviderInfo(state, {
      provider: 'external',
      canConfigure: false,
      actions: {
        editor: {
          status: 'external',
          externalCommand: 'tyco-ctl activate editor',
        },
      },
    })

    expect(state.canConfigure).toBe(false)
    expect(state.statuses.editor?.externalCommand).toBe(
      'tyco-ctl activate editor'
    )
  })
})
