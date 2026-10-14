import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  PASTE_SHORTCUTS,
  normalizeAppearance,
  normalizeMarkdownSettings,
  normalizeMarkdownCleanSettings,
  type UserConfig,
  type MainActionConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { withAiTaskIds } from '../ai-tasks/custom-prompt'
import { normalizeMainActions } from '../action-menu/main-actions'
import {
  normalizeCommands,
  normalizeLauncherCommands,
} from '../commands/command-config'
import { resolveSubmitKey } from '../input-keys/input-keys'
import { normalizeLlmConfig } from '../llm/llm-config'
import { AUTO_LANGUAGE_VALUE } from '../locale/language'
import { applyPluginDefaults } from '../plugins/plugin-config'
import { normalizeShortcutSlots } from '../shortcut-slots/shortcut-slots'
import { normalizeSttConfig } from '../stt/stt-config'
import { normalizeTranslationConfig } from '../translation/translation-config'
import type { PluginIndex } from '../../types/plugins'

export interface SettingsConfigDeps {
  resolveMainActions: (
    actions: (MainActionConfig | null)[],
    registrations: string[]
  ) => (MainActionConfig | null)[]
  getRegisteredActions: () => { id?: string }[]
  pluginIndexes: () => PluginIndex[]
  appearance: () => AppearanceSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const recordOf = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}
const stringOf = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback
const booleanOf = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback
const numberOf = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback
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
  return withAiTaskIds(
    normalizeShortcutSlots(source).map((task) => {
      if (!isRecord(task)) return null
      const name = stringOf(task.name)
      const rule = stringOf(task.rule)
      if (!name.trim() && !rule.trim()) return null
      return { id: stringOf(task.id), name, rule }
    })
  )
}

/** Normalizes the input without changing the persisted source object. */
export function createSettingsConfig(deps: SettingsConfigDeps) {
  function prepare(value: unknown): UserConfig {
    // Clone serialized settings before normalizing; Vue drafts may be reactive.
    const cloned: unknown = JSON.parse(
      JSON.stringify(isRecord(value) ? value : DEFAULT_USER_CONFIG)
    )
    const input = recordOf(cloned)
    const defaults = DEFAULT_USER_CONFIG
    const insertion = recordOf(input.windowInsertion)
    const rules = recordOf(input.aiRules)
    const selectionHotkeys = recordOf(input.selectionHotkeys)
    const externalAccess = recordOf(input.externalAccess)
    const registrationState = recordOf(input.registrationState)
    const registrations = stringsOf(registrationState.reviewedMainActionIds)
    const commands = normalizeCommands(input.commands)
    const xdotoolBin =
      stringOf(insertion.xdotoolBin, defaults.windowInsertion.xdotoolBin) ||
      defaults.windowInsertion.xdotoolBin
    const next: UserConfig & Record<string, unknown> = {
      ...input,
      ...normalizeAppearance({ ...deps.appearance(), ...input }),
      configVersion: numberOf(input.configVersion, defaults.configVersion ?? 0),
      externalAccess: { selection: externalAccess.selection === true },
      hotkeys: { ...defaults.hotkeys, ...stringRecordOf(input.hotkeys) },
      selectionHotkeys: {
        correction: stringOf(
          selectionHotkeys.correction,
          defaults.selectionHotkeys.correction ?? ''
        ),
      },
      submitKey: resolveSubmitKey(input.submitKey),
      quickCorrectionPrefetch: input.quickCorrectionPrefetch === true,
      quickHideOnBlur: input.quickHideOnBlur !== false,
      windowInsertion: {
        method: insertion.method === 'ydotool' ? 'ydotool' : 'xdotool',
        xdotoolBin,
        ydotoolBin:
          stringOf(insertion.ydotoolBin, defaults.windowInsertion.ydotoolBin) ||
          defaults.windowInsertion.ydotoolBin,
        pasteShortcut:
          PASTE_SHORTCUTS.find(
            (shortcut) => shortcut === insertion.pasteShortcut
          ) ?? defaults.windowInsertion.pasteShortcut,
      },
      appLanguage: stringOf(input.appLanguage) || AUTO_LANGUAGE_VALUE,
      userLanguage: stringOf(input.userLanguage) || AUTO_LANGUAGE_VALUE,
      toTranslateLanguages: normalizeShortcutSlots<unknown>(
        Array.isArray(input.toTranslateLanguages)
          ? input.toTranslateLanguages
          : []
      ).map((language) => (typeof language === 'string' ? language : null)),
      translation: normalizeTranslationConfig(input.translation),
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
      diffViewMode:
        input.diffViewMode === 'split' || input.diffViewMode === 'result'
          ? input.diffViewMode
          : 'unified',
      translationViewMode:
        input.translationViewMode === 'result' ? 'result' : 'split',
      commands,
      launcherCommands: normalizeLauncherCommands(
        input.launcherCommands,
        commands
      ),
      launcherPages: Array.isArray(input.launcherPages)
        ? input.launcherPages.map((page: unknown) =>
            normalizeLauncherCommands(page, commands)
          )
        : [],
      launcherPagesWithoutText: Array.isArray(input.launcherPagesWithoutText)
        ? input.launcherPagesWithoutText.filter(
            (page): page is number =>
              typeof page === 'number' && Number.isInteger(page) && page >= 0
          )
        : [],
      editorHistoryStorage:
        input.editorHistoryStorage === 'off' ||
        input.editorHistoryStorage === 'session'
          ? input.editorHistoryStorage
          : 'disk',
      editorHistoryMaxItems: numberOf(
        input.editorHistoryMaxItems,
        defaults.editorHistoryMaxItems
      ),
      editorHistoryRetentionDays: numberOf(
        input.editorHistoryRetentionDays,
        defaults.editorHistoryRetentionDays ?? 30
      ),
      sanitizeSecretsInEditorHistory: booleanOf(
        input.sanitizeSecretsInEditorHistory,
        defaults.sanitizeSecretsInEditorHistory ?? true
      ),
      chatImageQuality:
        input.chatImageQuality === 'economy' ||
        input.chatImageQuality === 'original'
          ? input.chatImageQuality
          : 'balanced',
      chatHistoryEnabled: booleanOf(
        input.chatHistoryEnabled,
        defaults.chatHistoryEnabled
      ),
      chatHistoryRetentionDays: numberOf(
        input.chatHistoryRetentionDays,
        defaults.chatHistoryRetentionDays
      ),
      llm: normalizeLlmConfig(input.llm),
      ...normalizeSttConfig(input),
      aiRules: {
        chat: stringOf(rules.chat),
        correction: stringOf(rules.correction),
        translate: stringOf(rules.translate),
        voiceCorrection: stringOf(rules.voiceCorrection),
      },
      aiTasks: normalizeAiTasks(input.aiTasks),
      markdown: normalizeMarkdownSettings(input.markdown),
      markdownClean: normalizeMarkdownCleanSettings(input.markdownClean),
      plugins: applyPluginDefaults(
        deps.pluginIndexes(),
        recordOf(input.plugins)
      ),
    }
    for (const key of ['history', 'config', 'correction'])
      delete next.hotkeys[key]
    for (const key of [
      'chatRoles',
      'chatHistoryMaxItems',
      'quickInputHotkeys',
      'quickInputSubmit',
      'quickCorrection',
      'selectionReplace',
      'llmModels',
      'xdotoolBin',
      'aiModelUsage',
      'mainActionRegistrations',
      'seededCommands',
    ])
      delete next[key]
    return normalizeUserConfig(next)
  }
  return { prepare }
}
