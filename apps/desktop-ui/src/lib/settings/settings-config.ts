import { isRecord } from '@tyco/shared/value-guards'
import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  normalizeAppearance,
  type UserConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { applyPluginDefaults } from '../plugins/plugin-config'
import type { PluginFactory } from '../../types/plugins'

export interface SettingsConfigDependencies {
  pluginFactories: () => PluginFactory[]
  appearance: () => AppearanceSettings
}

const recordOf = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

/** Normalizes the input without changing the persisted source object. */
export function createSettingsConfig(deps: SettingsConfigDependencies) {
  function prepare(value: unknown): UserConfig {
    // Clone serialized settings before normalizing; Vue drafts may be reactive.
    const cloned: unknown = JSON.parse(
      JSON.stringify(isRecord(value) ? value : DEFAULT_USER_CONFIG)
    )
    const input = recordOf(cloned)
    // `normalizeUserConfig` applies the rules the backend applies; here only
    // what the webview knows: the cached appearance and the plugin defaults
    return normalizeUserConfig({
      ...input,
      appearance: normalizeAppearance(input.appearance ?? deps.appearance()),
      plugins: applyPluginDefaults(
        deps.pluginFactories(),
        recordOf(input.plugins)
      ),
    })
  }
  return { prepare }
}
