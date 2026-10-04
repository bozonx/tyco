import { describe, expect, it } from 'vitest'

import {
  applyProviderInfo,
  createHotkeySettingsState,
  displayedShortcut,
  hasConflict,
  isSystemManaged,
  providerNoteKey,
} from './hotkey-settings'

describe('hotkey settings', () => {
  it('hydrates provider capabilities and external commands', () => {
    const state = createHotkeySettingsState()

    applyProviderInfo(state, {
      provider: 'external',
      canConfigure: false,
      actions: {
        editor: {
          status: 'external',
          externalCommand: 'tyco-ctl activate editor',
        },
      },
      systemTriggers: {},
    })

    expect(state.canConfigure).toBe(false)
    expect(state.statuses.editor?.externalCommand).toBe(
      'tyco-ctl activate editor'
    )
    expect(providerNoteKey(state)).toBe('settings.hotkeyProvider.external')
  })

  it('shows the shortcuts the desktop bound through the portal', () => {
    const state = createHotkeySettingsState()
    applyProviderInfo(state, {
      provider: 'portal',
      canConfigure: true,
      actions: {},
      systemTriggers: { editor: 'Meta+E' },
    })

    expect(isSystemManaged(state)).toBe(true)
    expect(displayedShortcut(state, 'editor', 'Ctrl+Alt+E')).toBe('Meta+E')
    expect(displayedShortcut(state, 'voice', 'Ctrl+Alt+V')).toBe('')
    expect(providerNoteKey(state)).toBe('settings.hotkeyProvider.portal')
  })

  it('shows the configured shortcuts that Tyco binds itself', () => {
    const state = createHotkeySettingsState()
    applyProviderInfo(state, {
      provider: 'global-shortcut',
      canConfigure: false,
      actions: {},
      systemTriggers: {},
    })

    expect(isSystemManaged(state)).toBe(false)
    expect(displayedShortcut(state, 'editor', 'Ctrl+Alt+E')).toBe('Ctrl+Alt+E')
    expect(providerNoteKey(state)).toBeNull()
  })

  it('reports only conflicts per action', () => {
    const state = createHotkeySettingsState()
    state.statuses = {
      editor: { status: 'ready' },
      voice: { status: 'conflict', message: 'taken' },
    }

    expect(hasConflict(state, 'editor')).toBe(false)
    expect(hasConflict(state, 'voice')).toBe(true)
  })
})
