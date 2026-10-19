import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  normalizeAppearance,
  type UserConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { withoutEmptyTasks } from '../ai-tasks/ai-task-library'
import { applyPluginDefaults } from '../plugins/plugin-config'
import type { PluginFactory } from '../../types/plugins'

export interface SettingsConfigDependencies {
  pluginFactories: () => PluginFactory[]
  appearance: () => AppearanceSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
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
    const config = normalizeUserConfig({
      ...input,
      appearance: normalizeAppearance(input.appearance ?? deps.appearance()),
      plugins: applyPluginDefaults(
        deps.pluginFactories(),
        recordOf(input.plugins)
      ),
    })
    // a task being typed in is not a change until it has a name or a rule
    return { ...config, ...withoutEmptyTasks(config) }
  }
  return { prepare }
}
