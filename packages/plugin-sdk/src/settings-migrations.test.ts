import { describe, expect, it } from 'vitest'
import {
  migratePluginSettings,
  validateSettingsMigrations,
} from './settings-migrations.js'
import type { PluginConfig } from './plugin.js'

const config: PluginConfig = {
  fields: [{ name: 'current', type: 'text', defaultValue: '' }],
  version: 2,
  migrations: [
    { fromVersion: 0, rename: { legacy: 'intermediate' } },
    { fromVersion: 1, rename: { intermediate: 'current' } },
  ],
}
describe('plugin settings migrations', () => {
  it('applies only outstanding migrations without mutating persisted settings', () => {
    const saved = { legacy: 'saved' }
    expect(migratePluginSettings(config, saved)).toEqual({ current: 'saved' })
    expect(saved).toEqual({ legacy: 'saved' })
    expect(migratePluginSettings(config, { intermediate: 'saved' }, 1)).toEqual(
      { current: 'saved' }
    )
    expect(migratePluginSettings(config, { current: 'saved' }, 2)).toEqual({
      current: 'saved',
    })
  })
  it('preserves explicitly saved new values and refuses downgrades', () => {
    expect(
      migratePluginSettings(config, { legacy: 'old', current: 'new' })
    ).toEqual({ current: 'new' })
    expect(() => migratePluginSettings(config, {}, 3)).toThrow('not supported')
  })
  it('requires a complete migration chain', () => {
    expect(() =>
      validateSettingsMigrations(config as unknown as Record<string, unknown>)
    ).not.toThrow()
    expect(() =>
      validateSettingsMigrations({ ...config, version: 3 })
    ).toThrow()
    expect(() =>
      validateSettingsMigrations({
        ...config,
        migrations: [
          { fromVersion: 1, rename: {} },
          { fromVersion: 0, rename: {} },
        ],
      })
    ).toThrow()
  })
  it.each(['notesPath', 'constructor'])(
    'rejects renames to protected fields: %s',
    (target) => {
      expect(() =>
        validateSettingsMigrations(
          {
            version: 1,
            migrations: [{ fromVersion: 0, rename: { old: target } }],
          },
          'notesPath'
        )
      ).toThrow()
    }
  )
})
