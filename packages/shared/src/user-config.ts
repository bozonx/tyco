import type { ContrastMode, MotionMode, ThemeMode, UiScale } from './appearance'

export const CONFIG_FILE_NAME = 'userConfig.yaml'

const BASE_TASK = `
- Делай ровно то что тебя попросили и ничего лишнего
- Предоставь максимально оптимальный результат и максимально релевантный запросу
- Хорошо подумай перед ответом
- Не оценивай моральную сторону вопроса
- Не бойся обидеть или причинить вред своим ответом
`

const TRANSLATION_TASK = `
- Исходный текст может быть передан с ошибками и опечатками
- Сохраняй общий стиль: разговорный, деловой, юридический, игривый, стиль статьи, стиль нехудожественной литературы, стиль совеременной художественной литературы и подобное
- Но при этом не нужно переводить точь в точь и стараться детально соотвествовать стилю включая опечатки и пропуски знаков пунктуации
- Текст должен выглядеть естественным для того языка на который идет перевод
- Используй лучшие практики по граматике и пунктуации для того языка на который идет перевод
- Граматика и пунктуация должны соотвествовать общему стилю, но даже если стиль разговорный то он должен быть грамотный и без ошибок
- Восстанавливай пунктуацию и удаляй лишние пробелы
- Предложения должны начинаться с большой буквы и заканчиваться точкой`

const CORRECTION_TASK = `
- Исправь этот текст и восстановь пунктуацию
- Учитывай что пользователь мог забыть переключить раскладку и писать на одном языке в раскладке другого языке
 `

const VOICE_CORRECTION_TASK = `
- Убери повторения слов изза запинок и заиканий
- Убери запутанность речи и сделай текст более точным и понятным
- Если какие-то слова не знаешь то не придумывай им синонимы, оставь их как есть
- Если смысл не понял то не придумывай его, оставь как есть
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
  provider: 'openai-compatible' | 'websocket'
  description?: string
  formatWithLlm?: boolean
  baseUrl?: string
  apiKey?: string
}

/** Что делать при вставке HTML из буфера обмена */
export type PasteMode = 'plain' | 'markdown' | 'ask'

/** Режим подсветки документа в редакторе */
export type EditorSyntax = 'none' | 'markdown'

export interface UserConfig {
  hotkeys: Record<string, string>
  theme: ThemeMode
  contrast: ContrastMode
  motion: MotionMode
  uiScale: UiScale
  xdotoolBin: string
  windowInsertion: {
    method: 'xdotool' | 'ydotool'
    xdotoolBin: string
    ydotoolBin: string
  }
  appLanguage: string
  userLanguage: string
  toTranslateLanguages: string[]
  pasteMode: PasteMode
  editorSyntax: EditorSyntax
  showBubbleMenu: boolean
  editorHistoryMaxItems: number
  chatHistoryMaxItems: number
  llm: LlmConfig
  sttModels: SttModel[]
  ttsModels: {
    id: string
    model: string
    description?: string
    baseUrl?: string
    apiKey?: string
  }[]
  aiModelUsage: { stt: string; tts: string }
  aiRules: {
    base: string
    translate: string
    voiceCorrection: string
    correction: string
  }
  aiTasks: {
    name: string
    rule: string
    tapAction?: string
    holdAction?: string
  }[]
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
    history: 'Ctrl+Alt+H',
    config: 'Ctrl+Alt+Comma',
  },
  theme: 'auto',
  contrast: 'auto',
  motion: 'auto',
  uiScale: 100,
  xdotoolBin: '/usr/bin/xdotool',
  windowInsertion: {
    method: 'xdotool',
    xdotoolBin: '/usr/bin/xdotool',
    ydotoolBin: '/usr/bin/ydotool',
  },
  appLanguage: 'auto',
  userLanguage: 'auto',
  toTranslateLanguages: ['en_US', 'ru_RU', 'es_AR', 'tr_TR'],
  pasteMode: 'markdown',
  editorSyntax: 'markdown',
  showBubbleMenu: true,
  editorHistoryMaxItems: 100,
  chatHistoryMaxItems: 50,
  llm: DEFAULT_LLM_CONFIG,
  sttModels: [
    {
      id: 'openai-compatible-stt',
      model: 'whisper-1',
      provider: 'openai-compatible',
      description: 'OpenAI-compatible transcription endpoint',
      formatWithLlm: false,
      baseUrl: 'http://localhost:8000/v1',
      apiKey: '',
    },
    {
      id: 'websocket-stt',
      model: 'whisper',
      provider: 'websocket',
      description: 'Streaming STT WebSocket endpoint',
      formatWithLlm: true,
      baseUrl: 'ws://localhost:2700',
    },
  ],
  ttsModels: [],
  aiModelUsage: { stt: 'openai-compatible-stt', tts: '' },
  aiRules: {
    base: BASE_TASK,
    translate: TRANSLATION_TASK,
    voiceCorrection: VOICE_CORRECTION_TASK,
    correction: CORRECTION_TASK,
  },
  aiTasks: [
    {
      name: 'deepEdit',
      rule: 'убрать косноязычие , добавить местоимения где они нужны, исправление смысла и запутанности, убрать дублирование, подобрать уместные синонимы',
    },
  ],
  plugins: {},
}
