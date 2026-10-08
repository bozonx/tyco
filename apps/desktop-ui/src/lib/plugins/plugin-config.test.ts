import { describe, expect, it } from 'vitest'

import {
  applyPluginDefaults,
  getPluginState,
  resolvePluginConfig,
} from './plugin-config'

const plugin = {
  name: 'Example',
  legacyIds: ['Old'],
  defaultConfig: {
    fields: [
      {
        name: 'mode',
        type: 'select' as const,
        defaultValue: 'safe',
        options: [{ id: 'safe' }, { id: 'custom' }],
      },
      { name: 'enabledFeature', type: 'checkbox' as const, defaultValue: true },
    ],
  },
  init: () => {},
}
describe('plugin config', () => {
  it('validates saved values and excludes host metadata', () => {
    expect(
      resolvePluginConfig(plugin, {
        mode: 'invalid',
        enabledFeature: 'yes',
        enabled: false,
        _configVersion: 1,
      })
    ).toEqual({ mode: 'safe', enabledFeature: true })
  })
  it('migrates before applying defaults and preserves disabled state', () => {
    const migrated = {
      ...plugin,
      migrateConfig: (config: Record<string, unknown>) => ({
        ...config,
        mode: config.oldMode,
      }),
    }
    expect(
      applyPluginDefaults([() => migrated], {
        Example: { oldMode: 'custom', enabled: false },
      }).Example
    ).toMatchObject({ mode: 'custom', enabled: false, _configVersion: 1 })
  })
  it('resolves a legacy identity without overwriting saved data', () => {
    const states = { Old: { mode: 'custom' } }
    const state = getPluginState(plugin, states)
    state.mode = 'safe'
    expect(states.Old.mode).toBe('custom')
    expect(applyPluginDefaults([() => plugin], states).Example).toMatchObject({
      mode: 'custom',
    })
  })
  it('preserves saved settings when a migration fails and normalizes other plugins', () => {
    const broken = {
      ...plugin,
      name: 'Broken',
      migrateConfig: () => {
        throw new Error('bad migration')
      },
    }
    const saved = { Broken: { mode: 'custom', enabled: false } }
    const result = applyPluginDefaults([() => broken, () => plugin], saved)
    expect(result.Broken).toEqual(saved.Broken)
    expect(result.Example).toMatchObject({ mode: 'safe', enabledFeature: true })
  })
})
