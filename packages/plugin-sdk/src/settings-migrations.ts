import type { PluginConfig } from './plugin.js'
import { clonePluginValue } from './config.js'
import { MAX_SETTINGS_RENAMES, hasSettingNameFormat } from './package-format.js'
import { isRecord } from './value-guards.js'

/**
 * Declarative migrations cannot introduce values or authorize a notes
 * directory.
 */
export function validateSettingsMigrations(
  config: Record<string, unknown>,
  notesDirectoryField?: string
): void {
  const version = config.version === undefined ? 0 : config.version
  const migrations = config.migrations === undefined ? [] : config.migrations
  if (
    !Number.isSafeInteger(version) ||
    Number(version) < 0 ||
    Number(version) > 64 ||
    !Array.isArray(migrations) ||
    migrations.length !== version
  )
    throw new Error('Invalid plugin settings version or migration chain')
  for (const [index, migration] of migrations.entries()) {
    if (
      !isRecord(migration) ||
      migration.fromVersion !== index ||
      !isRecord(migration.rename) ||
      Object.keys(migration.rename).length > MAX_SETTINGS_RENAMES
    )
      throw new Error('Invalid plugin settings migration')
    const targets = new Set<string>()
    for (const [source, target] of Object.entries(migration.rename)) {
      const validName = (name: unknown): name is string =>
        typeof name === 'string' &&
        hasSettingNameFormat(name) &&
        !['__proto__', 'constructor', 'prototype'].includes(name)
      if (
        !validName(source) ||
        !validName(target) ||
        source === target ||
        targets.has(target) ||
        Object.hasOwn(migration.rename, target) ||
        source === notesDirectoryField ||
        target === notesDirectoryField
      )
        throw new Error('Invalid plugin settings rename')
      targets.add(target)
    }
  }
}

/** Never mutate saved values; downgrades preserve the user's newer settings. */
export function migratePluginSettings(
  config: PluginConfig | undefined,
  settings: Record<string, unknown>,
  savedVersion = 0
): Record<string, unknown> {
  const version = config?.version ?? 0
  if (
    !Number.isSafeInteger(savedVersion) ||
    savedVersion < 0 ||
    savedVersion > version
  )
    throw new Error('Plugin settings version is not supported')
  const migrated = clonePluginValue(settings)
  for (const migration of config?.migrations ?? []) {
    if (migration.fromVersion < savedVersion) continue
    for (const [source, target] of Object.entries(migration.rename)) {
      if (Object.hasOwn(migrated, source)) {
        if (!Object.hasOwn(migrated, target))
          migrated[target] = migrated[source]
        delete migrated[source]
      }
    }
  }
  return migrated
}
