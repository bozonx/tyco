import type { InputConfigItem } from '../../types'
import type { PluginIndex } from '../../types/plugins'

export interface InstalledPluginItem {
  name: string
  labelKey?: string
  label?: string
  descriptionKey?: string
  description?: string
  enabled: boolean
  fields: Array<InputConfigItem & { value: unknown }>
}

export function resolveInstalledPlugins(
  indexes: PluginIndex[],
  userConfig?: { plugins?: Record<string, unknown> }
): InstalledPluginItem[] {
  return indexes.map((pluginIndex) => {
    const plugin = pluginIndex()
    const pluginName = plugin.name
    const pluginState =
      (userConfig?.plugins?.[pluginName] as Record<string, unknown>) || {}
    const isEnabled = pluginState.enabled !== false
    const rawFields = plugin.defaultConfig?.fields || []

    return {
      name: pluginName,
      labelKey: plugin.labelKey,
      label: plugin.label,
      descriptionKey: plugin.descriptionKey,
      description: plugin.description,
      enabled: isEnabled,
      fields: rawFields.map((field) => ({
        ...field,
        value: pluginState[field.name],
      })),
    }
  })
}

export function getPluginTabKey(pluginName: string): string {
  return `plugin:${pluginName}`
}

export function parsePluginTabKey(tabKey: string): string | null {
  return tabKey.startsWith('plugin:') ? tabKey.slice('plugin:'.length) : null
}
