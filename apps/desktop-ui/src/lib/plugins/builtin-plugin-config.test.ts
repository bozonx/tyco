import searchInInternet from '@tyco/plugin-search-in-internet'
import textCase from '@tyco/plugin-text-case'
import webFormatter from '@tyco/plugin-web-formatter'
import diacritics from '@tyco/plugin-diacritics'
import fastNote from '@tyco/plugin-fast-note'
import { describe, expect, it } from 'vitest'
import { applyPluginDefaults, resolvePluginConfig } from './plugin-config'

describe('bundled plugin config', () => {
  it('disables every bundled plugin by default and preserves explicit choices', () => {
    const indexes = [
      searchInInternet,
      diacritics,
      textCase,
      webFormatter,
      fastNote,
    ].map((factory) => () => {
      const plugin = factory()
      return { ...plugin, name: plugin.id }
    })
    const defaults = applyPluginDefaults(indexes)
    for (const factory of indexes) {
      expect(defaults[factory().id]).toMatchObject({
        isEnabled: false,
        settings: {},
      })
    }
    expect(
      applyPluginDefaults(indexes, {
        WebFormatter: { isEnabled: true, settings: {} },
      }).WebFormatter
    ).toMatchObject({ isEnabled: true, settings: {} })
  })
  it('resolves current settings without reading other plugin identities', () => {
    const definition = { ...diacritics(), name: 'Diacritics' }
    const saved = applyPluginDefaults([() => definition], {
      Other: { isEnabled: false, settings: {} },
    })
    expect(saved.Other).toEqual({ isEnabled: false, settings: {} })
    expect(saved.Diacritics).toMatchObject({ isEnabled: false, settings: {} })
    const config = resolvePluginConfig(definition)
    expect(
      (config.actions as Array<{ id: string; enabled: boolean }>)
        .filter((item) => item.enabled)
        .map((item) => item.id)
    ).toEqual(['acute'])
  })
  it('uses declared note fields and preserves current saved values', () => {
    const definition = { ...fastNote(), name: 'FastNote' }
    expect(
      resolvePluginConfig(definition, {
        preset: 'obsidian_daily',
        pathToNotes: '/vault',
        saveMode: 'append',
      })
    ).toMatchObject({
      preset: 'obsidian_daily',
      pathToNotes: '/vault',
      saveMode: 'append',
    })
  })
})
