import configDefaults from './user-config-defaults.json' with { type: 'json' }
import configVersion from './config-version.json' with { type: 'json' }
import type { MarkdownConfig } from './markdown'
import type { AppearanceSettings } from './appearance'
import type { LlmConfig } from './user-config/llm-config'
import type { ToolCatalogSettings } from './user-config/tools-config'
import type {
  ShortcutSlots,
  TranslationConfig,
} from './user-config/translation-config'
import type { DialogConfig } from './user-config/dialog-config'
import type { SttConfig } from './user-config/stt-config'
import type {
  ActionPageConfig,
  CommandConfig,
  CustomActionSlotConfig,
} from './user-config/commands-config'
import type { VariableConfig } from './variables'

export * from './user-config/llm-config'
export * from './user-config/translation-config'
export * from './user-config/dialog-config'
export * from './user-config/stt-config'
export * from './user-config/commands-config'
export * from './user-config/tools-config'

/**
 * The supported schema version; the backend rejects future schemas without
 * overwriting them. Both runtimes read `config-version.json`
 */
export const CONFIG_VERSION = configVersion

/**
 * Keys pressed in the target window to paste the inserted text on Linux,
 * written as the hotkeys are. `auto` presses Ctrl+V, and Ctrl+Shift+V in a
 * terminal; a combination is pressed as it is in every window
 */
export const PASTE_SHORTCUTS = [
  'auto',
  'Ctrl+V',
  'Ctrl+Shift+V',
  'Shift+Insert',
] as const
export type PasteShortcut = (typeof PASTE_SHORTCUTS)[number]

/**
 * Where a history keeps what is new: in the memory of the running app only,
 * gone when it quits, or on the disk. The entries already on the disk stay
 * there either way
 */
export const HISTORY_STORAGES = ['session', 'disk'] as const
export type HistoryStorage = (typeof HISTORY_STORAGES)[number]

export const EDITOR_HISTORY_STORAGES = HISTORY_STORAGES
export type EditorHistoryStorage = (typeof EDITOR_HISTORY_STORAGES)[number]

/**
 * Which key sends the text of a multi-line input (quick input, chat); the other
 * Enter variant inserts a line break. Written as the hotkeys are
 */
export const SUBMIT_KEYS = ['Enter', 'Ctrl+Enter'] as const
export type SubmitKey = (typeof SUBMIT_KEYS)[number]
export const DEFAULT_SUBMIT_KEY: SubmitKey = 'Enter'

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
  /** Absent: entries are kept indefinitely */
  retentionDays?: number
  isSecretSanitizingEnabled: boolean
}

export const CHAT_HISTORY_STORAGES = HISTORY_STORAGES
export type ChatHistoryStorage = (typeof CHAT_HISTORY_STORAGES)[number]

export interface ChatHistoryConfig {
  storage: ChatHistoryStorage
  /** Absent: chats are kept indefinitely */
  retentionDays?: number
  /** Absent: quick requests are saved along with the chats */
  isQuickRequestSavingEnabled?: boolean
}

/** The settings of the chats */
export interface ChatConfig {
  /** The history of the chats of "Ask AI"; a workspace sets its own */
  history: ChatHistoryConfig
}

export type EditorShortcutId =
  | 'bold'
  | 'italic'
  | 'link'
  | 'code'
  | 'strikethrough'
  | 'normalText'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'indent'
  | 'outdent'
  | 'toggleMarkup'
export type EditorShortcuts = Record<EditorShortcutId, string>

export interface EditorConfig {
  shortcuts: EditorShortcuts
  submitKey: SubmitKey
  diffViewMode: 'unified' | 'split' | 'result' | 'original'
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
  voice: string
  /** Transcribes the computer sound, see `stt.listenAppId` */
  listen: string
  selectionActions: string
  selectionActionsPage2: string
  selectionActionsPage3: string
  selectionActionsPage4: string
  selectionActionsPage5: string
  correction: string
  translation: string
  styling: string
  transformation: string
  quickAiRequest: string
  voiceQuickAiRequest: string
  screenshotQuickAiRequest: string
  voiceScreenshotQuickAiRequest: string
  chatPrompts: string
  favorites: string
  history: string
  dialog: string
  voiceCommands: string
  selectionCorrection: string
  customAction1: string
  customAction2: string
  customAction3: string
  customAction4: string
  customAction5: string
}

/** The hotkeys of activation modes and action pages */
export type HotkeyId = keyof HotkeysConfig

/** Per-plugin state: the plugin owns `settings` */
export interface PluginEntryConfig {
  settingsVersion?: number
  isEnabled: boolean
  settings: Record<string, unknown>
}

