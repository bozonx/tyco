import { clonePluginValue } from '@tyco/plugin-sdk'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import type { PluginIndex } from '../../types/plugins'
import { resolveSortableChecklist } from './sortable-checklist'

export function pluginId(plugin: ReturnType<PluginIndex>): string {
  return plugin.id
}

export function getPluginState(
  plugin: ReturnType<PluginIndex>,
  states: Record<string, unknown> = {}
): Record<string, unknown> {
  const value = states[plugin.id]
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

/** Resolves declared fields only; plugins never read another identity. */
export function resolvePluginConfig(
  plugin: ReturnType<PluginIndex>,
  state: Record<string, unknown> = {}
): Record<string, unknown> {
  const presetDefaults: Record<string, unknown> = {}
  for (const [selector, presets] of Object.entries(
    plugin.defaultConfig?.presets ?? {}
  )) {
    const selected = state[selector]
    if (typeof selected === 'string' && Object.hasOwn(presets, selected))
      Object.assign(presetDefaults, presets[selected])
  }
  const config: Record<string, unknown> = {}
  for (const field of plugin.defaultConfig?.fields ?? []) {
    const value = state[field.name]
    if (field.type === 'sortable-checklist') {
      config[field.name] = resolveSortableChecklist(
        value,
        field.options,
        field.defaultValue ?? presetDefaults[field.name]
      )
    } else {
      config[field.name] = clonePluginValue(
        validField(field, value)
          ? value
          : (presetDefaults[field.name] ?? field.defaultValue)
      )
    }
  }
  return clonePluginValue(config)
}

/** Applies declarative preset values when a user changes a preset selector. */
export function applyPluginPreset(
  plugin: ReturnType<PluginIndex>,
  state: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...state, ...updates }
  for (const [selector, presets] of Object.entries(
    plugin.defaultConfig?.presets ?? {}
  )) {
    if (
      !Object.hasOwn(updates, selector) ||
      updates[selector] === state[selector]
    )
      continue
    const selected = updates[selector]
    if (typeof selected === 'string' && Object.hasOwn(presets, selected))
      Object.assign(next, clonePluginValue(presets[selected]))
  }
  return clonePluginValue(next)
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
      result[pluginId(plugin)] = { ...config, enabled: state.enabled !== false }
    } catch {
      // Preserve settings for a broken package; the runtime reports the error.
    }
  }
  return result
}
