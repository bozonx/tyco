import type { ContrastMode, MotionMode, ThemeMode, UiScale } from './appearance'
import type { SelectionWhenEmpty } from './selection'

export const CONFIG_FILE_NAME = 'userConfig.yaml'

const BASE_TASK = `
- Do exactly what the user requested without adding unrelated material.
- Produce a clear, accurate, and relevant result.
- Preserve the user's intent and do not invent missing facts.
`

const TRANSLATION_TASK = `
- The source text may contain errors and typos.
- Preserve the overall tone: conversational, formal, legal, playful, journalistic, non-fiction, contemporary fiction, etc.
- Do not translate verbatim or attempt to preserve errors, typos, and missing punctuation marks.
- The text must sound natural in the target language.
- Follow the best grammar and punctuation practices of the target language.
- Grammar and punctuation should match the overall style; even conversational style must be grammatical and error-free.
- Restore punctuation and remove extra whitespace.
- Sentences must start with a capital letter and end with a period.`

const CORRECTION_TASK = `
- Correct this text and restore punctuation.
- Keep in mind that the user might have forgotten to switch keyboard layout and typed in one language using another layout.
 `

const VOICE_CORRECTION_TASK = `
- Remove repeated words caused by hesitations or stuttering.
- Eliminate rambling speech and make the text clear and concise.
- If certain words are unrecognized or unclear, do not invent synonyms; keep them as they are.
- If the meaning is completely unclear, do not invent facts; leave it as is.
 `

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
  'chat',
] as const

export type LlmTask = (typeof LLM_TASKS)[number]

export interface LlmConfig {
  providers: LlmProvider[]
  models: LlmModel[]
  /** Model ids per task: the first answers, the rest are its fallbacks */
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
    chat: [DEFAULT_LLM_MODEL_ID],
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
}

/** Dictation is live only, and Deepgram is the provider that serves it */
export const STT_PROVIDERS = ['deepgram'] as const

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

export type MainActionConfig = StandardMainAction | PluginMainAction

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

export const DEFAULT_QUICK_INPUT_HOTKEYS = {
  correctAndInsert: 'Enter',
  next: 'Tab',
  insertWithoutCorrection: '',
  newline: 'Shift+Enter',
  cancel: 'Esc',
}

export type QuickInputAction = keyof typeof DEFAULT_QUICK_INPUT_HOTKEYS
export type QuickInputHotkeys = Record<QuickInputAction, string>

export interface UserConfig {
  hotkeys: Record<string, string>
  /**
   * Hotkeys of the actions that replace the selection, keyed by action id
   * (`correction`, `translate.0`, `aiTask.0`); an empty string unbinds
   */
  selectionHotkeys: Record<string, string>
  selectionReplace: { whenEmpty: SelectionWhenEmpty }
  quickInputHotkeys?: Partial<QuickInputHotkeys>
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
  chatHistoryMaxItems: number
  llm: LlmConfig
  sttModels: SttModel[]
  aiModelUsage: { stt: string }
  aiRules: {
    base: string
    translate: string
    voiceCorrection: string
    correction: string
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
    voice: 'Ctrl+Alt+V',
    select: 'Ctrl+Alt+S',
    aiTasks: 'Ctrl+Alt+A',
    correction: 'Ctrl+Alt+R',
  },
  selectionHotkeys: { correction: 'Ctrl+Alt+F' },
  selectionReplace: { whenEmpty: 'nothing' },
  quickInputHotkeys: DEFAULT_QUICK_INPUT_HOTKEYS,
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
  ],
  aiModelUsage: { stt: 'deepgram-stt' },
  aiRules: {
    base: BASE_TASK,
    translate: TRANSLATION_TASK,
    voiceCorrection: VOICE_CORRECTION_TASK,
    correction: CORRECTION_TASK,
  },
  aiTasks: [
    {
      name: 'deepEdit',
      rule: 'Improve awkward phrasing, add pronouns where needed, clarify meaning, remove redundancy, and choose natural synonyms.',
    },
  ],
  plugins: {},
}
