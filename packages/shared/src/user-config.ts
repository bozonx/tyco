import configDefaults from './user-config-defaults.json' with { type: 'json' }
import configVersion from './config-version.json' with { type: 'json' }
import type { MarkdownConfig } from './markdown'
import type { AppearanceSettings } from './appearance'
import type { LlmConfig } from './user-config/llm-config'
import type {
  ShortcutSlots,
  TranslationConfig,
} from './user-config/translation-config'
import type { SttConfig } from './user-config/stt-config'
import type {
  CommandConfig,
  LauncherPageConfig,
  MainActionConfig,
} from './user-config/commands-config'

export * from './user-config/llm-config'
export * from './user-config/translation-config'
export * from './user-config/stt-config'
export * from './user-config/commands-config'

/**
 * The supported schema version; the backend rejects future schemas without
 * overwriting them. Both runtimes read `config-version.json`
 */
export const CONFIG_VERSION = configVersion

export const DEFAULT_LLM_CONFIG = configDefaults.llm as LlmConfig

export const DEFAULT_MAIN_ACTIONS =
  configDefaults.mainActions as ShortcutSlots<MainActionConfig>

/**
 * Keys pressed in the target window to paste the inserted text; written as the
 * hotkeys are
 */
export const PASTE_SHORTCUTS = [
  'Ctrl+V',
  'Ctrl+Shift+V',
  'Shift+Insert',
] as const
export type PasteShortcut = (typeof PASTE_SHORTCUTS)[number]

/**
 * Where the editor history lives: nowhere, in the memory of the running app
 * only, or on the disk
 */
export const EDITOR_HISTORY_STORAGES = ['off', 'session', 'disk'] as const
export type EditorHistoryStorage = (typeof EDITOR_HISTORY_STORAGES)[number]

/**
 * Which key sends the text of a multi-line input (quick input, chat); the other
 * Enter variant inserts a line break. Written as the hotkeys are
 */
export const SUBMIT_KEYS = ['Enter', 'Ctrl+Enter'] as const
export type SubmitKey = (typeof SUBMIT_KEYS)[number]
export const DEFAULT_SUBMIT_KEY: SubmitKey = 'Enter'

/** How the Linux insertion presses the keys; `auto` picks by the session */
export const LINUX_INSERTION_METHODS = ['auto', 'xdotool', 'ydotool'] as const
export type LinuxInsertionMethod = (typeof LINUX_INSERTION_METHODS)[number]

/**
 * What local applications may do through tyco-ctl and D-Bus besides running the
 * commands granted one by one
 */
export interface ExternalAccess {
  /** Read the selection of the focused window and replace it */
  canAccessSelection: boolean
}

export const DEFAULT_EXTERNAL_ACCESS: ExternalAccess = {
  canAccessSelection: false,
}

export interface EditorHistoryConfig {
  storage: EditorHistoryStorage
  maxItems: number
  /** Zero retains entries indefinitely. */
  retentionDays: number
  isSecretSanitizingEnabled: boolean
}

/** Chats live on the disk or are not kept at all */
export const CHAT_HISTORY_STORAGES = ['off', 'disk'] as const
export type ChatHistoryStorage = (typeof CHAT_HISTORY_STORAGES)[number]

export interface ChatHistoryConfig {
  storage: ChatHistoryStorage
  /** Zero retains chats indefinitely. */
  retentionDays: number
}

export interface ChatConfig {
  imageQuality: 'economy' | 'balanced' | 'original'
  history: ChatHistoryConfig
}

export interface EditorConfig {
  submitKey: SubmitKey
  diffViewMode: 'unified' | 'split' | 'result'
  history: EditorHistoryConfig
}

/**
 * The global hotkeys: one per activation mode a hotkey can open, named as the
 * mode is (see `StartMode`), and the in-place selection correction
 */
export interface HotkeysConfig {
  editor: string
  write: string
  chat: string
  voiceChat: string
  voice: string
  select: string
  aiTasks: string
  correction: string
  translate: string
  voiceCommands: string
  selectionCorrection: string
}

export type HotkeyId = keyof HotkeysConfig

/** Per-plugin state: the plugin owns `settings` */
export interface PluginEntryConfig {
  isEnabled: boolean
  settings: Record<string, unknown>
}

/** A named AI rule of the task library */
export interface AiTaskConfig {
  id: string
  name: string
  rule: string
}

/**
 * Rules the user adds to the app instructions of each AI job; an AI task has
 * its own rule
 */
export interface AiRulesConfig {
  chat: string
  correction: string
  translation: string
  /** The review pass of a translation, see `TranslationConfig.qualityGate` */
  translationQualityGate: string
  voiceCorrection: string
}

/** Complete, normalized configuration used throughout the application. */
export interface UserConfig {
  configVersion: number
  appearance: AppearanceSettings
  language: {
    /** The interface locale, or `auto` for the system one */
    ui: string
    /** The locale the user speaks and writes, or `auto` */
    user: string
  }
  editor: EditorConfig
  quickWindow: { isHiddenOnBlur: boolean; isCorrectionPrefetchEnabled: boolean }
  hotkeys: HotkeysConfig
  externalAccess: ExternalAccess
  windowInsertion: {
    pasteShortcut: PasteShortcut
    linux: {
      method: LinuxInsertionMethod
      /** Empty: found on `PATH` */
      xdotoolPath: string
      ydotoolPath: string
    }
  }
  translation: TranslationConfig
  mainActions: ShortcutSlots<MainActionConfig>
  launcherPages: LauncherPageConfig[]
  commands: CommandConfig[]
  llm: LlmConfig
  aiRules: AiRulesConfig
  /** The task library, in the order the settings list it */
  aiTasks: AiTaskConfig[]
  /** The AI task menu: task ids by shortcut key */
  aiTaskSlots: ShortcutSlots<string>
  aiVault: AiVaultLocationConfig
  markdown: MarkdownConfig
  plugins: Record<string, PluginEntryConfig>
  chat: ChatConfig
  stt: SttConfig
}

export interface AiVaultLocationConfig {
  /** Empty for the default location in the app data */
  path: string
}

/** Untrusted serialized input; normalize before reading any field. */
export type UserConfigInput = unknown

export const DEFAULT_USER_CONFIG: UserConfig = {
  configVersion: CONFIG_VERSION,
  ...configDefaults,
} as UserConfig
