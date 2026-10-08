import { clonePluginValue } from '@tyco/plugin-sdk'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import type { PluginIndex } from '../../types/plugins'
import { resolveSortableChecklist } from './sortable-checklist'

export function pluginId(plugin: ReturnType<PluginIndex>): string {
  return plugin.id ?? plugin.name
}

export function getPluginState(
  plugin: ReturnType<PluginIndex>,
  states: Record<string, unknown> = {}
): Record<string, unknown> {
  const value =
    states[pluginId(plugin)] ??
    plugin.legacyIds
      ?.map((id) => states[id])
      .find((value) => value !== undefined)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (clonePluginValue(value) as Record<string, unknown>)
    : {}
}

function validField(field: InputConfigItem, value: unknown): boolean {
  if (field.type === 'checkbox') return typeof value === 'boolean'
  if (field.type === 'select')
    return Boolean(field.options?.some((option) => option.id === value))
  if (field.type === 'sortable-checklist') return Array.isArray(value)
  // Some numeric settings deliberately use a text field.
  return (
    typeof value === 'string' ||
    (typeof field.defaultValue === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value))
  )
}

/** Migration and defaults are applied once, outside the settings component. */
export function resolvePluginConfig(
  plugin: ReturnType<PluginIndex>,
  state: Record<string, unknown> = {}
): Record<string, unknown> {
  const copy = clonePluginValue(state)
  delete copy.enabled
  delete copy._configVersion
  const version =
    typeof state._configVersion === 'number' ? state._configVersion : 0
  const migrated = plugin.migrateConfig?.(copy, version) ?? copy
  const config = { ...migrated }
  for (const field of plugin.defaultConfig?.fields ?? []) {
    const value = config[field.name]
    if (field.type === 'sortable-checklist') {
      config[field.name] = resolveSortableChecklist(
        value,
        field.options,
        field.defaultValue
      )
    } else if (!validField(field, value)) {
      config[field.name] = clonePluginValue(field.defaultValue)
    }
  }
  return clonePluginValue(plugin.normalizeConfig?.(config) ?? config)
}

export function applyPluginDefaults(
  indexes: PluginIndex[],
  states: Record<string, unknown> = {}
): Record<string, unknown> {
  const result = clonePluginValue(states)
  for (const factory of indexes) {
    try {
      const plugin = factory()
      if (plugin._loadError) continue
      const state = getPluginState(plugin, states)
      const config = resolvePluginConfig(plugin, state)
      for (const legacy of plugin.legacyIds ?? [])
        if (legacy !== pluginId(plugin)) delete result[legacy]
      result[pluginId(plugin)] = {
        ...config,
        enabled: state.enabled !== false,
        _configVersion: plugin.configVersion ?? 1,
      }
    } catch {
      // Preserve settings for a broken package; the runtime reports the error.
    }
  }
  return result
}
