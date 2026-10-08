import diacritics from '@tyco/plugin-diacritics'
import fastNote from '@tyco/plugin-fast-note'
import { describe, expect, it } from 'vitest'

import {
  applyPluginDefaults,
  getPluginState,
  resolvePluginConfig,
} from './plugin-config'

describe('bundled plugin config compatibility', () => {
  it('preserves a legacy diacritic identity, disabled state and language profile', () => {
    const definition = { ...diacritics(), name: 'Diacritics' }
    const states = { 'Russian Stress': { enabled: false, profile: 'spanish' } }
    const state = getPluginState(definition, states)
    expect(state.enabled).toBe(false)
    const config = resolvePluginConfig(definition, state)
    expect(
      (config.actions as Array<{ id: string; enabled: boolean }>)
        .filter((item) => item.enabled)
        .map((item) => item.id)
    ).toEqual(['acute', 'diaeresis', 'tilde'])
    const saved = applyPluginDefaults([() => definition], states)
    expect(saved['Russian Stress']).toBeUndefined()
    expect(saved.Diacritics).toMatchObject({
      enabled: false,
      _configVersion: 1,
    })
  })
  it('uses the selected note preset before generic field defaults', () => {
    const definition = { ...fastNote(), name: 'FastNote' }
    const config = resolvePluginConfig(definition, {
      preset: 'obsidian_daily',
      pathToNotes: '/vault',
    })
    expect(config).toMatchObject({
      saveMode: 'append',
      fileNameTemplate: '{YYYY}-{MM}-{DD}.md',
      contentTemplate: '- **{HH}:{mm}**: {content}',
      pathToNotes: '/vault',
    })
  })
})
