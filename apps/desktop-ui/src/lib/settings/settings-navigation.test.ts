import { describe, expect, it } from 'vitest'

import {
  buildSettingsNavigation,
  isSettingsTabAvailable,
  parseSettingsTab,
  settingsNavigationItemId,
  settingsTabTitle,
} from './settings-navigation'

const sources = {
  translate: (key: string) => key,
  isInDevelopment: true,
  profiles: [{ id: 'writer', name: 'Writer' }],
  projects: [{ id: 'notes', name: 'Notes', isExternal: true }],
  plugins: [{ pluginId: 'case', label: 'Text case', isEnabled: false }],
}

describe('settings navigation', () => {
  it('hides profile navigation and rejects profile and project pages outside development mode', () => {
    const hiddenSources = {
      ...sources,
      isInDevelopment: false,
      isVaultLoaded: false,
    }
    expect(
      buildSettingsNavigation(hiddenSources)
        .flatMap((group) => group.items)
        .some((item) => item.id === 'ai-profiles')
    ).toBe(false)
    for (const tab of [
      'ai-profiles',
      'ai-profiles:overview',
      'ai-profile:new',
      'ai-profile:writer',
      'ai-project:new',
      'ai-project:notes',
      'commands',
      'launcher-commands',
      'chat',
      'correction',
      'editor',
    ]) {
      expect(isSettingsTabAvailable(tab, hiddenSources)).toBe(false)
    }
    expect(isSettingsTabAvailable('general', hiddenSources)).toBe(true)
    expect(
      buildSettingsNavigation(hiddenSources)
        .flatMap((group) => group.items)
        .some((item) => item.id === 'editor')
    ).toBe(false)
    expect(
      buildSettingsNavigation(hiddenSources)
        .flatMap((group) => group.items)
        .some((item) => item.id === 'chat')
    ).toBe(false)
    expect(
      buildSettingsNavigation(hiddenSources)
        .flatMap((group) => group.items)
        .some((item) => item.id === 'correction')
    ).toBe(false)
  })

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

  it('groups the sections and lists each plugin after all plugins', () => {
    const groups = buildSettingsNavigation(sources)
    expect(
      groups.map((group) => [group.label, group.items.map((item) => item.id)])
    ).toEqual([
      [undefined, ['general', 'editor', 'global-actions', 'accessibility']],
      [
        'settings.aiCategory',
        ['llm', 'stt', 'chat', 'translations', 'correction', 'ai-profiles'],
      ],
      [
        'settings.actionsCategory',
        ['main-actions', 'tasks', 'languages', 'launcher-commands', 'commands'],
      ],
      ['settings.pluginsTab', ['plugins', 'plugin:case']],
    ])
    const [allPlugins, plugin] = groups.at(-1)!.items
    expect(groups[1].items.find((item) => item.id === 'stt')?.name).toBe(
      'settings.sttNavTab'
    )
    expect(allPlugins.name).toBe('settings.allPluginsTab')
    expect(plugin).toMatchObject({
      name: 'Text case',
      status: 'settings.pluginStatusOff',
      isEnabled: false,
    })
    expect(plugin.nested).toBeUndefined()
  })

  it('leaves an enabled plugin without a status', () => {
    const [, plugin] = buildSettingsNavigation({
      ...sources,
      plugins: [{ pluginId: 'case', label: 'Text case', isEnabled: true }],
    }).at(-1)!.items
    expect(plugin.status).toBeUndefined()
  })

  it('marks the navigation item of a page', () => {
    expect(settingsNavigationItemId('llm')).toBe('llm')
    expect(settingsNavigationItemId('plugin:case')).toBe('plugin:case')
    expect(settingsNavigationItemId('ai-profiles:overview')).toBe('ai-profiles')
    expect(settingsNavigationItemId('ai-profile:new')).toBe('ai-profiles')
    expect(settingsNavigationItemId('ai-project:notes')).toBe('ai-profiles')
    expect(settingsNavigationItemId('nope')).toBeUndefined()
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
    expect(settingsTabTitle('stt', sources)).toBe('settings.sttTab')
    expect(settingsTabTitle('plugins', sources)).toBe('settings.pluginsTab')
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
