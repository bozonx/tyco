import diacritics from '@tyco/plugin-diacritics'
import fastNote from '@tyco/plugin-fast-note'
import { describe, expect, it } from 'vitest'
import { applyPluginDefaults, resolvePluginConfig } from './plugin-config'

describe('bundled plugin config', () => {
  it('resolves current settings without reading other plugin identities', () => {
    const definition = { ...diacritics(), name: 'Diacritics' }
    const saved = applyPluginDefaults([() => definition], {
      Other: { enabled: false },
    })
    expect(saved.Other).toEqual({ enabled: false })
    expect(saved.Diacritics).toMatchObject({ enabled: true })
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
