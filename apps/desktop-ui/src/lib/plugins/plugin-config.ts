import { isRecord } from '@tyco/shared/value-guards'
import { clonePluginValue, migratePluginSettings } from '@tyco/plugin-sdk'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import type { PluginEntryConfig } from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import { resolveSortableChecklist } from '@tyco/plugin-sdk'

export function pluginId(plugin: ReturnType<PluginFactory>): string {
  return plugin.id
}

/**
 * The saved entry of the plugin, a copy; a disabled one without settings when
 * there is none
 */
export function getPluginState(
  plugin: ReturnType<PluginFactory>,
  states: Record<string, unknown> = {}
): PluginEntryConfig {
  const value = states[plugin.id]
  const entry = isRecord(value) ? value : {}
  return {
    ...(entry.settingsVersion !== undefined
      ? { settingsVersion: entry.settingsVersion as number }
      : {}),
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
  state: Record<string, unknown> = {},
  savedVersion = 0
): Record<string, unknown> {
  state = migratePluginSettings(plugin.defaultConfig, state, savedVersion)
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

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

/**
 * Applies declarative preset values when a user changes a preset selector.
 * Editing a value the selected preset sets leaves that preset: the selector
 * moves to the preset without values (e.g. "Custom"), if the plugin has one.
 */
export function applyPluginPreset(
  plugin: ReturnType<PluginFactory>,
  state: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...state, ...updates }
  for (const [selector, presets] of Object.entries(
    plugin.defaultConfig?.presets ?? {}
  )) {
    const selected = next[selector]
    const preset =
      (typeof selected === 'string' || typeof selected === 'number') &&
      Object.hasOwn(presets, selected)
        ? (presets[selected] as Record<string, unknown>)
        : undefined
    if (
      Object.hasOwn(updates, selector) &&
      updates[selector] !== state[selector]
    ) {
      if (preset) Object.assign(next, clonePluginValue(preset))
      continue
    }
    const leavesPreset =
      preset !== undefined &&
      Object.keys(updates).some(
        (name) =>
          Object.hasOwn(preset, name) &&
          !sameValue(updates[name], state[name]) &&
          !sameValue(updates[name], preset[name])
      )
    if (!leavesPreset) continue
    const free = Object.entries(presets).find(
      ([, values]) => Object.keys(values).length === 0
    )?.[0]
    const option = plugin.defaultConfig?.fields
      .find((field) => field.name === selector)
      ?.options?.find((candidate) => String(candidate.id) === free)
    if (option) next[selector] = option.id
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
        ...(plugin.defaultConfig?.version !== undefined
          ? { settingsVersion: plugin.defaultConfig.version }
          : {}),
        settings: resolvePluginConfig(
          plugin,
          state.settings,
          state.settingsVersion
        ),
      }
    } catch {
      // Preserve settings for a broken package; the runtime reports the error.
    }
  }
  return result
}
