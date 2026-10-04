import type { ContrastMode, MotionMode, ThemeMode, UiScale } from './appearance'

export const CONFIG_FILE_NAME = 'userConfig.yaml'

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

export interface ScriptMainAction {
  type: 'script'
  id: string
  name: string
  command: string
  logOutput?: boolean
}

export interface WebhookMainAction {
  type: 'webhook'
  id: string
  name: string
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  payloadTemplate?: string
  logOutput?: boolean
}

export type MainActionConfig =
  StandardMainAction | PluginMainAction | ScriptMainAction | WebhookMainAction

export const DEFAULT_MAIN_ACTIONS: (MainActionConfig | null)[] =
  STANDARD_ACTION_IDS.map((actionId) => ({ type: 'standard', actionId }))

/** Action when pasting HTML from the clipboard */
export type PasteMode = 'plain' | 'markdown' | 'ask'

/** Keys pressed in the target window to paste the inserted text */
export const PASTE_SHORTCUTS = [
  'ctrl+v',
  'ctrl+shift+v',
  'shift+insert',
] as const
export type PasteShortcut = (typeof PASTE_SHORTCUTS)[number]

/** Document syntax highlighting mode in the editor */
export type EditorSyntax = 'none' | 'markdown'

/**
 * Which key sends the text of a multi-line input (quick input, chat); the other
 * Enter variant inserts a line break
 */
export const SUBMIT_KEYS = ['enter', 'ctrlEnter'] as const
export type SubmitKey = (typeof SUBMIT_KEYS)[number]
export const DEFAULT_SUBMIT_KEY: SubmitKey = 'enter'

export interface UserConfig {
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
  /** Plugin actions whose initial shortcut assignment has been reviewed. */
  mainActionRegistrations?: string[]
  pasteMode: PasteMode
  editorSyntax: EditorSyntax
  editorHistoryMaxItems: number
  clearEditorHistoryOnExit?: boolean
  editorHistoryRetentionDays?: number
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
  hotkeys: {
    editor: 'Ctrl+Alt+E',
    write: 'Ctrl+Alt+W',
    chat: 'Ctrl+Alt+C',
    voiceChat: 'Ctrl+Alt+Q',
    voice: 'Ctrl+Alt+V',
    select: 'Ctrl+Alt+S',
    aiTasks: 'Ctrl+Alt+A',
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
  pasteMode: 'markdown',
  editorSyntax: 'markdown',
  editorHistoryMaxItems: 100,
  clearEditorHistoryOnExit: false,
  editorHistoryRetentionDays: 0,
  sanitizeSecretsInEditorHistory: false,
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