/** A named text transformation rule of the transformation library */
export interface TransformationConfig {
  id: string
  name: string
  rule: string
}

export interface TransformationsConfig {
  /** The transformation library, in the order the settings list it */
  items: TransformationConfig[]
  /** The transformation menu: transformation ids by shortcut key */
  slots: ShortcutSlots<string>
}

/** A named styling rule of the styling library */
export interface StylingConfig {
  id: string
  name: string
  rule: string
}

export interface StylingsConfig {
  /** The styling library, in the order the settings list it */
  items: StylingConfig[]
  /** The styling menu: styling ids by shortcut key */
  slots: ShortcutSlots<string>
}

/** A named prompt of the prompt library */
export interface ChatPromptConfig {
  id: string
  name: string
  rule: string
  /**
   * The AI profile the prompt belongs to; empty for a prompt of every profile,
   * which runs as the plain quick AI request outside a chat
   */
  profileId: string
  /** The vault of a profile of an attached one; absent for the main vault */
  vaultId?: string
}

export interface ChatPromptsConfig {
  /**
   * The prompt library, in display order; the first prompts get the shortcut
   * keys of the prompt menu
   */
  items: ChatPromptConfig[]
}

/** A saved text favorite */
export interface FavoriteConfig {
  id: string
  text: string
  name?: string
}

export interface FavoritesConfig {
  /** The saved text favorites, in display order */
  items: FavoriteConfig[]
}

export const QUICK_CORRECTION_MODES = ['live', 'onSubmit', 'off'] as const
export type QuickCorrectionMode = (typeof QUICK_CORRECTION_MODES)[number]

export const SCREENSHOT_CAPTURE_MODES = ['screen', 'area'] as const
export type ScreenshotCaptureMode = (typeof SCREENSHOT_CAPTURE_MODES)[number]

export type ActionMenuPosition = 'center' | 'right' | 'bottomRight'

export interface QuickWindowConfig {
  actionMenuPosition: ActionMenuPosition
  isVoiceCollapsed: boolean
  isListenCollapsed: boolean
  isHiddenOnBlur: boolean
  isCorrectionPrefetchEnabled: boolean
  correctionMode: QuickCorrectionMode
  screenshotCaptureMode: ScreenshotCaptureMode
}

/** Complete, normalized configuration used throughout the application. */
export interface UserConfig {
  isInDevelopment?: boolean
  configVersion: number
  appearance: AppearanceSettings
  language: {
    /** The interface locale, or `auto` for the system one */
    ui: string
  }
  editor: EditorConfig
  quickWindow: QuickWindowConfig
  hotkeys: HotkeysConfig
  externalAccess: ExternalAccess
  /** How the text is typed into other windows, per platform */
  windowInsertion: { linux: { pasteShortcut: PasteShortcut } }
  translation: TranslationConfig
  actionPages: ActionPageConfig[]
  customActionSlots: CustomActionSlotConfig[]
  commands: CommandConfig[]
  /**
   * How long a command run may take, in seconds; 0 disables the limit
   * (unbounded). Defaults to 300 (5 minutes).
   */
  commandRunTimeoutSec: number
  /**
   * Maximum tool steps AI commands may take (1 to `MAX_TOOL_STEPS`);
   * `llm.maxToolSteps` (or `DEFAULT_MAX_TOOL_STEPS`) when unset.
   */
  commandAiMaxSteps?: number
  /** The variables commands refer to as `{{var:NAME}}`, see `variables.ts` */
  variables: VariableConfig[]
  /**
   * The values of the variables on this device, by variable id; kept on the
   * device, never synced. An unset variable is absent
   */
  variableValues: Record<string, string>
  llm: LlmConfig
  transformations: TransformationsConfig
  styling: StylingsConfig
  chatPrompts: ChatPromptsConfig
  favorites: FavoritesConfig
  aiVaults: AiVaultsConfig
  markdown: MarkdownConfig
  plugins: Record<string, PluginEntryConfig>
  /** The tool sources switched off everywhere, see `ToolCatalogSettings` */
  tools: ToolCatalogSettings
  chat: ChatConfig
  stt: SttConfig
  dialog: DialogConfig
}

/** The vaults this device has attached besides the main one */
export interface AiVaultsConfig {
  attached: AttachedVaultConfig[]
}

export interface AttachedVaultConfig {
  /** The folder of the vault on this device */
  path: string
  /** The id its marker had when it was attached, for a vault not there now */
  vaultId: string
}

/** Untrusted serialized input; normalize before reading any field. */
export type UserConfigInput = unknown

export const DEFAULT_USER_CONFIG: UserConfig = {
  configVersion: CONFIG_VERSION,
  ...configDefaults,
} as UserConfig
