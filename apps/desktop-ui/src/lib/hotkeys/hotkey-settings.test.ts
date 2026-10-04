import { describe, expect, it } from 'vitest'

import {
  applyProviderInfo,
  createHotkeySettingsState,
  defaultShortcut,
  displayedShortcut,
  hasConflict,
  isEditable,
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
      defaults: {},
      platform: 'linux',
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
      systemTriggers: { editor: 'Meta+E', voice: 'Meta+V, Ctrl+F12' },
      defaults: {},
      platform: 'linux',
    })

    expect(isSystemManaged(state)).toBe(true)
    expect(displayedShortcut(state, 'editor', 'Ctrl+Alt+E')).toBe('Meta+E')
    expect(displayedShortcut(state, 'voice', 'Ctrl+Alt+V')).toBe('Meta+V')
    expect(displayedShortcut(state, 'chat', 'Ctrl+Alt+C')).toBe('')
    expect(isEditable(state)).toBe(false)
    expect(providerNoteKey(state)).toBe('settings.hotkeyProvider.portal')
  })

  it('shows the configured shortcuts that Tyco binds itself', () => {
    const state = createHotkeySettingsState()
    applyProviderInfo(state, {
      provider: 'global-shortcut',
      canConfigure: false,
      actions: {},
      systemTriggers: {},
      defaults: {},
      platform: 'linux',
    })

    expect(isSystemManaged(state)).toBe(false)
    expect(isEditable(state)).toBe(true)
    expect(displayedShortcut(state, 'editor', 'Ctrl+Alt+E')).toBe('Ctrl+Alt+E')
    expect(providerNoteKey(state)).toBeNull()
  })

  it('records nothing until the provider is known', () => {
    expect(isEditable(createHotkeySettingsState())).toBe(false)
  })

  it('takes the platform defaults from the backend', () => {
    const state = createHotkeySettingsState()
    applyProviderInfo(state, {
      provider: 'global-shortcut',
      canConfigure: false,
      actions: {},
      systemTriggers: {},
      defaults: { editor: 'Ctrl+Shift+Alt+E' },
      platform: 'windows',
    })

    expect(state.platform).toBe('windows')
    expect(defaultShortcut(state, 'editor', 'Ctrl+Alt+E')).toBe(
      'Ctrl+Shift+Alt+E'
    )
    expect(defaultShortcut(state, 'voice', 'Ctrl+Alt+V')).toBe('Ctrl+Alt+V')
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
