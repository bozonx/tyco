import {
  DEFAULT_USER_CONFIG,
  PASTE_SHORTCUTS,
  normalizeAppearance,
  normalizeMarkdownSettings,
  normalizeMarkdownCleanSettings,
  type UserConfig,
  type MainActionConfig,
  type AppearanceSettings,
} from '@tyco/shared'
import { withAiTaskIds } from '../ai-tasks/custom-prompt'
import {
  normalizeCommands,
  normalizeLauncherCommands,
} from '../commands/command-config'
import { normalizeEditorConfig } from '../history/editor-history-storage'
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

/** Normalizes legacy input without changing the persisted source object. */
export function createSettingsConfig(deps: SettingsConfigDeps) {
  type LegacyUserConfig = UserConfig &
    Record<string, unknown> & {
      aiRules: UserConfig['aiRules'] & { base?: string }
    }
  function cloneUserConfig(config: unknown): LegacyUserConfig {
    return JSON.parse(
      JSON.stringify(config || DEFAULT_USER_CONFIG)
    ) as LegacyUserConfig
  }

  function prepare(config: unknown) {
    const nextConfig = cloneUserConfig(config)

    ensurePluginDefaults(nextConfig)
    normalizeAppearanceConfig(nextConfig)
    normalizeLanguageConfig(nextConfig)
    nextConfig.mainActions = deps.resolveMainActions(
      nextConfig.mainActions,
      nextConfig.mainActionRegistrations ?? []
    )
    nextConfig.commands = normalizeCommands(nextConfig.commands)
    nextConfig.mainActionRegistrations = [
      ...new Set([
        ...(nextConfig.mainActionRegistrations ?? []),
        ...deps
          .getRegisteredActions()
          .flatMap((action) => (action.id ? [action.id] : [])),
      ]),
    ]
    normalizeWindowInsertionConfig(nextConfig)
    normalizeEditorConfig(nextConfig)
    nextConfig.markdown = normalizeMarkdownSettings(nextConfig.markdown)
    nextConfig.markdownClean = normalizeMarkdownCleanSettings(
      nextConfig.markdownClean
    )
    normalizeHotkeysConfig(nextConfig)
    Object.assign(nextConfig, normalizeSttConfig(nextConfig))
    normalizeLlmConfigSection(nextConfig)
    nextConfig.translation = normalizeTranslationConfig(nextConfig.translation)
    delete nextConfig.chatRoles
    delete nextConfig.chatHistoryMaxItems
    nextConfig.launcherCommands = normalizeLauncherCommands(
      nextConfig.launcherCommands,
      nextConfig.commands
    )
    nextConfig.launcherPages = (nextConfig.launcherPages ?? []).map(
      (page: (string | null)[]) =>
        normalizeLauncherCommands(page, nextConfig.commands)
    )
    normalizeAiTasks(nextConfig)
    nextConfig.aiRules = {
      ...DEFAULT_USER_CONFIG.aiRules,
      ...(nextConfig.aiRules || {}),
    }
    // the common rule was replaced by per-task rules
    delete nextConfig.aiRules.base

    return nextConfig
  }

  function normalizeHotkeysConfig(config: LegacyUserConfig) {
    config.hotkeys = {
      ...DEFAULT_USER_CONFIG.hotkeys,
      ...(config.hotkeys || {}),
    }
    delete config.hotkeys?.history
    delete config.hotkeys?.config
    config.submitKey = resolveSubmitKey(config.submitKey)
    delete config.quickInputHotkeys
    delete config.quickInputSubmit
    delete config.quickCorrection
    delete config.hotkeys?.correction
    // only the correction replaces the selection from a hotkey
    config.selectionHotkeys = {
      correction:
        config.selectionHotkeys?.correction ??
        DEFAULT_USER_CONFIG.selectionHotkeys.correction,
    }
    delete config.selectionReplace
    config.quickCorrectionPrefetch = config.quickCorrectionPrefetch === true
    config.quickHideOnBlur = config.quickHideOnBlur !== false
  }

  function ensurePluginDefaults(config: LegacyUserConfig) {
    config.plugins = applyPluginDefaults(deps.pluginIndexes(), config.plugins)
  }

  // configs created before the accessibility settings come without these keys;
  // the theme falls back to what the pre-render bootstrap applied
  function normalizeAppearanceConfig(config: LegacyUserConfig) {
    Object.assign(
      config,
      normalizeAppearance({ ...deps.appearance(), ...config })
    )
  }

  function normalizeLanguageConfig(config: LegacyUserConfig) {
    config.appLanguage = config.appLanguage || AUTO_LANGUAGE_VALUE
    config.userLanguage = config.userLanguage || AUTO_LANGUAGE_VALUE
    config.toTranslateLanguages = normalizeShortcutSlots<string>(
      config.toTranslateLanguages
    ).map((lang) => (typeof lang === 'string' ? lang : null))
  }

  function normalizeWindowInsertionConfig(config: LegacyUserConfig) {
    const defaultWindowInsertion = DEFAULT_USER_CONFIG.windowInsertion
    const windowInsertion = config.windowInsertion || {}
    const xdotoolBin =
      windowInsertion.xdotoolBin ||
      config.xdotoolBin ||
      defaultWindowInsertion.xdotoolBin

    config.windowInsertion = {
      method:
        windowInsertion.method === 'ydotool' ||
        windowInsertion.method === 'xdotool'
          ? windowInsertion.method
          : defaultWindowInsertion.method,
      xdotoolBin,
      ydotoolBin:
        windowInsertion.ydotoolBin || defaultWindowInsertion.ydotoolBin,
      pasteShortcut: PASTE_SHORTCUTS.includes(windowInsertion.pasteShortcut)
        ? windowInsertion.pasteShortcut
        : defaultWindowInsertion.pasteShortcut,
    }
    config.xdotoolBin = xdotoolBin
  }

  function normalizeLlmConfigSection(config: LegacyUserConfig) {
    config.llm = normalizeLlmConfig(config.llm)
    delete config.llmModels
  }

  function normalizeAiTasks(config: LegacyUserConfig) {
    if (!Array.isArray(config.aiTasks)) {
      config.aiTasks = []
    }

    config.aiTasks = withAiTaskIds(
      normalizeShortcutSlots<NonNullable<UserConfig['aiTasks'][number]>>(
        config.aiTasks
      ).map((task) =>
        task && (task.name?.trim() || task.rule?.trim())
          ? { id: task.id, name: task.name || '', rule: task.rule || '' }
          : null
      )
    )
  }

  return { prepare: (config: unknown): UserConfig => prepare(config) }
}
