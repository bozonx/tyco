import type { ContrastMode, MotionMode, ThemeMode, UiScale } from './appearance'

export const CONFIG_FILE_NAME = 'userConfig.yaml'

/**
 * The schema version of the user config; the backend migrates older configs and
 * leaves newer ones untouched. Keep in sync with `CONFIG_VERSION` in
 * `src-tauri/src/services/config_migration.rs`
 */
export const CONFIG_VERSION = 2

export type ModelTag =
  | 'voice'
  | 'text'
  | 'dialog'
  | 'translation'
  | 'uncensored'
  | 'simple'
  | 'smart'
  | 'lowLatency'
  | 'highCost'
  | 'lowCost'
  | 'free'

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
  provider: string
  /** The provider's own model id */
  model: string
  name?: string
  temperature?: number
  maxOutputTokens?: number
  contextSize?: number
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
  tasks: Record<LlmTask, string[]>
}

export const TRANSLATION_PROVIDERS = ['deepl', 'google', 'llm'] as const
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

export const TRANSLATION_QUALITY_GATES = [
  'off',
  'on_problems',
  'always',
] as const
export type TranslationQualityGate = (typeof TRANSLATION_QUALITY_GATES)[number]

export interface TranslationGlossaryEntry {
  term: string
  use: string
  doNotTranslate: boolean
}

export interface TranslationConfig {
  provider: TranslationProvider
  qualityGate: TranslationQualityGate
  deeplEndpoint: 'free' | 'pro'
  glossary: TranslationGlossaryEntry[]
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  provider: 'llm',
  qualityGate: 'on_problems',
  deeplEndpoint: 'free',
  glossary: [],
}

export const DEFAULT_LLM_MODEL_ID = 'local-qwen'

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  providers: [
    { id: 'google', type: 'google', name: 'Google Gemini' },
    { id: 'openrouter', type: 'openrouter', name: 'OpenRouter' },
    { id: 'deepseek', type: 'deepseek', name: 'DeepSeek' },
    {
      id: 'local',
      type: 'openai-compatible',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
    },
  ],
  models: [
    {
      id: DEFAULT_LLM_MODEL_ID,
      provider: 'local',
      model: 'qwen2.5:7b',
      name: 'Qwen 2.5 7B',
      temperature: 0.2,
    },
    {
      id: 'gemini-flash',
      provider: 'google',
      model: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      temperature: 0.2,
    },
    {
      id: 'deepseek-chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      name: 'DeepSeek Chat',
      temperature: 0.2,
    },
    {
      id: 'openrouter-gpt-4-1-mini',
      provider: 'openrouter',
      model: 'openai/gpt-4.1-mini',
      name: 'GPT-4.1 mini',
      temperature: 0.2,
    },
  ],
  tasks: {
    translate: [DEFAULT_LLM_MODEL_ID],
    voiceCorrection: [DEFAULT_LLM_MODEL_ID],
    correction: [DEFAULT_LLM_MODEL_ID],
    aiTasks: [DEFAULT_LLM_MODEL_ID],
  },
}

