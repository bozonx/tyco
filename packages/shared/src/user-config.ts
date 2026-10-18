import configDefaults from './user-config-defaults.json' with { type: 'json' }
import configVersion from './config-version.json' with { type: 'json' }
import { type MarkdownSettings, type MarkdownCleanSettings } from './markdown'
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

/** Keys pressed in the target window to paste the inserted text */
export const PASTE_SHORTCUTS = [
  'ctrl+v',
  'ctrl+shift+v',
  'shift+insert',
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
 * Enter variant inserts a line break
 */
export const SUBMIT_KEYS = ['enter', 'ctrlEnter'] as const
export type SubmitKey = (typeof SUBMIT_KEYS)[number]
export const DEFAULT_SUBMIT_KEY: SubmitKey = 'enter'

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

export interface ChatHistoryConfig {
  isEnabled: boolean
  /** Zero retains chats indefinitely. */
  retentionDays: number
}

export interface ChatConfig {
  imageQuality: 'economy' | 'balanced' | 'original'
}

/** The modes a global hotkey opens, and the in-place selection correction */
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

export interface AiTaskConfig {
  id: string
  name: string
  rule: string
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
  editor: { submitKey: SubmitKey; diffViewMode: 'unified' | 'split' | 'result' }
  quickWindow: { isHiddenOnBlur: boolean; isCorrectionPrefetchEnabled: boolean }
  hotkeys: HotkeysConfig
  externalAccess: ExternalAccess
  windowInsertion: {
    pasteShortcut: PasteShortcut
    linux: {
      method: 'xdotool' | 'ydotool'
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
  aiRules: Record<
    'chat' | 'correction' | 'translation' | 'voiceCorrection',
    string
  >
  aiTasks: ShortcutSlots<AiTaskConfig>
  aiVault: AiVaultLocationConfig
  markdown: MarkdownSettings
  markdownClean: MarkdownCleanSettings
  plugins: Record<string, PluginEntryConfig>
  editorHistory: EditorHistoryConfig
  chatHistory: ChatHistoryConfig
  chat: ChatConfig
  stt: SttConfig
}

export interface AiVaultLocationConfig {
  /** Absent for the default location in the app data */
  path?: string
}

/** Untrusted serialized input; normalize before reading any field. */
export type UserConfigInput = unknown

export const DEFAULT_USER_CONFIG: UserConfig = {
  ...configDefaults,
  configVersion: CONFIG_VERSION,
} as UserConfig
