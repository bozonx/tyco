import { getPluginState, pluginId, resolvePluginConfig } from './plugin-config'
import { pluginMessageKey, scopeConfigFields } from './plugin-resources'
import type { InputConfigItem } from '../../types'
import type { PluginIndex } from '../../types/plugins'

export interface InstalledPluginItem {
  name: string
  labelKey?: string
  label?: string
  descriptionKey?: string
  description?: string
  enabled: boolean
  error?: string
  fields: Array<InputConfigItem & { value: unknown }>
}

export function resolveInstalledPlugins(
  indexes: PluginIndex[],
  userConfig?: { plugins?: Record<string, unknown> }
): InstalledPluginItem[] {
  return indexes.map((pluginIndex) => {
    const plugin = pluginIndex()
    const pluginName = pluginId(plugin)
    const pluginState = getPluginState(plugin, userConfig?.plugins)
    let config: Record<string, unknown> = {}
    let error = plugin._loadError
    try {
      config = resolvePluginConfig(plugin, pluginState)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
    const isEnabled = pluginState.enabled !== false
    const rawFields = plugin.defaultConfig?.fields || []

    return {
      name: pluginName,
      labelKey: pluginMessageKey(pluginName, plugin.labelKey),
      label: plugin.label,
      descriptionKey: pluginMessageKey(pluginName, plugin.descriptionKey),
      description: plugin.description,
      enabled: isEnabled,
      ...(error ? { error } : {}),
      fields: scopeConfigFields(pluginName, error ? [] : rawFields).map(
        (field) => ({ ...field, value: config[field.name] })
      ),
    }
  })
}

export function getPluginTabKey(pluginName: string): string {
  return `plugin:${pluginName}`
}

export function parsePluginTabKey(tabKey: string): string | null {
  return tabKey.startsWith('plugin:') ? tabKey.slice('plugin:'.length) : null
}
