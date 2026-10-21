import { describe, expect, it } from 'vitest'
import {
  applyPluginDefaults,
  applyPluginPreset,
  getPluginState,
  resolvePluginConfig,
} from './plugin-config'

const plugin = {
  id: 'Example',
  name: 'Example',
  version: '1.0.0',
  apiVersion: 2,
  capabilities: [],
  defaultLocale: 'en_US',
  locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
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
  it('validates fields and excludes undeclared data and host metadata', () => {
    expect(
      resolvePluginConfig(plugin, {
        mode: 'invalid',
        enabledFeature: 'yes',
        enabled: false,
        unknown: 'private',
      })
    ).toEqual({ mode: 'safe', enabledFeature: true })
  })
  it('preserves disabled state without writing migration metadata', () => {
    expect(
      applyPluginDefaults([() => plugin], {
        Example: { isEnabled: false, settings: { mode: 'custom' } },
      }).Example
    ).toEqual({
      isEnabled: false,
      settings: { mode: 'custom', enabledFeature: true },
    })
  })
  it('applies declared preset defaults on selection changes without a migration callback', () => {
    const withPresets = {
      ...plugin,
      defaultConfig: {
        ...plugin.defaultConfig,
        presets: {
          mode: {
            safe: { enabledFeature: true },
            custom: { enabledFeature: false },
          },
        },
      },
    }
    const next = applyPluginPreset(
      withPresets,
      { mode: 'safe', enabledFeature: true },
      { mode: 'custom' }
    )
    expect(next).toMatchObject({ mode: 'custom', enabledFeature: false })
    expect(resolvePluginConfig(withPresets, { mode: 'custom' })).toMatchObject({
      mode: 'custom',
      enabledFeature: false,
    })
  })
  it('reads only its current identity and returns detached settings', () => {
    const states = {
      Other: { isEnabled: true, settings: { mode: 'custom' } },
      Example: { isEnabled: true, settings: { mode: 'safe' } },
    }
    getPluginState(plugin, states).settings.mode = 'custom'
    expect(states.Example.settings.mode).toBe('safe')
    expect(getPluginState(plugin, { Other: states.Other })).toEqual({
      isEnabled: false,
      settings: {},
    })
    expect(applyPluginDefaults([() => plugin], states).Other).toEqual(
      states.Other
    )
  })
})

it('resolves and applies presets with numeric selector IDs', () => {
  const numeric = {
    ...plugin,
    defaultConfig: {
      fields: [
        {
          name: 'mode',
          type: 'select' as const,
          defaultValue: 0,
          options: [{ id: 0 }, { id: 1 }],
        },
        {
          name: 'enabledFeature',
          type: 'checkbox' as const,
          defaultValue: false,
        },
      ],
      presets: { mode: { '1': { enabledFeature: true } } },
    },
  }
  expect(resolvePluginConfig(numeric, { mode: 1 })).toEqual({
    mode: 1,
    enabledFeature: true,
  })
  expect(
    applyPluginPreset(numeric, { mode: 0, enabledFeature: false }, { mode: 1 })
  ).toEqual({ mode: 1, enabledFeature: true })
})

it('persists migrated settings and their version without losing newer settings on downgrade', () => {
  const upgraded = {
    ...plugin,
    defaultConfig: {
      fields: [{ name: 'current', type: 'text' as const, defaultValue: '' }],
      version: 1,
      migrations: [{ fromVersion: 0, rename: { legacy: 'current' } }],
    },
  }
  const saved = { Example: { isEnabled: false, settings: { legacy: 'saved' } } }
  const prepared = applyPluginDefaults([() => upgraded], saved)
  expect(prepared.Example).toEqual({
    isEnabled: false,
    settingsVersion: 1,
    settings: { current: 'saved' },
  })
  expect(saved.Example.settings).toEqual({ legacy: 'saved' })
  expect(applyPluginDefaults([() => upgraded], prepared)).toEqual(prepared)
  expect(applyPluginDefaults([() => plugin], prepared)).toEqual(prepared)
})
