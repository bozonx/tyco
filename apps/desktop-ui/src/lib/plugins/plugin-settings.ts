import { withConfigFieldValue } from '@tyco/plugin-sdk'
import { getPluginState, resolvePluginConfig } from './plugin-config'
import { pluginMessageKey, scopeConfigFields } from './plugin-resources'
import type { InputConfigItem } from '../../types'
import type { PluginRuntimeState } from './plugin-manager'
import type { PluginFactory } from '../../types/plugins'

export interface InstalledPluginItem {
  pluginId: string
  labelKey?: string
  label?: string
  descriptionKey?: string
  description?: string
  isEnabled: boolean
  version?: string
  status?: Exclude<PluginRuntimeState['status'], 'active' | 'disabled'>
  canRestore?: boolean
  error?: string
  fields: InputConfigItem[]
}

export function resolveInstalledPlugins(
  factories: PluginFactory[],
  userConfig?: { plugins?: Record<string, unknown> },
  runtime: Record<string, PluginRuntimeState> = {}
): InstalledPluginItem[] {
  return factories.map((pluginFactory) => {
    const plugin = pluginFactory()
    const pluginId = plugin.id
    const pluginState = getPluginState(plugin, userConfig?.plugins)
    let config: Record<string, unknown> = {}
    let error = plugin._loadError ?? runtime[pluginId]?.error
    try {
      config = resolvePluginConfig(
        plugin,
        pluginState.settings,
        pluginState.settingsVersion
      )
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
    const isEnabled = pluginState.isEnabled
    const status = isEnabled ? runtime[pluginId]?.status : undefined
    const rawFields = plugin.defaultConfig?.fields || []

    return {
      pluginId,
      labelKey: pluginMessageKey(pluginId, plugin.labelKey),
      label: plugin.label,
      descriptionKey: pluginMessageKey(pluginId, plugin.descriptionKey),
      description: plugin.description,
      isEnabled,
      version: plugin.version,
      status: status === 'active' || status === 'disabled' ? undefined : status,
      canRestore: plugin._canRestore ?? false,
      ...(error ? { error } : {}),
      fields: scopeConfigFields(pluginId, error ? [] : rawFields).map((field) =>
        withConfigFieldValue(field, config[field.name])
      ),
    }
  })
}
