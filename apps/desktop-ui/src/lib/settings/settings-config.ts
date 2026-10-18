import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  normalizeAppearance,
  SHORTCUT_SLOT_KEYS,
  type UserConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { normalizeCommands } from '../commands/command-config'
import { normalizeLlmConfig } from '../llm/llm-config'
import { AUTO_LANGUAGE_VALUE } from '../locale/language'
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
const stringOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** Keeps the AI tasks that have an id and a name or a rule */
function normalizeAiTasks(value: unknown): UserConfig['aiTasks'] {
  const source = recordOf(value)
  const tasks: UserConfig['aiTasks'] = {}
  for (const key of SHORTCUT_SLOT_KEYS) {
    const task = source[key]
    if (!isRecord(task)) continue
    const name = stringOf(task.name)
    const rule = stringOf(task.rule)
    if (!stringOf(task.id).trim() || (!name.trim() && !rule.trim())) continue
    tasks[key] = { id: stringOf(task.id), name, rule }
  }
  return tasks
}

/** Normalizes the input without changing the persisted source object. */
export function createSettingsConfig(deps: SettingsConfigDependencies) {
  function prepare(value: unknown): UserConfig {
    // Clone serialized settings before normalizing; Vue drafts may be reactive.
    const cloned: unknown = JSON.parse(
      JSON.stringify(isRecord(value) ? value : DEFAULT_USER_CONFIG)
    )
    const input = recordOf(cloned)
    const language = recordOf(input.language)
    // Only what the shared schema cannot express; `normalizeUserConfig`
    // repairs field types, enums and defaults, and drops unknown fields.
    const next: Record<string, unknown> = {
      ...input,
      appearance: normalizeAppearance(input.appearance ?? deps.appearance()),
      language: {
        ui: stringOf(language.ui) || AUTO_LANGUAGE_VALUE,
        user: stringOf(language.user) || AUTO_LANGUAGE_VALUE,
      },
      commands: normalizeCommands(input.commands),
      llm: normalizeLlmConfig(input.llm),
      aiTasks: normalizeAiTasks(input.aiTasks),
      plugins: applyPluginDefaults(
        deps.pluginFactories(),
        recordOf(input.plugins)
      ),
    }
    return normalizeUserConfig(next)
  }
  return { prepare }
}
