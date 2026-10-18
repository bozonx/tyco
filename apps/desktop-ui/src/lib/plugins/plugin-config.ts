import { clonePluginValue } from '@tyco/plugin-sdk'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import type { PluginEntryConfig } from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import { resolveSortableChecklist } from '@tyco/plugin-sdk'

export function pluginId(plugin: ReturnType<PluginFactory>): string {
  return plugin.id
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The saved entry of the plugin, a copy; a disabled one without settings when there is none */
export function getPluginState(
  plugin: ReturnType<PluginFactory>,
  states: Record<string, unknown> = {}
): PluginEntryConfig {
  const value = states[plugin.id]
  const entry = isRecord(value) ? value : {}
  return {
    isEnabled: entry.isEnabled === true,
    settings: isRecord(entry.settings)
      ? (clonePluginValue(entry.settings) as Record<string, unknown>)
      : {},
  }
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
  plugin: ReturnType<PluginFactory>,
  state: Record<string, unknown> = {}
): Record<string, unknown> {
  const presetDefaults: Record<string, unknown> = {}
  for (const [selector, presets] of Object.entries(
    plugin.defaultConfig?.presets ?? {}
  )) {
    const selected = state[selector]
    if (
      (typeof selected === 'string' || typeof selected === 'number') &&
      Object.hasOwn(presets, selected)
    )
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
  plugin: ReturnType<PluginFactory>,
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
    if (
      (typeof selected === 'string' || typeof selected === 'number') &&
      Object.hasOwn(presets, selected)
    )
      Object.assign(next, clonePluginValue(presets[selected]))
  }
  return clonePluginValue(next)
}

export function applyPluginDefaults(
  factories: PluginFactory[],
  states: Record<string, unknown> = {}
): Record<string, unknown> {
  const result = clonePluginValue(states)
  for (const factory of factories) {
    try {
      const plugin = factory()
      if (plugin._loadError) continue
      const state = getPluginState(plugin, states)
      result[pluginId(plugin)] = {
        isEnabled: state.isEnabled,
        settings: resolvePluginConfig(plugin, state.settings),
      }
    } catch {
      // Preserve settings for a broken package; the runtime reports the error.
    }
  }
  return result
}
