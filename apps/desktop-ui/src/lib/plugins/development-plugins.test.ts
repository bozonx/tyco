import { describe, expect, it } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

import { isPluginVisible, runtimePluginConfig } from './development-plugins'

const DEVELOPMENT_PLUGIN_IDS = [
  'Diacritics',
  'TextCase',
  'WebFormatter',
  'FastNote',
]

describe('development plugins', () => {
  it.each(DEVELOPMENT_PLUGIN_IDS)(
    'hides %s unless development is enabled',
    (id) => {
      expect(isPluginVisible(id)).toBe(false)
      expect(isPluginVisible(id, false)).toBe(false)
      expect(isPluginVisible(id, true)).toBe(true)
    }
  )

  it('keeps other plugins visible', () => {
    expect(isPluginVisible('SearchInInternet')).toBe(true)
    expect(isPluginVisible('Installed')).toBe(true)
  })

  it('suppresses hidden plugins without changing saved preferences', () => {
    const config = structuredClone(DEFAULT_USER_CONFIG)
    config.plugins.FastNote = {
      isEnabled: true,
      settings: { folder: '/notes' },
    }
    const original = structuredClone(config)
    const effective = runtimePluginConfig(config)
    for (const id of DEVELOPMENT_PLUGIN_IDS)
      expect(effective.plugins[id].isEnabled).toBe(false)
    expect(effective.plugins.FastNote.settings).toEqual({ folder: '/notes' })
    expect(config).toEqual(original)
    config.isInDevelopment = true
    expect(runtimePluginConfig(config)).toBe(config)
    expect(config.plugins.FastNote.isEnabled).toBe(true)
  })
})
