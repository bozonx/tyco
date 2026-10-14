import configDefaults from './user-config-defaults.json'
import configVersion from './config-version.json'
import { type MarkdownSettings, type MarkdownCleanSettings } from './markdown'
import type { AppearanceSettings } from './appearance'

/**
 * The supported schema version; the backend rejects future schemas without
 * overwriting them. Both runtimes read `config-version.json`
 */
export const CONFIG_VERSION = configVersion

/** Provider families the app can talk to; see `@bozonx/ai-kit` */
export type LlmProviderType =
  'google' | 'openrouter' | 'deepseek' | 'openai-compatible'

/** Providers that always exist once; their id equals their type */
export const BUILTIN_LLM_PROVIDERS = [
  'google',
  'openrouter',
  'deepseek',
] as const

/**
 * One place models are served from. The id doubles as the id of its API key in
 * the Rust-side secret store; keys are never part of this config
 */
export interface LlmProvider {
  id: string
  type: LlmProviderType
  name?: string
  /** Required for `openai-compatible`, e.g. `http://localhost:11434/v1` */
  baseUrl?: string
}

export interface LlmModel {
  id: string
  /** Id of an `LlmProvider` */
  providerId: string
  /** The provider's own model id */
  providerModelId: string
  name?: string
  temperature?: number
  maxOutputTokens?: number
  contextWindowTokens?: number
  canUseImages?: boolean
  /** DeepSeek thinking mode */
  isThinkingEnabled?: boolean
}

export const LLM_TASKS = [
  'translate',
  'voiceCorrection',
  'correction',
  'aiTasks',
] as const

export type LlmTask = (typeof LLM_TASKS)[number]

export interface LlmConfig {
  providers: LlmProvider[]
  models: LlmModel[]
  /**
   * Model ids per task: the first answers, the rest are its fallbacks. The chat
   * has no chain: it runs on the model picked in it
   */
  taskModelChains: Record<LlmTask, string[]>
}

export const TRANSLATION_PROVIDERS = ['deepl', 'google', 'llm'] as const
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

export const TRANSLATION_QUALITY_GATES = [
  'off',
  'onProblems',
  'always',
] as const
export type TranslationQualityGate = (typeof TRANSLATION_QUALITY_GATES)[number]

export interface TranslationGlossaryEntry {
  term: string
  use: string
  doNotTranslate: boolean
}

export interface TranslationConfig {
  targetLanguages: (string | null)[]
  viewMode: 'split' | 'result'
  provider: TranslationProvider
  qualityGate: TranslationQualityGate
  deeplEndpoint: 'free' | 'pro'
  glossary: TranslationGlossaryEntry[]
  /** Extra instructions for the AI correction pass in the `always` mode. */
  correctionPrompt: string
}

export const DEFAULT_LLM_CONFIG = configDefaults.llm as LlmConfig

export interface SttModel {
  id: string
  providerModelId: string
  provider: SttProvider
  description?: string
  formatWithLlm?: boolean
  /**
   * `auto` (the default) follows the user language, `multi` lets the
   * multilingual model guess; anything else is a locale such as `de_DE`
   */
  language?: string
  /** The server of a self-hosted provider, e.g. `ws://localhost:6006` */
  baseUrl?: string
}

/**
 * Dictation is live only: Deepgram in the cloud, or a sherpa-onnx streaming
 * server the user runs themselves
 */
export const STT_PROVIDERS = ['deepgram', 'sherpa-onnx'] as const

export type SttProvider = (typeof STT_PROVIDERS)[number]

export const STANDARD_ACTION_IDS = [
  'insertIntoWindow',
  'copyToClipboard',
  'aiTask',
  'correction',
  'translation',
  'askInChat',
] as const

export type StandardActionId = (typeof STANDARD_ACTION_IDS)[number]

export interface StandardMainAction {
  type: 'standard'
  actionId: StandardActionId
}

export interface PluginMainAction {
  type: 'plugin'
  actionId: string
}

