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

/**
 * Keys pressed in the target window to paste the inserted text on Linux;
 * written as the hotkeys are
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
  /** The most entries kept; turning the history off is `storage: 'off'` */
  maxItems: number
  /** Absent: entries are kept indefinitely */
  retentionDays?: number
  isSecretSanitizingEnabled: boolean
}

/** Chats live on the disk or are not kept at all */
export const CHAT_HISTORY_STORAGES = ['off', 'disk'] as const
export type ChatHistoryStorage = (typeof CHAT_HISTORY_STORAGES)[number]

export interface ChatHistoryConfig {
  storage: ChatHistoryStorage
  /** Absent: chats are kept indefinitely */
  retentionDays?: number
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
  quickInput: string
  chat: string
  voiceChat: string
  voice: string
  selectionActions: string
  aiTasks: string
  correction: string
  translation: string
  voiceCommands: string
  selectionCorrection: string
}

export type HotkeyId = keyof HotkeysConfig

/** Per-plugin state: the plugin owns `settings` */
export interface PluginEntryConfig {
  settingsVersion?: number
  isEnabled: boolean
  settings: Record<string, unknown>
}

/** A named AI rule of the task library */
export interface AiTaskConfig {
  id: string
  name: string
  rule: string
}

export interface AiTasksConfig {
  /** The task library, in the order the settings list it */
  items: AiTaskConfig[]
  /** The AI task menu: task ids by shortcut key */
  slots: ShortcutSlots<string>
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
  /** How the text is typed into other windows, per platform */
  windowInsertion: {
    linux: {
      pasteShortcut: PasteShortcut
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
  aiTasks: AiTasksConfig
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
