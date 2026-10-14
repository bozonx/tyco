import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  normalizeAppearance,
  type UserConfig,
  type MainActionConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { normalizeMainActions } from '../action-menu/main-actions'
import { normalizeCommands } from '../commands/command-config'
import { normalizeLlmConfig } from '../llm/llm-config'
import { AUTO_LANGUAGE_VALUE } from '../locale/language'
import { applyPluginDefaults } from '../plugins/plugin-config'
import { normalizeShortcutSlots } from '../shortcut-slots/shortcut-slots'
import { normalizeSttConfig } from '../stt/stt-config'
import type { PluginFactory } from '../../types/plugins'

export interface SettingsConfigDependencies {
  resolveMainActions: (
    actions: (MainActionConfig | null)[],
    registrations: string[]
  ) => (MainActionConfig | null)[]
  getRegisteredActions: () => { id?: string }[]
  pluginFactories: () => PluginFactory[]
  appearance: () => AppearanceSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const recordOf = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}
const stringOf = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
const stringRecordOf = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(recordOf(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

function normalizeAiTasks(value: unknown): UserConfig['aiTasks'] {
  const source: unknown[] = Array.isArray(value) ? value : []
  return normalizeShortcutSlots(source).map((task) => {
    if (!isRecord(task)) return null
    const name = stringOf(task.name)
    const rule = stringOf(task.rule)
    if (!stringOf(task.id).trim() || (!name.trim() && !rule.trim())) return null
    return { id: stringOf(task.id), name, rule }
  })
}

/** Normalizes the input without changing the persisted source object. */
export function createSettingsConfig(deps: SettingsConfigDependencies) {
  function prepare(value: unknown): UserConfig {
    // Clone serialized settings before normalizing; Vue drafts may be reactive.
    const cloned: unknown = JSON.parse(
      JSON.stringify(isRecord(value) ? value : DEFAULT_USER_CONFIG)
    )
    const input = recordOf(cloned)
    const defaults = DEFAULT_USER_CONFIG
    const translation = recordOf(input.translation)
    const insertion = recordOf(input.windowInsertion)
    const selectionHotkeys = recordOf(input.selectionHotkeys)
    const registrationState = recordOf(input.registrationState)
    const registrations = stringsOf(registrationState.reviewedMainActionIds)
    const commands = normalizeCommands(input.commands)
    // Only what the shared schema cannot express; `normalizeUserConfig`
    // repairs field types, enums and defaults, and drops unknown fields.
    const next: Record<string, unknown> = {
      ...input,
      appearance: normalizeAppearance(input.appearance ?? deps.appearance()),
      hotkeys: { ...defaults.hotkeys, ...stringRecordOf(input.hotkeys) },
      selectionHotkeys: {
        correction: stringOf(
          selectionHotkeys.correction,
          defaults.selectionHotkeys.correction ?? ''
        ),
      },
      windowInsertion: {
        ...insertion,
        xdotoolBin:
          stringOf(insertion.xdotoolBin) || defaults.windowInsertion.xdotoolBin,
        ydotoolBin:
          stringOf(insertion.ydotoolBin) || defaults.windowInsertion.ydotoolBin,
      },
      appLanguage: stringOf(input.appLanguage) || AUTO_LANGUAGE_VALUE,
      userLanguage: stringOf(input.userLanguage) || AUTO_LANGUAGE_VALUE,
      translation: {
        ...recordOf(input.translation),
        targetLanguages: normalizeShortcutSlots<unknown>(
          Array.isArray(translation.targetLanguages)
            ? translation.targetLanguages
            : []
        ).map((language) => (typeof language === 'string' ? language : null)),
      },
      mainActions: deps.resolveMainActions(
        normalizeMainActions(input.mainActions),
        registrations
      ),
      registrationState: {
        seededCommandIds: stringsOf(registrationState.seededCommandIds),
        seededToolIds: stringsOf(registrationState.seededToolIds),
        reviewedMainActionIds: [
          ...new Set([
            ...registrations,
            ...deps
              .getRegisteredActions()
              .flatMap((action) => (action.id ? [action.id] : [])),
          ]),
        ],
      },
      commands,
      llm: normalizeLlmConfig(input.llm),
      stt: normalizeSttConfig(input.stt),
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