/** Stands in for the text in a command, a webhook URL or its payload */
export const ACTION_TEXT_PLACEHOLDER = '{{TEXT}}'

/**
 * What a command does with the text its tool returns: nothing, the result menu,
 * pasting it into the window the user works in (over the selection, if there is
 * one), or the clipboard. `insertIntoWindow` pastes the result into the target
 * window
 */
export const CUSTOM_ACTION_AFTER_RUN = [
  'none',
  'showMenu',
  'insertIntoWindow',
  'copy',
] as const
export type CustomActionAfterRun = (typeof CUSTOM_ACTION_AFTER_RUN)[number]

/** Tools that run what the user configured; the way out for anything else */
export const BUILTIN_TOOL_IDS = ['script', 'webhook'] as const
export type BuiltinToolId = (typeof BUILTIN_TOOL_IDS)[number]

/** Tools over what the app already does, see `lib/tools/core-tools.ts` */
export const CORE_TOOL_IDS = [
  'core.insert',
  'core.copy',
  'core.correct',
  'core.translate',
  'core.aiTask',
  'core.askInChat',
] as const
export type CoreToolId = (typeof CORE_TOOL_IDS)[number]

/** `toolConfig` of a `script` command */
export interface ScriptToolConfig {
  /**
   * A shell command; `{{TEXT}}` is replaced with the text, quoted. The command
   * takes the text only when it mentions `{{TEXT}}`, see `scriptTakesText`
   */
  command: string
  /** Empty for the home directory */
  workingDirectory?: string
  /**
   * How long the output is waited for, in seconds; absent for
   * `SCRIPT_OUTPUT_TIMEOUT_SEC`
   */
  timeoutSec?: number
}

/** How long a script whose output is used runs by default, in seconds */
export const SCRIPT_OUTPUT_TIMEOUT_SEC = 60
/** The longest a script whose output is used may run, in seconds */
export const SCRIPT_MAX_TIMEOUT_SEC = 3600

/** `toolConfig` of a `webhook` command */
export interface WebhookToolConfig {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  payloadTemplate?: string
  /**
   * The Authorization header is kept in the secret store under `authSecretId`,
   * bound to the origin of the URL
   */
  isAuthEnabled?: boolean
  /** Opaque secret identity, independent of the command display name and id. */
  authSecretId?: string
}

/**
 * Whether a script takes the text: its command mentions `{{TEXT}}`. Keep in
 * sync with `script_takes_text` in
 * `src-tauri/src/services/external_commands.rs`
 */
export const scriptTakesText = (config: Pick<ScriptToolConfig, 'command'>) =>
  config.command.includes(ACTION_TEXT_PLACEHOLDER)

/**
 * Whether a webhook takes the text: `{{TEXT}}` is in its URL or in the body of
 * a POST request. Keep in sync with `webhook_takes_text` in
 * `src-tauri/src/services/external_commands.rs`
 */
export const webhookTakesText = (
  config: Pick<WebhookToolConfig, 'url' | 'method' | 'payloadTemplate'>
) =>
  config.url.includes(ACTION_TEXT_PLACEHOLDER) ||
  (config.method !== 'GET' &&
    Boolean(config.payloadTemplate?.includes(ACTION_TEXT_PLACEHOLDER)))

/** Where a command can be invoked, besides the action menu */
export interface CommandAvailability {
  external: boolean
  chat: boolean
}

/** Output handling for quick commands, with or without a selection */
export interface CommandLauncherAfterRun {
  action: CustomActionAfterRun
}

/**
 * A user command of the command library: a tool with its settings, invoked from
 * the action menu and, later, the command overlay, external calls and the chat.
 * See `dev_docs/design-voice-commands.md`
 */
