import { describe, expect, it } from 'vitest'

import {
  buildSettingsNavigation,
  isSettingsTabAvailable,
  parseSettingsTab,
  settingsTabTitle,
} from './settings-navigation'

const sources = {
  translate: (key: string) => key,
  profiles: [{ id: 'writer', name: 'Writer' }],
  projects: [{ id: 'notes', name: 'Notes', isExternal: true }],
  plugins: [{ pluginId: 'case', label: 'Text case', isEnabled: false }],
}

describe('settings navigation', () => {
  it('parses sections and detail pages', () => {
    expect(parseSettingsTab('llm')).toEqual({ kind: 'section', id: 'llm' })
    expect(parseSettingsTab('ai-profiles')).toEqual({ kind: 'ai-overview' })
    expect(parseSettingsTab('ai-profiles:overview')).toEqual({
      kind: 'ai-overview',
    })
    expect(parseSettingsTab('plugin:case')).toEqual({
      kind: 'plugin',
      pluginId: 'case',
    })
    expect(parseSettingsTab('ai-profile:new')).toEqual({
      kind: 'ai-profile',
      profileId: 'new',
    })
    expect(parseSettingsTab('ai-project:notes')).toEqual({
      kind: 'ai-project',
      projectId: 'notes',
    })
    expect(parseSettingsTab('plugin:')).toEqual({ kind: 'unknown' })
    expect(parseSettingsTab('nope')).toEqual({ kind: 'unknown' })
  })

  it('lists plugins always and the vault only while it is open', () => {
    const closed = buildSettingsNavigation('general', sources)
    expect(closed.primary.map((item) => item.id)).toContain('plugin:case')
    expect(closed.primary.map((item) => item.id)).not.toContain(
      'ai-profile:writer'
    )
    expect(
      closed.primary.find((item) => item.id === 'plugin:case')
    ).toMatchObject({
      status: 'settings.pluginStatusOff',
      isEnabled: false,
      nested: true,
    })

    const open = buildSettingsNavigation('ai-project:notes', sources)
    const ids = open.primary.map((item) => item.id)
    expect(ids.slice(ids.indexOf('ai-profiles'))).toEqual([
      'ai-profiles',
      'ai-profiles:overview',
      'ai-profile:writer',
      'ai-profile:new',
      'ai-project:notes',
      'ai-project:new',
    ])
    expect(open.actions.map((item) => item.id)).toEqual([
      'main-actions',
      'tasks',
      'languages',
      'launcher-commands',
      'commands',
    ])
  })

  it('accepts vault pages before the vault is read', () => {
    const loaded = { ...sources, isVaultLoaded: true }
    expect(isSettingsTabAvailable('ai-profile:writer', loaded)).toBe(true)
    expect(isSettingsTabAvailable('ai-profile:new', loaded)).toBe(true)
    expect(isSettingsTabAvailable('ai-profile:gone', loaded)).toBe(false)
    expect(isSettingsTabAvailable('ai-project:gone', loaded)).toBe(false)
    expect(
      isSettingsTabAvailable('ai-profile:gone', {
        ...loaded,
        isVaultLoaded: false,
      })
    ).toBe(true)
    expect(isSettingsTabAvailable('plugin:missing', loaded)).toBe(false)
    expect(isSettingsTabAvailable('unknown', loaded)).toBe(false)
  })

  it('titles a page by its section or entity', () => {
    expect(settingsTabTitle('llm', sources)).toBe('settings.llmTab')
    expect(settingsTabTitle('plugin:case', sources)).toBe('Text case')
    expect(settingsTabTitle('ai-profile:writer', sources)).toBe('Writer')
    expect(settingsTabTitle('ai-profile:new', sources)).toBe(
      'settings.newProfile'
    )
    expect(settingsTabTitle('ai-project:gone', sources)).toBe(
      'settings.projectsTitle'
    )
    expect(settingsTabTitle('ai-profiles', sources)).toBe(
      'settings.aiProfilesTab'
    )
  })
})