export interface SttModel {
  id: string
  model: string
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
 * replacing the selection it got the text from (the result menu when the text
 * came from elsewhere), or the clipboard
 */
export const CUSTOM_ACTION_AFTER_RUN = [
  'none',
  'showMenu',
  'replaceSelection',
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

/** `toolConfig` of a `core.translate` command */
export interface TranslateToolConfig {
  /** Target language code, copied from a slot when the command is made */
  language: string
}

/** `toolConfig` of a `core.aiTask` command */
export interface AiTaskToolConfig {
  /** Instruction for the LLM, as the rule of an AI task */
  prompt: string
}

/** `toolConfig` of a `script` command */
export interface ScriptToolConfig {
  /** A shell command; `{{TEXT}}` is replaced with the text, quoted */
  command: string
  /** Empty for the home directory */
  workingDir?: string
  /** The command takes the text; without it `{{TEXT}}` is not allowed */
  takesText: boolean
}

/** `toolConfig` of a `webhook` command */
export interface WebhookToolConfig {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  payloadTemplate?: string
  /**
   * The Authorization header is kept in the secret store under
   * `webhookSecretId(commandId)`, bound to the origin of the URL
   */
  authSecret?: boolean
  /** The webhook takes the text; without it `{{TEXT}}` is not allowed */
  takesText: boolean
}

export const COMMAND_CONFIRM_MODES = ['auto', 'always'] as const
export type CommandConfirmMode = (typeof COMMAND_CONFIRM_MODES)[number]

/** Where a command can be invoked, besides the action menu */
export interface CommandAvailability {
  launcher: boolean
  external: boolean
  chat: boolean
}

/**
 * A user command of the command library: a tool with its settings, invoked from
 * the action menu and, later, the command overlay, external calls and the chat.
 * See `dev_docs/design-voice-commands.md`
 */
export interface CommandConfig {
  /**
   * Stable; kept from the migrated action so the webhook secret id stays the
   * same
   */
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
  llmArgumentParsing: boolean
  /** What to do with text the tool returns */
  afterRun: CustomActionAfterRun
  logOutput: boolean
  confirm: CommandConfirmMode
  availableIn: CommandAvailability
  enabled: boolean
}

export function webhookSecretId(commandId: string): string {
  return `webhook-${commandId.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`.slice(
    0,
    64
  )
}

/** A command of the library placed in the action menu */
export interface CommandMainAction {
  type: 'command'
  commandId: string
}

export type MainActionConfig =
  StandardMainAction | PluginMainAction | CommandMainAction

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

export interface UserConfig {
  /** See `CONFIG_VERSION`; absent in configs older than version 1 */
  configVersion?: number
  hotkeys: Record<string, string>
  /**
   * Hotkeys of the actions that replace the selection, keyed by action id; only
   * `correction` has one, an empty string unbinds it
   */
  selectionHotkeys: Record<string, string>
  submitKey?: SubmitKey
  /** Correct the quick input text in advance while the user pauses */
  quickCorrectionPrefetch?: boolean
  /** Hide the quick window when the user clicks elsewhere */
  quickHideOnBlur?: boolean
  theme: ThemeMode
  contrast: ContrastMode
  motion: MotionMode
  uiScale: UiScale
  xdotoolBin: string
  windowInsertion: {
    method: 'xdotool' | 'ydotool'
    xdotoolBin: string
    ydotoolBin: string
    pasteShortcut: PasteShortcut
  }
  appLanguage: string
  userLanguage: string
  toTranslateLanguages: (string | null)[]
  translation: TranslationConfig
  mainActions: (MainActionConfig | null)[]
  /** The command library; the action menu refers to commands by id */
  commands: CommandConfig[]
  /** Plugin actions whose initial shortcut assignment has been reviewed. */
  mainActionRegistrations?: string[]
  /**
   * Default commands of the tools added to the library once, and the tools
   * whose defaults were added (`default:<toolId>`); a deleted one is not added
   * again
   */
  seededCommands?: string[]
  editorHistoryStorage: EditorHistoryStorage
  editorHistoryMaxItems: number
  /** Kept on the disk only; 0 keeps the entries forever */
  editorHistoryRetentionDays?: number
  /** Kept on the disk only */
  sanitizeSecretsInEditorHistory?: boolean
  chatHistoryMaxItems: number
  llm: LlmConfig
  sttModels: SttModel[]
  aiModelUsage: { stt: string }
  aiRules: {
    chat: string
    correction: string
    translate: string
    voiceCorrection: string
  }
  aiTasks: ({
    name: string
    rule: string
    tapAction?: string
    holdAction?: string
  } | null)[]
  plugins: Record<string, unknown>
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  configVersion: CONFIG_VERSION,
  // the Linux defaults: the backend owns the defaults of each platform and
  // reports them in `HotkeyProviderInfo.defaults`; an empty one is unassigned
  hotkeys: {
    editor: '',
    write: '',
    chat: '',
    voiceChat: '',
    voice: 'Ctrl+Alt+V',
    select: 'Ctrl+Alt+S',
    aiTasks: '',
    commandLauncher: '',
  },
  selectionHotkeys: { correction: 'Ctrl+Alt+F' },
  submitKey: DEFAULT_SUBMIT_KEY,
  quickCorrectionPrefetch: false,
  quickHideOnBlur: true,
  theme: 'auto',
  contrast: 'auto',
  motion: 'auto',
  uiScale: 100,
  xdotoolBin: '/usr/bin/xdotool',
  windowInsertion: {
    method: 'xdotool',
    xdotoolBin: '/usr/bin/xdotool',
    ydotoolBin: '/usr/bin/ydotool',
    pasteShortcut: 'ctrl+v',
  },
  appLanguage: 'auto',
  userLanguage: 'auto',
  toTranslateLanguages: ['en_US', 'ru_RU', 'es_AR', 'tr_TR'],
  translation: DEFAULT_TRANSLATION_CONFIG,
  mainActions: DEFAULT_MAIN_ACTIONS,
  commands: [],
  editorHistoryStorage: 'disk',
  editorHistoryMaxItems: 1000,
  editorHistoryRetentionDays: 30,
  sanitizeSecretsInEditorHistory: true,
  chatHistoryMaxItems: 50,
  llm: DEFAULT_LLM_CONFIG,
  sttModels: [
    {
      id: 'deepgram-stt',
      model: 'nova-3',
      provider: 'deepgram',
      description: 'Deepgram speech recognition',
      formatWithLlm: false,
      language: 'auto',
    },
    {
      id: 'sherpa-onnx-stt',
      model: 'sherpa-onnx',
      provider: 'sherpa-onnx',
      description: 'Self-hosted sherpa-onnx streaming server',
      formatWithLlm: false,
      baseUrl: 'ws://localhost:6006',
    },
  ],
  aiModelUsage: { stt: 'deepgram-stt' },
  aiRules: { chat: '', correction: '', translate: '', voiceCorrection: '' },
  aiTasks: [
    {
      name: 'deepEdit',
      rule: 'Improve awkward phrasing, add pronouns where needed, clarify meaning, remove redundancy, and choose natural synonyms.',
    },
  ],
  plugins: {},
}
