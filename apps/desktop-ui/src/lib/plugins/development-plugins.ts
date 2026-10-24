import type { UserConfig } from '@tyco/shared'

const DEVELOPMENT_PLUGIN_IDS = new Set([
  'Diacritics',
  'TextCase',
  'WebFormatter',
  'FastNote',
])

export function isPluginVisible(
  pluginId: string,
  isInDevelopment?: boolean
): boolean {
  return Boolean(isInDevelopment) || !DEVELOPMENT_PLUGIN_IDS.has(pluginId)
}

/** Hide contributions without changing the user's saved plugin settings. */
export function runtimePluginConfig(config: UserConfig): UserConfig {
  if (config.isInDevelopment) return config
  const plugins = { ...config.plugins }
  for (const pluginId of DEVELOPMENT_PLUGIN_IDS) {
    plugins[pluginId] = {
      ...(plugins[pluginId] ?? { settings: {} }),
      isEnabled: false,
    }
  }
  return { ...config, plugins }
}