export interface CommandConfig {
  /** Stable */
  id: string
  name: string
  /** Tells the LLM what the command does; the agent and LLM parsing use it */
  description?: string
  /**
   * Phrases that select this command by voice, with `(a|b)` alternatives and
   * `[optional]` words; the name is matched as well
   */
  phrases: string[]
  /**
   * `script`, `webhook`, `core.<tool>`, `<pluginName>.<toolId>` or
   * `mcp:<server>.<tool>`
   */
  toolId: string
  /** Values for the tool's config fields */
  toolConfig: Record<string, unknown>
  /**
   * Fill a structured input from text with the LLM; only for tools that take a
   * structured input and do not parse text themselves
   */
  isLlmArgumentParsingEnabled: boolean
  /**
   * What quick commands do with returned text; other contexts have fixed
   * behavior
   */
  launcherAfterRun: CommandLauncherAfterRun
  logOutput: boolean
  availableIn: CommandAvailability
  enabled: boolean
}

/** A command of the library placed in the action menu */
export interface CommandMainAction {
  type: 'command'
  commandId: string
}

/** An AI task of `aiTasks`, by its `id` */
export interface AiTaskMainAction {
  type: 'aiTask'
  taskId: string
}

/** A translation into one of `translation.targetLanguages`. */
export interface TranslationMainAction {
  type: 'translation'
  language: string
}

export type MainActionConfig =
  | { type: 'launcherPage'; pageId: string }
  | StandardMainAction
  | PluginMainAction
  | CommandMainAction
  | AiTaskMainAction
  | TranslationMainAction

export const DEFAULT_MAIN_ACTIONS: (MainActionConfig | null)[] =
  STANDARD_ACTION_IDS.map((actionId) => ({ type: 'standard', actionId }))

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
  selection: boolean
}

export const DEFAULT_EXTERNAL_ACCESS: ExternalAccess = { selection: false }

export interface ConfigRegistrationState {
  reviewedMainActionIds: string[]
  seededCommandIds: string[]
  seededToolIds: string[]
}

/** A configured launcher page; references stay stable when pages move. */
export interface LauncherPageConfig {
  id: string
  slots: (string | null)[]
  inputMode: 'selection' | 'none'
}

export interface EditorHistoryConfig {
  storage: EditorHistoryStorage
  maxItems: number
  /** Zero retains entries indefinitely. */
  retentionDays: number
  sanitizeSecrets: boolean
}

export interface ChatConfig {
  imageQuality: 'economy' | 'balanced' | 'original'
  isHistoryEnabled: boolean
  /** Zero retains chats indefinitely. */
  historyRetentionDays: number
}

export interface SttConfig {
  models: SttModel[]
  selectedModelId: string
}

/** Complete, normalized configuration used throughout the application. */
export interface UserConfig {
  configVersion: number
  externalAccess: ExternalAccess
  hotkeys: Record<string, string>
  selectionHotkeys: Record<string, string>
  submitKey: SubmitKey
  quickCorrectionPrefetch: boolean
  quickHideOnBlur: boolean
  appearance: AppearanceSettings
  windowInsertion: {
    method: 'xdotool' | 'ydotool'
    xdotoolBin: string
    ydotoolBin: string
    pasteShortcut: PasteShortcut
  }
  appLanguage: string
  userLanguage: string
  translation: TranslationConfig
  mainActions: (MainActionConfig | null)[]
  launcherPages: LauncherPageConfig[]
  commands: CommandConfig[]
  registrationState: ConfigRegistrationState
  diffViewMode: 'unified' | 'split' | 'result'
  editorHistory: EditorHistoryConfig
  chat: ChatConfig
  llm: LlmConfig
  stt: SttConfig
  aiRules: {
    chat: string
    correction: string
    translate: string
    voiceCorrection: string
  }
  aiTasks: ({ id: string; name: string; rule: string } | null)[]
  markdown: MarkdownSettings
  markdownClean: MarkdownCleanSettings
  plugins: Record<string, unknown>
}

/** Untrusted serialized input; normalize before reading any field. */
export type UserConfigInput = unknown

export const DEFAULT_USER_CONFIG: UserConfig = {
  ...configDefaults,
  configVersion: CONFIG_VERSION,
} as UserConfig
