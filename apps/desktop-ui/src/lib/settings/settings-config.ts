import { isRecord } from '@tyco/shared/value-guards'
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
    const aiTasks = withoutEmptyTasks(config.aiTasks)
    const taskIds = new Set(aiTasks.items.map((task) => task.id))
    const mainActions = Object.fromEntries(
      Object.entries(config.mainActions).filter(
        ([, slot]) => slot.type !== 'aiTask' || taskIds.has(slot.taskId)
      )
    )
    return { ...config, aiTasks, mainActions }
  }
  return { prepare }
}
